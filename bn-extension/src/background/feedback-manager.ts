/**
 * Background handler for Content Analysis feedback (specs/feedback.md).
 *
 * bn-server is the store of record. When the analysis was traced, the same feedback is
 * also mirrored onto the AIQA trace so the thumb shows up beside the prompts — a copy
 * for the trace view, best-effort, never allowed to fail the submission.
 */

import { mergeSettings } from '../settings/modules-esm.js';
import {
	buildFeedbackSubmission,
	countMyFeedback,
	deleteMyFeedback,
	enqueueFeedback,
	fetchDeviceStatus,
	flushFeedbackQueue,
	getOrCreateDeviceId,
	isFeedbackEnabled,
	peekDeviceId,
	requestLinkCode,
	submitFeedback,
	FeedbackSubmitError,
} from '../feedback/feedback-client.js';
import type { FeedbackPayload } from '../feedback/feedback-client.js';
import type { FeedbackSubmission, FeedbackTarget } from '../types/Feedback.js';
import { configureAiqaTracing, mirrorFeedbackToAiqa } from '../tracing/aiqa-tracer.js';
import { PROBLEM_SCORES, type ProblemScore } from '../types/Score.js';
import { logit } from '../utils/logger.js';

const FLUSH_ALARM = 'bn-feedback-flush';

async function flushOnAlarm() {
	const stored = await chrome.storage.sync.get(null);
	await flushFeedbackQueue(mergeSettings(stored));
}

export function setupFeedbackManager() {
	chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 30 });
	chrome.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === FLUSH_ALARM) void flushOnAlarm();
	});
	void flushOnAlarm();
}

/** What the AIQA trace view shows for this feedback: the target, and why it was wrong. */
function traceComment(entry: FeedbackSubmission): string {
	const parts = [entry.moduleId ? `${entry.target}:${entry.moduleId}` : entry.target];
	// A tag edit is the useful kind for anyone reading the trace: not "wrong", but which
	// way round it should have gone. terminology.md writes "off" as !tag.
	if (entry.tag && entry.tagOn != null) parts.push(entry.tagOn ? entry.tag : `!${entry.tag}`);
	if (entry.issueLabel) parts.push(entry.issueLabel);
	if (entry.message) parts.push(`"${entry.message}"`);
	return parts.join(' — ');
}

/** Accepts either shape and rejects anything else, so a stray value is dropped not stored. */
function problemScoreOrFraction(v: unknown): ProblemScore | number | undefined {
	if (typeof v === 'number') return v;
	return PROBLEM_SCORES.includes(v as ProblemScore) ? (v as ProblemScore) : undefined;
}

function toPayload(p: Record<string, unknown>): FeedbackPayload {
	return {
		target: p.target as FeedbackTarget,
		// Left undefined when absent: a tag edit has no thumb, and !!undefined would
		// invent a thumbs down.
		thumbsUp: typeof p.thumbsUp === 'boolean' ? p.thumbsUp : undefined,
		retracted: !!p.retracted,
		tag: p.tag ? String(p.tag) : undefined,
		tagOn: typeof p.tagOn === 'boolean' ? p.tagOn : undefined,
		issueId: p.issueId ? String(p.issueId) : undefined,
		issueLabel: p.issueLabel ? String(p.issueLabel) : undefined,
		message: p.message ? String(p.message) : undefined,
		chunkFingerprint: p.chunkFingerprint ? String(p.chunkFingerprint) : undefined,
		chunkUrl: p.chunkUrl ? String(p.chunkUrl) : undefined,
		chunkTitle: p.chunkTitle ? String(p.chunkTitle) : undefined,
		pageUrl: p.pageUrl ? String(p.pageUrl) : undefined,
		chunkCount: typeof p.chunkCount === 'number' ? p.chunkCount : undefined,
		moduleId: p.moduleId ? String(p.moduleId) : undefined,
		analysisId: p.analysisId ? String(p.analysisId) : undefined,
		// A band passes through; a fraction from an older modal is bucketed downstream.
		problemScore: problemScoreOrFraction(p.problemScore),
		confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
		traceId: p.traceId ? String(p.traceId) : undefined,
		spanId: p.spanId ? String(p.spanId) : undefined,
	};
}

/**
 * `queued: true` means the feedback is stored and will be sent by the flush alarm — a
 * dead endpoint must not look to the user like a rejected correction (specs/feedback.md).
 */
