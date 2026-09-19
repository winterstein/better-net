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

import { tagsForModule } from '../features/module-tags.js';
import { problemScoreFromFraction, type ProblemScore } from '../types/Score.js';
import {
	FEEDBACK_TARGETS,
	PAGE_LEVEL_TARGETS,
	TAG_EDIT_ONLY_TARGETS,
} from '../types/Feedback.js';
import type { FeedbackSubmission, FeedbackTarget } from '../types/Feedback.js';
import { CHUNK_TAG_SPECS, PAGE_TYPE_TAG_SPECS } from '../types/Tag.js';
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
	// One value per page, so the modal offers these as a choice rather than a set.
	if (target === 'page') return PAGE_TYPE_TAG_SPECS;
	return [];
}

export function isFeedbackEnabled(settings: {
	shareAnonymous?: boolean;
	serverEndpoint?: string;
}): boolean {
	return !!(settings.shareAnonymous && settings.serverEndpoint?.trim());
}

/**
 * The local id: created once per browser profile, never sent anywhere but bn-server, and
 * unguessable because possession of it is what proves ownership of this browser's feedback
 * (specs/accounts/user-identity). Kept in `local`, not `sync`, so it does not roam.
 */
export async function getOrCreateDeviceId(): Promise<string> {
	const { [DEVICE_ID_KEY]: id } = await chrome.storage.local.get(DEVICE_ID_KEY);
	if (typeof id === 'string' && id) return id;
	const newId = crypto.randomUUID();
	await chrome.storage.local.set({ [DEVICE_ID_KEY]: newId });
	return newId;
}

