/**
 * Extension ↔ server feedback (see specs/feedback.md).
 *
 * Lifecycle of one piece of feedback: the thumb POSTs a record under a localId derived
 * from what is being rated and who is rating it; a preset issue or note derives the same
 * localId and so updates that record rather than adding one. Failures queue in
 * chrome.storage.local keyed by localId, so a follow-up made offline replaces the queued
 * thumb rather than adding to it. The background worker flushes the queue
 * (background/feedback-manager.ts).
 */

import { MODULE_PRIMARY_TAG, primaryTagForModule } from '../types/ModuleAnalysis.js';
import type { IssueTag } from '../types/Score.js';
import { fractionFromProblemScore, type ProblemScore } from '../types/Score.js';
import { FEEDBACK_TARGETS } from '../types/Feedback.js';
import type { FeedbackSubmission, FeedbackTarget } from '../types/Feedback.js';
import { riskLevelForScore } from '../types/RiskLevel.js';

export const FEEDBACK_QUEUE_KEY = 'bnFeedbackQueue';
const DEVICE_ID_KEY = 'bnDeviceId';
export const MAX_FEEDBACK_MESSAGE_LENGTH = 500;

const ANALYSIS_MODULE_IDS = new Set(Object.keys(MODULE_PRIMARY_TAG));

export function isFeedbackEnabled(settings: {
	shareAnonymous?: boolean;
	serverEndpoint?: string;
}): boolean {
	return !!(settings.shareAnonymous && settings.serverEndpoint?.trim());
}

export async function getOrCreateDeviceId(): Promise<string> {
	const { [DEVICE_ID_KEY]: id } = await chrome.storage.local.get(DEVICE_ID_KEY);
	if (typeof id === 'string' && id) return id;
	const newId = crypto.randomUUID();
	await chrome.storage.local.set({ [DEVICE_ID_KEY]: newId });
	return newId;
}