export async function handleSubmitFeedback(message: {
	payload?: Record<string, unknown>;
}): Promise<{ ok: boolean; queued?: boolean; error?: string }> {
	const stored = await chrome.storage.sync.get(null);
	const settings = mergeSettings(stored);
	if (!isFeedbackEnabled(settings)) {
		return { ok: false, error: 'Feedback sharing is disabled in Settings → Data Sharing' };
	}

	// The local id owns the feedback; the email is an unverified label and may be absent.
	const ownerKey = await getOrCreateDeviceId();
	const email = (settings.accountEmail as string)?.trim() || undefined;
	const built = await buildFeedbackSubmission(toPayload(message.payload || {}), { ownerKey, email });
	if ('error' in built) return { ok: false, error: built.error };

	void mirrorToAiqa(built, settings);

	try {
		await submitFeedback(built, settings.serverEndpoint as string);
		void flushFeedbackQueue(settings);
		return { ok: true };
	} catch (err: any) {
		// A rejected payload will be rejected again, so do not queue it and do not tell the
		// user it is saved — that promised a retry that could never succeed.
		if (err instanceof FeedbackSubmitError && err.permanent) {
			logit('warn', '[BetterNet] [FEEDBACK] rejected by server, not queued:', err.message);
			return { ok: false, error: err.message };
		}
		// Queued by localId, so a follow-up issue replaces the thumb rather than doubling it.
		await enqueueFeedback(built);
		// The server being unreachable is the common case here (a wrong or undeployed
		// `serverEndpoint`), so say where we tried: the modal only has room for "saved".
		logit(
			'warn',
			`[BetterNet] [FEEDBACK] queued for retry — ${settings.serverEndpoint} unreachable:`,
			err?.message
		);
		return { ok: false, queued: true, error: err?.message || 'Failed to send feedback' };
	}
}

async function mirrorToAiqa(entry: FeedbackSubmission, settings: Record<string, any>): Promise<void> {
	if (!entry.traceId) return;
	try {
		// The worker may have been suspended since the analysis, so the exporter is rebuilt.
		if (!(await configureAiqaTracing(settings))) return;
		await mirrorFeedbackToAiqa(entry.traceId, {
			// A tag edit carries its verdict in the comment, so leave the thumb neutral.
			thumbsUp: entry.retracted || entry.tag ? undefined : entry.thumbsUp,
			comment: traceComment(entry),
			parentSpanId: entry.spanId,
		});
	} catch (error) {
		logit('warn', '[BetterNet] [FEEDBACK] AIQA mirror failed:', (error as Error)?.message);
	}
}

/**
 * The options page's Account section talks to bn-server through these. All three are
 * authorised by possession of the local id, which never leaves the extension except as a
 * one-time link code (specs/accounts/user-identity, specs/accounts/delete-my-data).
 *
 * They do not require Data Sharing to be on: someone who has turned it off still needs to be
 * able to see and delete what was sent while it was on.
 */
async function serverEndpointOrFail(): Promise<string> {
	const settings = mergeSettings(await chrome.storage.sync.get(null));
	const endpoint = (settings.serverEndpoint as string)?.trim();
	if (!endpoint) throw new Error('No server endpoint is configured');
	return endpoint;
}

/** @returns the webapp URL to open, with a one-time link code in the fragment. */
export async function handleFeedbackLink(): Promise<{ ok: boolean; url?: string; error?: string }> {
	try {
		const settings = mergeSettings(await chrome.storage.sync.get(null));
		const endpoint = await serverEndpointOrFail();
		const ownerKey = await getOrCreateDeviceId();
		const { code } = await requestLinkCode(endpoint, ownerKey);
		const base = String(settings.webappUrl || '').replace(/\/$/, '');
		if (!base) return { ok: false, error: 'No webapp URL is configured' };
		// Fragment, not query string: a fragment is never sent to the server, so the code
		// stays out of access logs and Referer headers.
		return { ok: true, url: `${base}/feedback#link=${encodeURIComponent(code)}` };
	} catch (err: any) {
		logit('warn', '[BetterNet] [FEEDBACK] link code failed:', err?.message);
		return { ok: false, error: err?.message || 'Could not reach the server' };
	}
}

/**
 * Is this browser linked, and to which account? Drives the popup and options page controls.
 *
 * An unlinked browser has no local id yet, so this answers without a server round trip and
 * without creating one — checking your status should not be what gives you an identity.
 */
export async function handleAccountStatus(): Promise<{
	ok: boolean;
	linked?: boolean;
	email?: string;
	error?: string;
}> {
	try {
		const ownerKey = await peekDeviceId();
		if (!ownerKey) return { ok: true, linked: false };
		const endpoint = await serverEndpointOrFail();
		return { ok: true, ...(await fetchDeviceStatus(endpoint, ownerKey)) };
	} catch (err: any) {
		// Not logged: the popup asks this on every open, so a server that is down would
		// otherwise fill the log with one line per glance at the toolbar.
		return { ok: false, error: err?.message || 'Could not reach the server' };
	}
}

/** The number the delete confirmation states, so it is not a blind "delete everything". */
export async function handleFeedbackCount(): Promise<{ ok: boolean; count?: number; error?: string }> {
	try {
		const endpoint = await serverEndpointOrFail();
		const count = await countMyFeedback(endpoint, await getOrCreateDeviceId());
		return { ok: true, count };
	} catch (err: any) {
		return { ok: false, error: err?.message || 'Could not reach the server' };
	}
}

export async function handleFeedbackDelete(): Promise<{ ok: boolean; deleted?: number; error?: string }> {
	try {
		const endpoint = await serverEndpointOrFail();
		const deleted = await deleteMyFeedback(endpoint, await getOrCreateDeviceId());
		logit('log', '[BetterNet] [FEEDBACK] deleted this device\'s feedback:', deleted);
		return { ok: true, deleted };
	} catch (err: any) {
		logit('warn', '[BetterNet] [FEEDBACK] delete failed:', err?.message);
		return { ok: false, error: err?.message || 'Could not reach the server' };
	}
}