async function readQueue(): Promise<FeedbackSubmission[]> {
	const { [FEEDBACK_QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(FEEDBACK_QUEUE_KEY);
	return Array.isArray(queue) ? queue : [];
}

/**
 * Serialises read-modify-write on the queue. chrome.storage has no transaction, so two
 * overlapping updates both read the same array and the second `set` discards the first —
 * which silently dropped feedback when an enqueue landed while a flush was mid-send.
 * One background worker owns the queue, so chaining promises here is enough.
 */
let queueWrites: Promise<unknown> = Promise.resolve();
function withQueueWrite<T>(fn: () => Promise<T>): Promise<T> {
	const run = queueWrites.then(fn, fn);
	queueWrites = run.catch(() => undefined);
	return run;
}

/** Replaces any queued entry for the same localId: the latest version is the one to send. */
export async function enqueueFeedback(entry: FeedbackSubmission): Promise<void> {
	return withQueueWrite(async () => {
		const existing = await readQueue();
		const next = existing.filter((item) => item.localId !== entry.localId);
		next.push(entry);
		await chrome.storage.local.set({ [FEEDBACK_QUEUE_KEY]: next });
	});
}

/**
 * A non-OK response. `permanent` marks the ones retrying cannot fix: the server has
 * rejected the payload itself, so re-sending it every 30 minutes forever would only keep
 * a dead entry in the queue and keep telling the user it is about to be sent.
 * 408 and 429 are 4xx but are about timing, so they stay retryable.
 */
export class FeedbackSubmitError extends Error {
	readonly status: number;
	constructor(status: number, body: string) {
		super(`Feedback failed (${status}): ${body}`);
		this.name = 'FeedbackSubmitError';
		this.status = status;
	}
	get permanent(): boolean {
		return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
	}
}

/** A network error has no status and is always worth retrying. */
function isPermanentFailure(err: unknown): boolean {
	return err instanceof FeedbackSubmitError && err.permanent;
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
		throw new FeedbackSubmitError(res.status, text);
	}
	return res.json();
}

/**
 * Send what is queued. Only entries this run finished with are removed, and the removal
 * re-reads the queue, so anything enqueued while we were awaiting the network survives.
 *
 * @returns number of queued items successfully sent
 */
let flushing = false;
export async function flushFeedbackQueue(
	settings: { shareAnonymous?: boolean; serverEndpoint?: string },
	fetchImpl: typeof fetch = fetch
): Promise<number> {
	if (!isFeedbackEnabled(settings)) return 0;
	// Two flushes overlapping would send every entry twice; the alarm and the post-submit
	// flush can both fire at once (background/feedback-manager.ts).
	if (flushing) return 0;
	flushing = true;
	try {
		const queue = await readQueue();
		if (queue.length === 0) return 0;

		// Identity, not localId: if a follow-up for the same localId is queued while we are
		// sending, it is a *different* entry and must stay. A key mismatch here would retry
		// an entry rather than drop it, and the POST is an upsert, so that way is the safe one.
		const done = new Set<string>();
		let sent = 0;
		for (const item of queue) {
			try {
				await submitFeedback(item, settings.serverEndpoint!, fetchImpl);
				done.add(JSON.stringify(item));
				sent++;
			} catch (err) {
				// Rejected payloads are dropped: see FeedbackSubmitError.permanent.
				if (isPermanentFailure(err)) done.add(JSON.stringify(item));
			}
		}
		await withQueueWrite(async () => {
			const current = await readQueue();
			const remaining = current.filter((item) => !done.has(JSON.stringify(item)));
			await chrome.storage.local.set({ [FEEDBACK_QUEUE_KEY]: remaining });
		});
		return sent;
	} finally {
		flushing = false;
	}
}

async function postJson(
	serverEndpoint: string,
	path: string,
	body: unknown,
	fetchImpl: typeof fetch = fetch
): Promise<any> {
	const base = serverEndpoint.replace(/\/$/, '');
	const res = await fetchImpl(`${base}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new FeedbackSubmitError(res.status, text);
	}
	return res.json();
}

/** How much this browser has sent, for the delete confirmation to state a number. */
export async function countMyFeedback(
	serverEndpoint: string,
	ownerKey: string,
	fetchImpl: typeof fetch = fetch
): Promise<number> {
	const { count } = await postJson(serverEndpoint, '/api/feedback/count-mine', { localId: ownerKey }, fetchImpl);
	return Number(count) || 0;
}

/**
 * Delete this browser's feedback, server-side and locally.
 *
 * The queue goes first, deliberately: it holds feedback that has not reached the server, and
 * the flush alarm runs every 30 minutes, so leaving it would re-send and resurrect what was
 * just deleted. If the request then fails, the worst case is dropping unsent feedback — which
 * is what the user asked for (specs/accounts/delete-my-data).
 */
export async function deleteMyFeedback(
	serverEndpoint: string,
	ownerKey: string,
	fetchImpl: typeof fetch = fetch
): Promise<number> {
	await clearFeedbackQueue();
	const { deleted } = await postJson(serverEndpoint, '/api/feedback/delete-mine', { localId: ownerKey }, fetchImpl);
	return Number(deleted) || 0;
}

export async function clearFeedbackQueue(): Promise<void> {
	return withQueueWrite(async () => {
		await chrome.storage.local.set({ [FEEDBACK_QUEUE_KEY]: [] });
	});
}

/**
 * A short single-use code standing in for the local id, so the long-lived id never has to
 * reach the webapp (specs/accounts/user-identity).
 */
export async function requestLinkCode(
	serverEndpoint: string,
	ownerKey: string,
	fetchImpl: typeof fetch = fetch
): Promise<{ code: string; expires: string }> {
	return await postJson(serverEndpoint, '/api/account/link-code', { localId: ownerKey }, fetchImpl);
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
	/** The band we claimed. A [0,1] fraction is accepted and bucketed, for older callers. */
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
 *
 * Keyed on the local id, never the email: the email is optional and can be set at any time,
 * so keying on it would move every localId the moment someone filled it in — orphaning their
 * earlier feedback and inserting duplicates instead of updating (specs/accounts/user-identity).
 */
export async function feedbackLocalId(parts: {
	/** The local id. Not the email: an email can be set later, which would move the key. */
	ownerKey: string;
	target: FeedbackTarget;
	moduleId?: string;
	chunkFingerprint?: string;
	pageUrl?: string;
	tag?: string;
}): Promise<string> {
	// The chunk when there is one; the page for the page-level targets, which have no chunk.
	const subject = parts.chunkFingerprint || parts.pageUrl || '';
	const key = [parts.ownerKey, parts.target, parts.moduleId ?? '', subject, parts.tag ?? ''].join('|');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
	return `fb-${hex.slice(0, 24)}`;
}

/**
 * Validate and complete a submission — either a thumb or one tag edit.
 *
 * Required context differs by target: 'chunker' and 'page' are about the page, the rest
 * are about a chunk, and 'module' also needs a module. A tag edit is checked against that
 * target's own vocabulary, so a tag the UI never offered is a caller bug and is rejected
 * rather than stored as an opinion.
 */
export interface FeedbackIdentity {
	/** The local id that owns this feedback. Required. */
	ownerKey: string;
	/** Optional unverified email label. Never used to key or authorise anything. */
	email?: string;
}

export async function buildFeedbackSubmission(
	payload: FeedbackPayload,
	identity: FeedbackIdentity
): Promise<FeedbackSubmission | { error: string }> {
	if (!identity?.ownerKey) return { error: 'Missing owner key' };
	if (!FEEDBACK_TARGETS.includes(payload.target)) {
		return { error: `Unknown feedback target: ${payload.target}` };
	}
	if (payload.message && payload.message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
		return { error: `Message too long (max ${MAX_FEEDBACK_MESSAGE_LENGTH})` };
	}
	if (PAGE_LEVEL_TARGETS.includes(payload.target)) {
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
	} else if (TAG_EDIT_ONLY_TARGETS.includes(payload.target)) {
		// The module card and the page-type row have no thumb — their tags are edited
		// directly. bn-server agrees, so catching it here turns a 400 into a caller error.
		return { error: `${payload.target} feedback is a tag edit` };
	}

	/**
	 * A thumb starts the rating over, so it has to wipe the preset issue and note the
	 * previous one collected — otherwise a 👍 keeps a complaint hanging off it.
	 * null clears the stored value; undefined would leave it in place.
	 */
	const isThumb = !isTagEdit && !payload.issueId && !payload.message;

	const submission: FeedbackSubmission = {
		localId: await feedbackLocalId({
			ownerKey: identity.ownerKey,
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
		ownerKey: identity.ownerKey,
		userId: identity.email,
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
	// The page-type tag is about the page; there is no chunk to attach it to.
	if (payload.target === 'page') return submission;

	submission.chunkFingerprint = payload.chunkFingerprint;
	submission.chunkUrl = payload.chunkUrl;
	submission.chunkTitle = payload.chunkTitle;
	// What we claimed, so a correction can be weighed against how sure we were. Stored as a
	// band; a fraction from an older caller is bucketed here, the one place it happens.
	if (payload.problemScore !== undefined) {
		submission.problemScore =
			typeof payload.problemScore === 'number'
				? problemScoreFromFraction(payload.problemScore)
				: payload.problemScore;
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
