/**
 * Background handler for chunk-aspect feedback → bn-server.
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

export async function handleSubmitFeedback(message: {
	payload?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
	const stored = await chrome.storage.sync.get(null);
	const settings = mergeSettings(stored);
	if (!isFeedbackEnabled(settings)) {
		return { ok: false, error: 'Feedback sharing is disabled in Settings → Data Sharing' };
	}

	const p = message.payload || {};
	const userId = (settings.accountEmail as string)?.trim() || (await getOrCreateDeviceId());
	const built = buildFeedbackSubmission(
		{
			chunkFingerprint: String(p.chunkFingerprint || ''),
			chunkUrl: String(p.chunkUrl || ''),
			chunkTitle: p.chunkTitle ? String(p.chunkTitle) : undefined,
			moduleId: String(p.moduleId || ''),
			applies: !!p.applies,
			message: p.message ? String(p.message) : undefined,
			problemScore: typeof p.problemScore === 'number' ? p.problemScore : undefined,
			confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
			analysisId: p.analysisId ? String(p.analysisId) : undefined,
		},
		userId
	);

	if ('error' in built) return { ok: false, error: built.error };
	if (!built.chunkFingerprint || !built.chunkUrl) {
		return { ok: false, error: 'Missing chunk context' };
	}

	try {
		await submitFeedback(built, settings.serverEndpoint as string);
		void flushFeedbackQueue(settings);
		return { ok: true };
	} catch (err: any) {
		await enqueueFeedback(built);
		return { ok: false, error: err?.message || 'Failed to send feedback' };
	}
}
