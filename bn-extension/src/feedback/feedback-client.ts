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

import { tagsForModule } from '../features/registry.js';
import { fractionFromProblemScore, type ProblemScore } from '../types/Score.js';
import { FEEDBACK_TARGETS } from '../types/Feedback.js';
import type { FeedbackSubmission, FeedbackTarget } from '../types/Feedback.js';
import { CHUNK_TAG_SPECS } from '../types/Tag.js';
import type { TagSpec } from '../types/Tag.js';

export const FEEDBACK_QUEUE_KEY = 'bnFeedbackQueue';
const DEVICE_ID_KEY = 'bnDeviceId';
export const MAX_FEEDBACK_MESSAGE_LENGTH = 500;

/**
 * Which tags a target may edit. A tag outside its own vocabulary is a bug in the caller,
 * not a user opinion, so it is rejected rather than stored.
 */
export function editableTags(target: FeedbackTarget, moduleId?: string): TagSpec[] {
	if (target === 'chunk') return CHUNK_TAG_SPECS;
	if (target === 'module') return tagsForModule(moduleId ?? '');
	return [];
}

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

/** What the modal sends in BN_SUBMIT_FEEDBACK: either a thumb or one tag edit. */
export interface FeedbackPayload {
	target: FeedbackTarget;
	/** A thumb, for the targets that still have one (`summary`, `chunker`, `chunk`). */
	thumbsUp?: boolean;
	retracted?: boolean;
	/** A tag edit: the tag, and whether the user says it belongs. */
	tag?: string;
	tagOn?: boolean;
	issueId?: string;
	issueLabel?: string;
	message?: string;
	chunkFingerprint?: string;
	chunkUrl?: string;
	chunkTitle?: string;
	pageUrl?: string;
	chunkCount?: number;
	moduleId?: string;
	analysisId?: string;
	problemScore?: ProblemScore | number;
	confidence?: number;
	traceId?: string;
	spanId?: string;
}

/**
 * One record per (user, statement). Deterministic, which does three jobs: a preset issue
 * lands on the row its thumb created without passing an id around, a follow-up made
 * offline replaces the queued thumb, and saying the same thing again after a reload
 * corrects the earlier record instead of filing a second opinion against it.
 *
 * The tag is part of the key, because each tag is its own statement: removing `clickbait`
 * and adding `urgency` on one module are two independent corrections, not one overwriting
 * the other. Re-adding a tag you removed *is* the same statement, so it updates that row.
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
	tag?: string;
}): Promise<string> {
	// The chunk when there is one; the page for chunker feedback, which has no chunk.
	const subject = parts.chunkFingerprint || parts.pageUrl || '';
	const key = [parts.userId, parts.target, parts.moduleId ?? '', subject, parts.tag ?? ''].join('|');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
	return `fb-${hex.slice(0, 24)}`;
}

/**
 * Validate and complete a submission — either a thumb or one tag edit.
 *
 * Required context differs by target: 'chunker' is about the page, the other three are
 * about a chunk, and 'module' also needs a module. A tag edit is checked against that
 * target's own vocabulary, so a tag the UI never offered is a caller bug and is rejected
 * rather than stored as an opinion.
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

	// A tag edit and a thumb are different statements, and every submission is one of them.
	const isTagEdit = payload.tag !== undefined;
	if (isTagEdit) {
		if (typeof payload.tagOn !== 'boolean') return { error: 'Tag edit needs tagOn' };
		const vocabulary = editableTags(payload.target, payload.moduleId);
		if (!vocabulary.length) return { error: `${payload.target} feedback has no editable tags` };
		if (!vocabulary.some((t) => t.id === payload.tag)) {
			return { error: `Tag not offered here: ${payload.tag}` };
		}
	} else if (typeof payload.thumbsUp !== 'boolean') {
		return { error: 'Feedback needs a thumb or a tag edit' };
	} else if (payload.target === 'module') {
		// The module card has no thumb — its tags are edited directly. bn-server agrees,
		// so catching it here turns a 400 into a caller-side error.
		return { error: 'Module feedback is a tag edit' };
	}

	/**
	 * A thumb starts the rating over, so it has to wipe the preset issue and note the
	 * previous one collected — otherwise a 👍 keeps a complaint hanging off it.
	 * null clears the stored value; undefined would leave it in place.
	 */
	const isThumb = !isTagEdit && !payload.issueId && !payload.message;

	const submission: FeedbackSubmission = {
		localId: await feedbackLocalId({
			userId,
			target: payload.target,
			moduleId: payload.moduleId,
			chunkFingerprint: payload.chunkFingerprint,
			pageUrl: payload.pageUrl,
			tag: payload.tag,
		}),
		target: payload.target,
		// Which page the feedback came from, for every target — chunker has only this.
		pageUrl: payload.pageUrl,
		traceId: payload.traceId,
		spanId: payload.spanId,
		userId,
	};

	if (isTagEdit) {
		// Nothing is inferred: the user said which tag, and whether it belongs.
		submission.tag = payload.tag;
		submission.tagOn = payload.tagOn;
	} else {
		submission.thumbsUp = payload.thumbsUp;
		// Explicit, so rating again after a retraction is not still marked as withdrawn.
		submission.retracted = !!payload.retracted;
		submission.issueId = isThumb ? null : payload.issueId;
		submission.issueLabel = isThumb ? null : payload.issueLabel;
		submission.message = isThumb ? null : payload.message?.trim() || null;
	}

	if (payload.target === 'chunker') {
		submission.chunkCount = payload.chunkCount;
		return submission;
	}

	submission.chunkFingerprint = payload.chunkFingerprint;
	submission.chunkUrl = payload.chunkUrl;
	submission.chunkTitle = payload.chunkTitle;
	// What we claimed, so a correction can be weighed against how sure we were.
	if (payload.problemScore !== undefined) {
		submission.problemScore =
			typeof payload.problemScore === 'number'
				? payload.problemScore
				: fractionFromProblemScore(payload.problemScore);
	}

	if (payload.target === 'module') {
		const moduleId = payload.moduleId || '';
		if (!tagsForModule(moduleId).length) return { error: 'Unknown analysis module' };
		submission.moduleId = moduleId;
		submission.analysisId = payload.analysisId;
		submission.confidence = payload.confidence;
	}

	return submission;
}
