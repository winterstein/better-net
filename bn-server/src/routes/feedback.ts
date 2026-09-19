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
import { FEEDBACK_TARGETS, PAGE_LEVEL_TARGETS } from '../bn-extension-src/types/Feedback.js';
import type { Chunk } from '../bn-extension-src/types/Chunk.js';
import type { Page } from '../bn-extension-src/types/Page.js';
import { problemScoreFromFraction } from '../bn-extension-src/types/Score.js';
import {
	allFeedback,
	countFeedbackForOwner,
	deleteFeedbackForOwner,
	feedbackForOwners,
	ownerKeysForAccount,
} from '../accounts.js';
import { requireAuth, requireStaff } from '../auth.js';

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
	body: Omit<Partial<FeedbackSubmission>, 'problemScore'> & {
		applies?: boolean;
		target?: string;
		/** Legacy: a [0,1] fraction where a band is stored now. */
		problemScore?: FeedbackSubmission['problemScore'] | number;
	}
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
	// problemScore is stored as a ProblemScore band (types/Feedback.ts). Older extensions
	// send a [0,1] fraction, so bucket it here rather than storing two shapes in one field.
	if (typeof body.problemScore === 'number') {
		body.problemScore = problemScoreFromFraction(body.problemScore);
	}
	// The numeric shape is bucketed away just above, so this is now a plain submission.
	return body as Partial<FeedbackSubmission>;
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
	if (PAGE_LEVEL_TARGETS.includes(body.target as FeedbackTarget)) {
		// About the page, so there is no chunk of its own: how it was split ('chunker'), or
		// its `page-type:…` tag ('page' — specs/content-classification.md).
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
			// Who owns this row: reads and deletes are keyed on it, and no read returns it.
			ownerKey: body.ownerKey,
			userId: body.userId,
		};

		const existing = await get_feedback_by_local_id(body.localId!);
		if (existing) {
			return reply.code(200).send(await applyFollowUp(existing, feedbackItem));
		}

		try {
			const id = (await create_item('feedback', feedbackItem as any)) as number;
			const createdItem = await get_item('feedback', id);
			const createdAt = (createdItem as any)?.created || new Date().toISOString();
			return reply.code(201).send({ id, createdAt });
		} catch (err) {
			// A concurrent POST for the same localId got there first (uq_feedback_localId in
			// db.ts), so this one is a follow-up after all rather than a second opinion.
			if (!isUniqueViolation(err)) throw err;
			const winner = await get_feedback_by_local_id(body.localId!);
			if (!winner) throw err;
			return reply.code(200).send(await applyFollowUp(winner, feedbackItem));
		}
	});

	/**
	 * Own feedback. "Mine" means rows owned by a local id linked to this account, so a user
	 * who has never linked a device gets an empty list plus linkedDevices: 0 — the webapp
	 * shows a different message for that than for "linked but nothing rated yet".
	 */
	fastify.get<{ Querystring: FeedbackQuery }>('/mine', async (
		request: FastifyRequest<{ Querystring: FeedbackQuery }>,
		reply: FastifyReply
	) => {
		const user = await requireAuth(request, reply);
		if (!user) return reply;
		const ownerKeys = await ownerKeysForAccount(user.sub);
		const page = await feedbackForOwners(ownerKeys, filtersFrom(request.query));
		return reply.send({ ...page, linkedDevices: ownerKeys.length });
	});

	/** All feedback, staff only. Pseudonymised in accounts.ts, never here. */
	fastify.get<{ Querystring: FeedbackQuery }>('/all', async (
		request: FastifyRequest<{ Querystring: FeedbackQuery }>,
		reply: FastifyReply
	) => {
		const staff = await requireStaff(request, reply);
		if (!staff) return reply;
		return reply.send(await allFeedback(filtersFrom(request.query)));
	});

	/**
	 * Delete this browser's feedback. Authorised by possession of the local id, like
	 * /api/account/link-code — the extension is never signed in
	 * (specs/accounts/delete-my-data). The extension must also clear its pending queue, or
	 * the flush alarm would re-send and resurrect what was just deleted.
	 */
	fastify.post<{ Body: { localId?: string } }>('/delete-mine', async (
		request: FastifyRequest<{ Body: { localId?: string } }>,
		reply: FastifyReply
	) => {
		const localId = request.body?.localId?.trim();
		if (!localId) return reply.code(400).send({ error: 'A local id is required' });
		return reply.send({ deleted: await deleteFeedbackForOwner(localId) });
	});

	/** The count the confirmation dialog shows before anything is deleted. */
	fastify.post<{ Body: { localId?: string } }>('/count-mine', async (
		request: FastifyRequest<{ Body: { localId?: string } }>,
		reply: FastifyReply
	) => {
		const localId = request.body?.localId?.trim();
		if (!localId) return reply.code(400).send({ error: 'A local id is required' });
		return reply.send({ count: await countFeedbackForOwner(localId) });
	});
}

interface FeedbackQuery {
	target?: string;
	moduleId?: string;
	tag?: string;
	limit?: string;
	offset?: string;
}

function filtersFrom(q: FeedbackQuery = {}) {
	return {
		target: q.target,
		moduleId: q.moduleId,
		tag: q.tag,
		limit: q.limit ? Number(q.limit) : undefined,
		offset: q.offset ? Number(q.offset) : undefined,
	};
}

/** Absent fields in a follow-up must not wipe what the thumb already recorded. */
function stripUndefined(item: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
}

/**
 * Keep what the thumb recorded and layer the new fields over it. Only undefined is
 * "unchanged" — an explicit null is a field being cleared.
 */
async function applyFollowUp(
	existing: Record<string, any>,
	feedbackItem: Record<string, unknown>
): Promise<{ id: number; createdAt: string }> {
	const { id, created, ...rest } = existing;
	const merged = { ...rest, ...stripUndefined(feedbackItem), updated: new Date() };
	await update_item('feedback', id as number, merged as any);
	return { id: id as number, createdAt: created || new Date().toISOString() };
}

/** Postgres unique_violation — see uq_feedback_localId in db.ts. */
function isUniqueViolation(err: unknown): boolean {
	return (err as { code?: string })?.code === '23505';
}

export default feedbackRoutes;
