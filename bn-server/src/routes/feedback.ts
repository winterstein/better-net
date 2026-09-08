/**
 * POST /api/feedback — user feedback from the extension's Content Analysis modal.
 * See bn-extension/specs/feedback.md. bn-server is the store of record; the extension
 * also mirrors a copy onto the AIQA trace for the trace view.
 *
 * The POST is an upsert on the client's localId: the thumb inserts the record, and the
 * preset issue or note that follows updates it, so one thumbs down stays one row.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
	create_item,
	get_chunk_by_fingerprint,
	get_feedback_by_local_id,
	get_item,
	get_page_by_url,
	update_item,
} from '../db.js';
import type { FeedbackSubmission, FeedbackTarget } from '../bn-extension-src/types/Feedback.js';
import { FEEDBACK_TARGETS } from '../bn-extension-src/types/Feedback.js';
import type { Chunk } from '../bn-extension-src/types/Chunk.js';
import type { Page } from '../bn-extension-src/types/Page.js';
import { AspectType } from '../bn-extension-src/types/AspectAnalysis.js';

const VALID_ASPECTS = new Set(Object.values(AspectType));
const VALID_TARGETS = new Set<FeedbackTarget>(FEEDBACK_TARGETS);
const MAX_MESSAGE = 500;

/**
 * Feedback before v0.5 was aspect-only and had no localId. A tab left open across an
 * extension update still sends that shape, so fill the gaps instead of rejecting it.
 */
function normalizeBody(body: Partial<FeedbackSubmission>): Partial<FeedbackSubmission> {
	if (!body.target && body.aspectType) body.target = 'aspect';
	if (!body.localId) body.localId = `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	return body;
}

function validateBody(body: Partial<FeedbackSubmission>): string | null {
	if (!body.localId || typeof body.localId !== 'string') {
		return 'localId is required';
	}
	if (!body.target || !VALID_TARGETS.has(body.target)) {
		return 'target is invalid';
	}
	if (typeof body.applies !== 'boolean') {
		return 'applies must be a boolean';
	}
	if (body.message != null) {
		if (typeof body.message !== 'string') return 'message must be a string';
		if (body.message.length > MAX_MESSAGE) return `message exceeds ${MAX_MESSAGE} characters`;
	}
	if (body.target === 'chunker') {
		// Chunker feedback is about how the page was split, so it has no chunk of its own.
		if (!body.pageUrl || typeof body.pageUrl !== 'string') return 'pageUrl is required';
		return null;
	}
	if (!body.chunkFingerprint || typeof body.chunkFingerprint !== 'string') {
		return 'chunkFingerprint is required';
	}
	if (!body.chunkUrl || typeof body.chunkUrl !== 'string') {
		return 'chunkUrl is required';
	}
	if (body.target === 'aspect') {
		if (!body.moduleId || typeof body.moduleId !== 'string') return 'moduleId is required';
		if (!body.aspectType || !VALID_ASPECTS.has(body.aspectType)) return 'aspectType is invalid';
	}
	return null;
}

/** Feedback can be the first thing we ever hear about a chunk, so create the row if new. */
async function resolveChunkId(body: Partial<FeedbackSubmission>): Promise<number | undefined> {
	if (!body.chunkFingerprint) return undefined;
	const chunk = await get_chunk_by_fingerprint(body.chunkFingerprint);
	if (chunk) return chunk.id as number;
	const chunkData: Partial<Chunk> = {
		url: body.chunkUrl,
		text: body.chunkTitle || body.chunkUrl,
		title: body.chunkTitle,
		fingerprint: body.chunkFingerprint,
	};
	return (await create_item('chunk', chunkData as any)) as number;
}

async function resolvePageId(pageUrl?: string): Promise<number | undefined> {
	if (!pageUrl) return undefined;
	const page = await get_page_by_url(pageUrl);
	if (page) return page.id as number;
	return (await create_item('page', { url: pageUrl } as Partial<Page> as any)) as number;
}

async function feedbackRoutes(fastify: FastifyInstance) {
	fastify.post<{ Body: FeedbackSubmission }>('/', async (
		request: FastifyRequest<{ Body: FeedbackSubmission }>,
		reply: FastifyReply
	) => {
		const body = normalizeBody(request.body || ({} as FeedbackSubmission));
		const err = validateBody(body);
		if (err) return reply.code(400).send({ error: err });

		const feedbackItem = {
			chunkId: await resolveChunkId(body),
			pageId: await resolvePageId(body.pageUrl),
			localId: body.localId,
			target: body.target,
			applies: body.applies,
			retracted: body.retracted,
			issueId: body.issueId,
			issueLabel: body.issueLabel,
			message: body.message,
			chunkFingerprint: body.chunkFingerprint,
			chunkUrl: body.chunkUrl,
			chunkTitle: body.chunkTitle,
			pageUrl: body.pageUrl,
			chunkCount: body.chunkCount,
			aspectType: body.aspectType,
			moduleId: body.moduleId,
			analysisId: body.analysisId,
			problemScore: body.problemScore,
			confidence: body.confidence,
			traceId: body.traceId,
			spanId: body.spanId,
			userId: body.userId,
		};

		const existing = await get_feedback_by_local_id(body.localId!);
		if (existing) {
			// A follow-up: keep what the thumb recorded and layer the new fields over it.
			const { id, created, ...rest } = existing as Record<string, any>;
			const merged = { ...rest, ...stripUndefined(feedbackItem), updated: new Date() };
			await update_item('feedback', id as number, merged as any);
			return reply.code(200).send({ id, createdAt: created || new Date().toISOString() });
		}

		const id = (await create_item('feedback', feedbackItem as any)) as number;
		const createdItem = await get_item('feedback', id);
		const createdAt = (createdItem as any)?.created || new Date().toISOString();
		return reply.code(201).send({ id, createdAt });
	});
}

/** Absent fields in a follow-up must not wipe what the thumb already recorded. */
function stripUndefined(item: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
}

export default feedbackRoutes;
