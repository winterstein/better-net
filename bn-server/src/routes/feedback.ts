/**
 * POST /api/feedback — user feedback from the extension's Content Analysis modal.
 * See bn-extension/specs/feedback.md. bn-server is the store of record; the extension
 * also mirrors a copy onto the AIQA trace for the trace view.
 *
 * The POST is an upsert on the client's localId, which the extension derives from what is
 * being rated and who is rating it: the thumb inserts the record, and the preset issue or
 * note that follows updates it, so one thumbs down stays one row — as does the same person
 * re-rating the same chunk later.
 *
 * An update merges onto what is stored, so a field the client omits keeps its value. That
 * is what lets a follow-up be partial, and it is why the client sends an explicit null to
 * clear: a fresh thumb has to drop the complaint the previous one collected.
 *
 * A submission is either a **thumb** (`thumbsUp`, for output with no tags of its own) or a
 * **tag edit** (`tag` + `tagOn`, the user's own correction). The `module` and `chunk`
 * targets send tag edits; see bn-extension/specs/feedback.md.
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

/** Legacy AspectType → moduleId (pre Module/Tag rename). */
const LEGACY_ASPECT_TO_MODULE: Record<string, string> = {
	accuracy: 'factChecker',
	bias: 'biasDetector',
	scams: 'antiManipulation',
	toxicity: 'defuseRagebait',
	clickbait: 'clickUnbait',
};

const VALID_TARGETS = new Set<string>([...FEEDBACK_TARGETS, 'aspect']);
const MAX_MESSAGE = 500;

/**
 * Older extensions send an older shape, and a tab left open across an update keeps doing
 * it, so fill the gaps instead of rejecting them: before v0.5 feedback was aspect-only
 * with no localId, and it recorded `applies` where a thumb is now `thumbsUp`.
 * `aspect` target is remapped to `module`.
 */
function normalizeBody(
	body: Partial<FeedbackSubmission> & { applies?: boolean; target?: string }
): Partial<FeedbackSubmission> {
	const rawTarget = body.target as string | undefined;
	if (!rawTarget && body.aspectType) body.target = 'module';
	else if (rawTarget === 'aspect') body.target = 'module';
	if (!body.moduleId && body.aspectType) {
		body.moduleId = LEGACY_ASPECT_TO_MODULE[String(body.aspectType)];
	}
	if (!body.localId) body.localId = `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	if (typeof body.thumbsUp !== 'boolean' && typeof body.applies === 'boolean') {
		body.thumbsUp = body.applies;
	}
	return body;
}

function validateBody(body: Partial<FeedbackSubmission>): string | null {
	if (!body.localId || typeof body.localId !== 'string') {
		return 'localId is required';
	}
	if (!body.target || !VALID_TARGETS.has(body.target)) {
		return 'target is invalid';
	}
	// Either a thumb or a tag edit — a record with neither states nothing.
	const isTagEdit = typeof body.tag === 'string' && body.tag !== '';
	if (isTagEdit) {
		if (typeof body.tagOn !== 'boolean') return 'tagOn must be a boolean for a tag edit';
	} else if (typeof body.thumbsUp !== 'boolean') {
		return 'feedback needs a thumb or a tag edit';
	}
	// null is how a new thumb clears the note an earlier one collected, so only reject a
	// message that is present and wrong.
	if (body.message !== undefined && body.message !== null) {
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
	if (body.target === 'module') {
		if (!body.moduleId || typeof body.moduleId !== 'string') return 'moduleId is required';
		/*
		 * The module target has no thumb any more: its feedback is which tags belong. The
		 * exception is a pre-rename payload, which is a thumb by definition — a tab left
		 * open across the update still sends one, and dropping it would lose real feedback
		 * for no gain. `aspectType` is what marks it; it names no tag we could translate
		 * to, so it is stored as the thumb it is.
		 */
		if (!isTagEdit && !body.aspectType) return 'module feedback is a tag edit';
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
			thumbsUp: body.thumbsUp,
			retracted: body.retracted,
			tag: body.tag,
			tagOn: body.tagOn,
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
			// Only undefined is "unchanged" — an explicit null is a field being cleared.
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
