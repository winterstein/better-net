/**
 * Extension ↔ server feedback (see specs/feedback.md).
 *
 * Lifecycle of one piece of feedback: the thumb POSTs a record with a client-generated
 * localId; a preset issue or note POSTs the same localId again, which the server treats
 * as an update. Failures queue in chrome.storage.local keyed by localId, so a follow-up
 * made offline replaces the queued thumb rather than adding to it. The background worker
 * flushes the queue (background/feedback-manager.ts).
 */

import { moduleToAspect } from './aspect-map.js';
import { FEEDBACK_TARGETS } from '../types/Feedback.js';
import type { FeedbackSubmission, FeedbackTarget } from '../types/Feedback.js';

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
	localId: string;
	target: FeedbackTarget;
	applies: boolean;
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
	analysisId?: string;
	problemScore?: number;
	confidence?: number;
	traceId?: string;
	spanId?: string;
}

export function newFeedbackLocalId(): string {
	return crypto.randomUUID();
}

/**
 * Validate and complete a submission. Required context differs by target: 'chunker' is
 * about the page, the other three are about a chunk, and 'aspect' also needs a module.
 */
export function buildFeedbackSubmission(
	payload: FeedbackPayload,
	userId: string
): FeedbackSubmission | { error: string } {
	if (!payload.localId) return { error: 'Missing feedback id' };
	if (!FEEDBACK_TARGETS.includes(payload.target)) {
		return { error: `Unknown feedback target: ${payload.target}` };
	}
	if (payload.message && payload.message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
		return { error: `Message too long (max ${MAX_FEEDBACK_MESSAGE_LENGTH})` };
	}

	const submission: FeedbackSubmission = {
		localId: payload.localId,
		target: payload.target,
		applies: payload.applies,
		retracted: payload.retracted || undefined,
		issueId: payload.issueId,
		issueLabel: payload.issueLabel,
		message: payload.message?.trim() || undefined,
		traceId: payload.traceId,
		spanId: payload.spanId,
		userId,
	};

	if (payload.target === 'chunker') {
		if (!payload.pageUrl) return { error: 'Missing page context' };
		submission.pageUrl = payload.pageUrl;
		submission.chunkCount = payload.chunkCount;
		return submission;
	}

	if (!payload.chunkFingerprint || !payload.chunkUrl) return { error: 'Missing chunk context' };
	submission.chunkFingerprint = payload.chunkFingerprint;
	submission.chunkUrl = payload.chunkUrl;
	submission.chunkTitle = payload.chunkTitle;

	if (payload.target === 'aspect') {
		const aspectType = moduleToAspect(payload.moduleId || '');
		if (!aspectType) return { error: 'Unknown analysis module' };
		submission.aspectType = aspectType;
		submission.moduleId = payload.moduleId;
		submission.analysisId = payload.analysisId;
		submission.problemScore = payload.problemScore;
		submission.confidence = payload.confidence;
	} else {
		submission.problemScore = payload.problemScore;
	}

	return submission;
}
