import tap from 'tap';
import Fastify, { FastifyInstance } from 'fastify';
import feedbackRoutes from '../src/routes/feedback.js';
import { db_init, db_close, get_item } from '../src/db.js';
import { AspectType } from '../src/bn-extension-src/types/AspectAnalysis.js';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.test', override: true });

let fastify: FastifyInstance | undefined;

async function initTest(): Promise<FastifyInstance> {
	await db_init();
	if (!fastify) {
		fastify = Fastify({ logger: false });
		fastify.register(feedbackRoutes, { prefix: '/api/feedback' });
		await fastify.listen({ port: 0 });
	}
	return fastify;
}

tap.teardown(async () => {
	if (fastify) await fastify.close();
	await db_close();
});

tap.test('Feedback_POST_creates_chunk_and_record', async (t) => {
	await initTest();
	if (!fastify) {
		t.fail('Fastify instance not initialized');
		return;
	}

	const payload = {
		chunkFingerprint: 'test-fp-feedback-001',
		chunkUrl: 'https://example.com/article',
		chunkTitle: 'Test Article',
		aspectType: AspectType.ACCURACY,
		moduleId: 'factChecker',
		applies: false,
		message: 'Seems accurate to me',
		problemScore: 0.7,
		confidence: 0.8,
		userId: 'test-user',
	};

	const res = await fastify.inject({
		method: 'POST',
		url: '/api/feedback/',
		payload,
	});

	t.equal(res.statusCode, 201, 'Feedback POST should return 201');
	const body = res.json() as { id: number; createdAt: string };
	t.ok(body.id, 'Response should include id');
	t.ok(body.createdAt, 'Response should include createdAt');

	const stored = await get_item('feedback', body.id);
	t.ok(stored, 'Feedback should be stored');
	t.equal((stored as any).moduleId, 'factChecker');
	t.equal((stored as any).applies, false);
});

tap.test('Feedback_POST_validates_body', async (t) => {
	await initTest();
	if (!fastify) {
		t.fail('Fastify instance not initialized');
		return;
	}

	const res = await fastify.inject({
		method: 'POST',
		url: '/api/feedback/',
		payload: { chunkUrl: 'https://example.com' },
	});

	t.equal(res.statusCode, 400, 'Missing fields should return 400');
});
