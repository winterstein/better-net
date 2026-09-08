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
	enqueueFeedback,
	flushFeedbackQueue,
	getOrCreateDeviceId,
	isFeedbackEnabled,
	submitFeedback,
} from '../feedback/feedback-client.js';
import type { FeedbackPayload } from '../feedback/feedback-client.js';
import type { FeedbackSubmission, FeedbackTarget } from '../types/Feedback.js';
import { configureAiqaTracing, mirrorFeedbackToAiqa } from '../tracing/aiqa-tracer.js';
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
	if (entry.issueLabel) parts.push(entry.issueLabel);
	if (entry.message) parts.push(`"${entry.message}"`);
	return parts.join(' — ');
}

function toPayload(p: Record<string, unknown>): FeedbackPayload {
	return {
		localId: String(p.localId || ''),
		target: p.target as FeedbackTarget,
		applies: !!p.applies,
		retracted: !!p.retracted,
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
		problemScore: typeof p.problemScore === 'number' ? p.problemScore : undefined,
		confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
		traceId: p.traceId ? String(p.traceId) : undefined,
		spanId: p.spanId ? String(p.spanId) : undefined,
	};
}

export async function handleSubmitFeedback(message: {
	payload?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
	const stored = await chrome.storage.sync.get(null);
	const settings = mergeSettings(stored);
	if (!isFeedbackEnabled(settings)) {
		return { ok: false, error: 'Feedback sharing is disabled in Settings → Data Sharing' };
	}

	const userId = (settings.accountEmail as string)?.trim() || (await getOrCreateDeviceId());
	const built = buildFeedbackSubmission(toPayload(message.payload || {}), userId);
	if ('error' in built) return { ok: false, error: built.error };

	void mirrorToAiqa(built, settings);

	try {
		await submitFeedback(built, settings.serverEndpoint as string);
		void flushFeedbackQueue(settings);
		return { ok: true };
	} catch (err: any) {
		// Queued by localId, so a follow-up issue replaces the thumb rather than doubling it.
		await enqueueFeedback(built);
		return { ok: false, error: err?.message || 'Failed to send feedback' };
	}
}

async function mirrorToAiqa(entry: FeedbackSubmission, settings: Record<string, any>): Promise<void> {
	if (!entry.traceId) return;
	try {
		// The worker may have been suspended since the analysis, so the exporter is rebuilt.
		if (!(await configureAiqaTracing(settings))) return;
		await mirrorFeedbackToAiqa(entry.traceId, {
			thumbsUp: entry.retracted ? undefined : entry.applies,
			comment: traceComment(entry),
			parentSpanId: entry.spanId,
		});
	} catch (error) {
		logit('warn', '[BetterNet] [FEEDBACK] AIQA mirror failed:', (error as Error)?.message);
	}
}
