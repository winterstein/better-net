import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { create_item, get_chunk_by_fingerprint, get_item } from '../db.js';
import type { FeedbackSubmission } from '../bn-extension-src/types/Feedback.js';
import type { Chunk } from '../bn-extension-src/types/Chunk.js';
import { AspectType } from '../bn-extension-src/types/AspectAnalysis.js';

const VALID_ASPECTS = new Set(Object.values(AspectType));
const MAX_MESSAGE = 500;

function validateBody(body: Partial<FeedbackSubmission>): string | null {
	if (!body.chunkFingerprint || typeof body.chunkFingerprint !== 'string') {
		return 'chunkFingerprint is required';
	}
	if (!body.chunkUrl || typeof body.chunkUrl !== 'string') {
		return 'chunkUrl is required';
	}
	if (!body.moduleId || typeof body.moduleId !== 'string') {
		return 'moduleId is required';
	}
	if (!body.aspectType || !VALID_ASPECTS.has(body.aspectType)) {
		return 'aspectType is invalid';
	}
	if (typeof body.applies !== 'boolean') {
		return 'applies must be a boolean';
	}
	if (body.message != null) {
		if (typeof body.message !== 'string') return 'message must be a string';
		if (body.message.length > MAX_MESSAGE) return `message exceeds ${MAX_MESSAGE} characters`;
	}
	return null;
}

async function feedbackRoutes(fastify: FastifyInstance) {
	fastify.post<{ Body: FeedbackSubmission }>('/', async (
		request: FastifyRequest<{ Body: FeedbackSubmission }>,
		reply: FastifyReply
	) => {
		const body = request.body || ({} as FeedbackSubmission);
		const err = validateBody(body);
		if (err) return reply.code(400).send({ error: err });

		let chunk = await get_chunk_by_fingerprint(body.chunkFingerprint);
		let chunkId: number;
		if (!chunk) {
			const chunkData: Partial<Chunk> = {
				url: body.chunkUrl,
				text: body.chunkTitle || body.chunkUrl,
				title: body.chunkTitle,
				fingerprint: body.chunkFingerprint,
			};
			chunkId = (await create_item('chunk', chunkData as any)) as number;
		} else {
			chunkId = chunk.id as number;
		}

		const feedbackItem = {
			chunkId,
			chunkFingerprint: body.chunkFingerprint,
			chunkUrl: body.chunkUrl,
			chunkTitle: body.chunkTitle,
			aspectType: body.aspectType,
			moduleId: body.moduleId,
			analysisId: body.analysisId,
			applies: body.applies,
			message: body.message,
			problemScore: body.problemScore,
			confidence: body.confidence,
			userId: body.userId,
		};

		const id = (await create_item('feedback', feedbackItem as any)) as number;
		const created = await get_item('feedback', id);
		const createdAt = (created as any)?.created || new Date().toISOString();
		return reply.code(201).send({ id, createdAt });
	});
}

export default feedbackRoutes;
