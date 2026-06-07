/**
 * Extension ↔ server chunk-aspect feedback (v1).
 * Queues submissions when offline; background worker flushes the queue.
 */

import { moduleToAspect } from './aspect-map.js';
import type { FeedbackSubmission } from '../types/Feedback.js';

export const FEEDBACK_QUEUE_KEY = 'bnFeedbackQueue';
const DEVICE_ID_KEY = 'bnDeviceId';
export const MAX_FEEDBACK_MESSAGE_LENGTH = 500;

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

export async function enqueueFeedback(entry: FeedbackSubmission): Promise<void> {
	const { [FEEDBACK_QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(FEEDBACK_QUEUE_KEY);
	const next = Array.isArray(queue) ? [...queue, entry] : [entry];
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

export function buildFeedbackSubmission(
	payload: {
		chunkFingerprint: string;
		chunkUrl: string;
		chunkTitle?: string;
		moduleId: string;
		applies: boolean;
		message?: string;
		problemScore?: number;
		confidence?: number;
		analysisId?: string;
	},
	userId: string
): FeedbackSubmission | { error: string } {
	const aspectType = moduleToAspect(payload.moduleId);
	if (!aspectType) return { error: 'Unknown analysis module' };
	if (payload.message && payload.message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
		return { error: `Message too long (max ${MAX_FEEDBACK_MESSAGE_LENGTH})` };
	}
	return {
		chunkFingerprint: payload.chunkFingerprint,
		chunkUrl: payload.chunkUrl,
		chunkTitle: payload.chunkTitle,
		aspectType,
		moduleId: payload.moduleId,
		analysisId: payload.analysisId,
		applies: payload.applies,
		message: payload.applies ? undefined : payload.message?.trim() || undefined,
		problemScore: payload.problemScore,
		confidence: payload.confidence,
		userId,
	};
}