/** Replaces any queued entry for the same localId: the latest version is the one to send. */
export async function enqueueFeedback(entry: FeedbackSubmission): Promise<void> {
	const { [FEEDBACK_QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(FEEDBACK_QUEUE_KEY);
	const existing: FeedbackSubmission[] = Array.isArray(queue) ? queue : [];
	const next = existing.filter((item) => item.localId !== entry.localId);
	next.push(entry);
	await chrome.storage.local.set({ [FEEDBACK_QUEUE_KEY]: next });
}

export async function submitFeedback(
	entry: FeedbackSubmission,
	serverEndpoint: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ id: number; createdAt: string }> {
	const base = serverEndpoint.replace(/\/$/, '');
	const res = await fetchImpl(`${base}/api/feedback`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(entry),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Feedback failed (${res.status}): ${text}`);
	}
	return res.json();
}

/** @returns number of queued items successfully sent */
export async function flushFeedbackQueue(
	settings: { shareAnonymous?: boolean; serverEndpoint?: string },
	fetchImpl: typeof fetch = fetch
): Promise<number> {
	if (!isFeedbackEnabled(settings)) return 0;
	const { [FEEDBACK_QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(FEEDBACK_QUEUE_KEY);
	if (!Array.isArray(queue) || queue.length === 0) return 0;

	const remaining: FeedbackSubmission[] = [];
	let sent = 0;
	for (const item of queue) {
		try {
			await submitFeedback(item, settings.serverEndpoint!, fetchImpl);
			sent++;
		} catch {
			remaining.push(item);
		}
	}
	await chrome.storage.local.set({ [FEEDBACK_QUEUE_KEY]: remaining });
	return sent;
}

/** What the modal sends in BN_SUBMIT_FEEDBACK. */
export interface FeedbackPayload {
	target: FeedbackTarget;
	/** The click: true = 👍, false = 👎. */
	thumbsUp: boolean;
	retracted?: boolean;
	issueId?: string;
	issueLabel?: string;
	message?: string;
	chunkFingerprint?: string;
	chunkUrl?: string;
	chunkTitle?: string;
	pageUrl?: string;
	chunkCount?: number;
	moduleId?: string;
	/** Product tags from the module result; primary is chosen by severity. */
	tags?: Array<string | IssueTag>;
	analysisId?: string;
	problemScore?: ProblemScore | number;
	confidence?: number;
	traceId?: string;
	spanId?: string;
}

/**
 * One record per (user, thing rated). Deterministic, which does three jobs: the thumb and
 * the preset issue that follows land on the same row without passing an id around, a
 * follow-up made offline replaces the queued thumb, and re-rating the same chunk after a
 * reload corrects the earlier verdict instead of filing a second opinion against it.
 *
 * A chunk's fingerprint is its url + title (types/Chunk.ts), so a page whose body changed
 * keeps its id, while a different page — or a retitled one — is treated as a new subject.
 */
export async function feedbackLocalId(parts: {
	userId: string;
	target: FeedbackTarget;
	moduleId?: string;
	chunkFingerprint?: string;
	pageUrl?: string;
}): Promise<string> {
	// The chunk when there is one; the page for chunker feedback, which has no chunk.
	const subject = parts.chunkFingerprint || parts.pageUrl || '';
	const key = [parts.userId, parts.target, parts.moduleId ?? '', subject].join('|');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
	return `fb-${hex.slice(0, 24)}`;
}

/**
 * Did the analysis claim this tag is on? The thumb is a verdict on that claim, so turning
 * it into ground truth needs it. 'safe' is the band where we flag nothing, the same line
 * the Nutrient Label draws (types/RiskLevel.ts) — so it is the line the user was reacting
 * to. Borderline scores therefore hinge on a display threshold, which is why
 * `problemScore` is stored alongside.
 */
function analysisFlaggedIt(problemScore?: ProblemScore | number): boolean {
	const fraction =
		typeof problemScore === 'number'
			? problemScore
			: problemScore
				? fractionFromProblemScore(problemScore)
				: 0;
	return riskLevelForScore(fraction).id !== 'safe';
}

/**
 * Validate and complete a submission. Required context differs by target: 'chunker' is
 * about the page, the other three are about a chunk, and 'module' also needs a module.
 */
export async function buildFeedbackSubmission(
	payload: FeedbackPayload,
	userId: string
): Promise<FeedbackSubmission | { error: string }> {
	if (!FEEDBACK_TARGETS.includes(payload.target)) {
		return { error: `Unknown feedback target: ${payload.target}` };
	}
	if (payload.message && payload.message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
		return { error: `Message too long (max ${MAX_FEEDBACK_MESSAGE_LENGTH})` };
	}
	if (payload.target === 'chunker') {
		if (!payload.pageUrl) return { error: 'Missing page context' };
	} else if (!payload.chunkFingerprint || !payload.chunkUrl) {
		return { error: 'Missing chunk context' };
	}

	/**
	 * A thumb starts the rating over, so it has to wipe the preset issue and note the
	 * previous one collected — otherwise a 👍 keeps "this isn't clickbait" hanging off it.
	 * null clears the stored value; undefined would leave it in place.
	 */
	const isThumb = !payload.issueId && !payload.message;

	const submission: FeedbackSubmission = {
		localId: await feedbackLocalId({
			userId,
			target: payload.target,
			moduleId: payload.moduleId,
			chunkFingerprint: payload.chunkFingerprint,
			pageUrl: payload.pageUrl,
		}),
		target: payload.target,
		thumbsUp: payload.thumbsUp,
		// Explicit, so rating again after a retraction is not still marked as withdrawn.
		retracted: !!payload.retracted,
		issueId: isThumb ? null : payload.issueId,
		issueLabel: isThumb ? null : payload.issueLabel,
		message: isThumb ? null : payload.message?.trim() || null,
		// Which page the feedback came from, for every target — chunker has only this.
		pageUrl: payload.pageUrl,
		traceId: payload.traceId,
		spanId: payload.spanId,
		userId,
	};

	if (payload.target === 'chunker') {
		submission.chunkCount = payload.chunkCount;
		return submission;
	}

	submission.chunkFingerprint = payload.chunkFingerprint;
	submission.chunkUrl = payload.chunkUrl;
	submission.chunkTitle = payload.chunkTitle;
	submission.problemScore =
		typeof payload.problemScore === 'number'
			? payload.problemScore
			: payload.problemScore
				? fractionFromProblemScore(payload.problemScore)
				: payload.problemScore;

	if (payload.target === 'module') {
		const moduleId = payload.moduleId || '';
		if (!ANALYSIS_MODULE_IDS.has(moduleId)) return { error: 'Unknown analysis module' };
		const tag = primaryTagForModule(moduleId, payload.tags);
		if (!tag) return { error: 'Unknown analysis module' };
		submission.moduleId = moduleId;
		submission.analysisId = payload.analysisId;
		submission.confidence = payload.confidence;
		submission.tag = tag;
		// A retraction withdraws the rating, so there is no ground truth left to record.
		submission.tagOn = payload.retracted
			? null
			: payload.thumbsUp === analysisFlaggedIt(payload.problemScore);
	}

	return submission;
}
