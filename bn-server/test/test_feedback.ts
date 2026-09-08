import tap from 'tap';
import Fastify, { FastifyInstance } from 'fastify';
import feedbackRoutes from '../src/routes/feedback.js';
import { db_init, db_close, get_item, get_feedback_by_local_id } from '../src/db.js';
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

function localId(tag: string): string {
	return `test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function post(payload: Record<string, unknown>) {
	const app = await initTest();
	return app.inject({ method: 'POST', url: '/api/feedback/', payload });
}

tap.teardown(async () => {
	if (fastify) await fastify.close();
	await db_close();
});

tap.test('Feedback_POST_creates_chunk_and_record', async (t) => {
	const res = await post({
		localId: localId('module'),
		target: 'module',
		chunkFingerprint: 'test-fp-feedback-001',
		chunkUrl: 'https://example.com/article',
		chunkTitle: 'Test Article',
		moduleId: 'factChecker',
		tag: 'false-claim',
		tagOn: false,
		problemScore: 0.7,
		confidence: 0.8,
		userId: 'test-user',
		traceId: 'a'.repeat(32),
		spanId: 'b'.repeat(16),
	});

	t.equal(res.statusCode, 201, 'Feedback POST should return 201');
	const body = res.json() as { id: number; createdAt: string };
	t.ok(body.id, 'Response should include id');
	t.ok(body.createdAt, 'Response should include createdAt');

	const stored = (await get_item('feedback', body.id)) as any;
	t.ok(stored, 'Feedback should be stored');
	t.equal(stored.moduleId, 'factChecker');
	t.equal(stored.tag, 'false-claim', 'the tag the user corrected');
	t.equal(stored.tagOn, false, 'ground truth: that tag does not belong here');
	t.equal(stored.thumbsUp, undefined, 'a tag edit is not a thumb');
	t.equal(stored.target, 'module');
	t.ok(stored.chunkId, 'module feedback is linked to a chunk');
	t.ok(stored.pageId == null, 'no page url was sent, so no page row');
	t.equal(stored.traceId, 'a'.repeat(32), 'the AIQA trace is kept for follow-up');
	t.equal(stored.spanId, 'b'.repeat(16));
});

/**
 * A tag edit needs its tag and which way round it goes; the module target needs to be one,
 * because its card has no thumb. specs/feedback.md
 */
tap.test('Feedback_POST_validates_tag_edits', async (t) => {
	const base = {
		target: 'module',
		moduleId: 'clickUnbait',
		chunkFingerprint: 'test-fp-feedback-tagvalid',
		chunkUrl: 'https://example.com/article',
	};
	t.equal(
		(await post({ ...base, localId: localId('bad'), tag: 'clickbait' })).statusCode,
		400,
		'a tag with no tagOn states nothing'
	);
	t.equal(
		(await post({ ...base, localId: localId('bad'), thumbsUp: false })).statusCode,
		400,
		'the module target has no thumb'
	);
	t.equal(
		(await post({ ...base, localId: localId('ok'), tag: 'clickbait', tagOn: false })).statusCode,
		201,
		'a tag edit is what it wants'
	);
});

// A tag edit works on the chunk's own tags too, alongside the thumb for the region.
tap.test('Feedback_POST_chunk_tag_edit', async (t) => {
	const res = await post({
		localId: localId('chunktag'),
		target: 'chunk',
		chunkFingerprint: 'test-fp-feedback-chunktag',
		chunkUrl: 'https://example.com/article',
		pageUrl: 'https://example.com/article',
		tag: 'advert',
		tagOn: true,
	});
	t.equal(res.statusCode, 201);
	const stored = (await get_item('feedback', (res.json() as any).id)) as any;
	t.equal(stored.tag, 'advert');
	t.equal(stored.tagOn, true, 'the user says we missed it');
	t.equal(stored.thumbsUp, undefined);
	t.ok(stored.chunkId);
	t.ok(stored.pageId, 'and the page it was on');
});

// The thumb inserts; the preset issue that follows updates the same row. specs/feedback.md
tap.test('Feedback_POST_upserts_on_localId', async (t) => {
	const id = localId('upsert');
	const base = {
		localId: id,
		target: 'summary',
		chunkFingerprint: 'test-fp-feedback-upsert',
		chunkUrl: 'https://example.com/upsert',
		thumbsUp: false,
		problemScore: 0.9,
	};

	const first = await post(base);
	t.equal(first.statusCode, 201, 'the thumb creates the record');
	const firstId = (first.json() as any).id;

	const second = await post({ ...base, issueId: 'score-too-high', issueLabel: 'Score too high' });
	t.equal(second.statusCode, 200, 'the follow-up updates it');
	t.equal((second.json() as any).id, firstId, 'same row');

	const stored = (await get_feedback_by_local_id(id)) as any;
	t.equal(stored.issueId, 'score-too-high');
	t.equal(stored.issueLabel, 'Score too high');
	t.equal(stored.problemScore, 0.9, 'what the thumb recorded is not wiped by the follow-up');
});

// Chunker feedback is about the page, so it has no chunk of its own.
tap.test('Feedback_POST_chunker_targets_page', async (t) => {
	const res = await post({
		localId: localId('chunker'),
		target: 'chunker',
		thumbsUp: false,
		issueId: 'missed-content',
		pageUrl: 'https://example.com/feed-' + Date.now(),
		chunkCount: 12,
	});
	t.equal(res.statusCode, 201);
	const stored = (await get_item('feedback', (res.json() as any).id)) as any;
	t.ok(stored.chunkId == null, 'no chunk row for page-level feedback');
	t.ok(stored.pageId, 'linked to a page instead');
	t.equal(stored.chunkCount, 12);
});

tap.test('Feedback_POST_chunk_target', async (t) => {
	const res = await post({
		localId: localId('chunk'),
		target: 'chunk',
		chunkFingerprint: 'test-fp-feedback-chunk',
		chunkUrl: 'https://example.com/article',
		pageUrl: 'https://example.com/article',
		thumbsUp: false,
		issueId: 'not-a-chunk',
	});
	t.equal(res.statusCode, 201);
	const stored = (await get_item('feedback', (res.json() as any).id)) as any;
	t.equal(stored.issueId, 'not-a-chunk');
	t.ok(stored.chunkId, 'chunk feedback is linked to a chunk');
	t.ok(stored.pageId, 'and to the page it was on');
});

tap.test('Feedback_POST_validates_body', async (t) => {
	t.equal((await post({ chunkUrl: 'https://example.com' })).statusCode, 400, 'no target');
	t.equal(
		(await post({
			localId: localId('bad'),
			target: 'summary',
			chunkFingerprint: 'fp',
			chunkUrl: 'https://example.com',
		})).statusCode,
		400,
		'a record with no thumb is not feedback'
	);
	t.equal(
		(await post({ localId: localId('bad'), target: 'nonsense', thumbsUp: true })).statusCode,
		400,
		'unknown target'
	);
	t.equal(
		(await post({ localId: localId('bad'), target: 'chunker', thumbsUp: true })).statusCode,
		400,
		'chunker feedback needs a page url'
	);
	t.equal(
		(await post({
			localId: localId('bad'),
			target: 'chunk',
			chunkUrl: 'https://example.com',
			thumbsUp: true,
		})).statusCode,
		400,
		'chunk feedback needs a fingerprint'
	);
	t.equal(
		(await post({
			localId: localId('bad'),
			target: 'summary',
			chunkFingerprint: 'fp',
			chunkUrl: 'https://example.com',
			thumbsUp: false,
			message: 'x'.repeat(501),
		})).statusCode,
		400,
		'message is capped'
	);
});

/**
 * A tab left open across an extension update still sends the pre-v0.5 aspect-only shape:
 * a thumb, on a target that no longer has one. It is accepted rather than dropped.
 */
tap.test('Feedback_POST_accepts_legacy_payload', async (t) => {
	const res = await post({
		chunkFingerprint: 'test-fp-feedback-legacy',
		chunkUrl: 'https://example.com/article',
		aspectType: 'bias',
		moduleId: 'biasDetector',
		applies: true,
	});
	t.equal(res.statusCode, 201);
	const stored = (await get_item('feedback', (res.json() as any).id)) as any;
	t.equal(stored.target, 'module', 'legacy aspect remapped to module');
	t.equal(stored.thumbsUp, true, 'the old `applies` is the thumb');
	t.ok(stored.localId, 'given an id so a follow-up could still find it');
});

/**
 * Changing your mind has to withdraw the complaint too. The merge keeps whatever the
 * client omits, so a thumb sends an explicit null: without it a 👍 kept the preset issue
 * and note from the 👎 before it, and the row read as praise carrying a complaint.
 */
tap.test('Feedback_POST_new_thumb_clears_the_old_complaint', async (t) => {
	const id = localId('switch');
	const base = {
		localId: id,
		target: 'chunk',
		chunkFingerprint: 'test-fp-feedback-switch',
		chunkUrl: 'https://example.com/switch',
		pageUrl: 'https://example.com/switch',
	};

	await post({ ...base, thumbsUp: false, retracted: false, issueId: null, issueLabel: null, message: null });
	await post({
		...base,
		thumbsUp: false,
		issueId: 'not-a-chunk',
		issueLabel: "This shouldn't be a chunk",
		message: 'boundaries off',
	});
	const complained = (await get_feedback_by_local_id(id)) as any;
	t.equal(complained.issueId, 'not-a-chunk', 'the complaint is on the record');

	// The user changes their mind and clicks the other thumb.
	await post({ ...base, thumbsUp: true, retracted: false, issueId: null, issueLabel: null, message: null });
	const stored = (await get_feedback_by_local_id(id)) as any;
	t.equal(stored.thumbsUp, true, 'the new vote replaces the old one');
	t.equal(stored.issueId, null, 'and the preset issue goes with it');
	t.equal(stored.issueLabel, null);
	t.equal(stored.message, null, 'as does the note');
	t.equal(stored.retracted, false, 'rating again is not still a withdrawal');
});

// Retracting leaves the record but marks the rating withdrawn, so it can be excluded.
tap.test('Feedback_POST_retraction_is_not_sticky', async (t) => {
	const id = localId('retract');
	const base = {
		localId: id,
		target: 'summary',
		chunkFingerprint: 'test-fp-feedback-retract',
		chunkUrl: 'https://example.com/retract',
	};

	await post({ ...base, thumbsUp: true, retracted: false });
	await post({ ...base, thumbsUp: true, retracted: true });
	t.equal(((await get_feedback_by_local_id(id)) as any).retracted, true, 'withdrawn');

	await post({ ...base, thumbsUp: false, retracted: false });
	const stored = (await get_feedback_by_local_id(id)) as any;
	t.equal(stored.retracted, false, 'and voting again brings the record back');
	t.equal(stored.thumbsUp, false);
});
