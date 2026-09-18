/**
 * The offline feedback queue (feedback/feedback-client.ts).
 *
 * Covers the three ways the queue used to go wrong: a payload the server rejects retried
 * for ever, an enqueue during a flush being overwritten by the flush's write-back, and two
 * overlapping flushes sending everything twice. See specs/feedback.md.
 */

import assert from 'node:assert/strict';
import { installChromeMock } from './helpers/chrome-mock.js';
import {
	FEEDBACK_QUEUE_KEY,
	enqueueFeedback,
	flushFeedbackQueue,
	submitFeedback,
	FeedbackSubmitError,
} from '../src/feedback/feedback-client.js';
import type { FeedbackSubmission } from '../src/types/Feedback.js';

const settings = { shareAnonymous: true, serverEndpoint: 'https://server.example' };

function entry(localId: string): FeedbackSubmission {
	return {
		localId,
		target: 'summary',
		thumbsUp: false,
		chunkFingerprint: `fp-${localId}`,
		chunkUrl: 'https://example.com/a',
	};
}

/** Minimal stand-in for the bits of Response that submitFeedback reads. */
function response(status: number, body: unknown = { id: 1, createdAt: 'now' }) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async json() {
			return body;
		},
		async text() {
			return JSON.stringify(body);
		},
	} as unknown as Response;
}

async function queued(): Promise<FeedbackSubmission[]> {
	const { [FEEDBACK_QUEUE_KEY]: q = [] } = await chrome.storage.local.get(FEEDBACK_QUEUE_KEY);
	return q as FeedbackSubmission[];
}

// --- a rejected payload is not retryable, a failed connection is ----------------------
installChromeMock({ storage: {} });
{
	const err = new FeedbackSubmitError(400, 'target is invalid');
	assert.equal(err.permanent, true, '400 is the server rejecting the payload itself');
	assert.equal(new FeedbackSubmitError(500, '').permanent, false, '500 may be transient');
	assert.equal(new FeedbackSubmitError(503, '').permanent, false);
	assert.equal(new FeedbackSubmitError(429, '').permanent, false, 'rate limiting is timing');
	assert.equal(new FeedbackSubmitError(408, '').permanent, false, 'so is a timeout');
}

// submitFeedback reports the status, which is what the queue branches on
{
	await assert.rejects(
		() => submitFeedback(entry('a'), settings.serverEndpoint, async () => response(422, 'nope')),
		(e: unknown) => e instanceof FeedbackSubmitError && e.status === 422
	);
}

// --- issue 1: a 400 must leave the queue, not sit in it for ever ----------------------
installChromeMock({ storage: {} });
{
	await enqueueFeedback(entry('rejected'));
	const sent = await flushFeedbackQueue(settings, async () => response(400, 'target is invalid'));
	assert.equal(sent, 0, 'nothing was accepted');
	assert.deepEqual(await queued(), [], 'a rejected payload is dropped, not retried for ever');
}

// A transient failure keeps the entry for the next flush.
installChromeMock({ storage: {} });
{
	await enqueueFeedback(entry('later'));
	const sent = await flushFeedbackQueue(settings, async () => response(503));
	assert.equal(sent, 0);
	assert.equal((await queued()).length, 1, '5xx stays queued');

	await flushFeedbackQueue(settings, async () => {
		throw new TypeError('Failed to fetch');
	});
	assert.equal((await queued()).length, 1, 'a network error stays queued too');

	assert.equal(await flushFeedbackQueue(settings, async () => response(200)), 1);
	assert.deepEqual(await queued(), [], 'and leaves once accepted');
}

// --- issue 2: an enqueue during a flush must survive the write-back -------------------
installChromeMock({ storage: {} });
{
	await enqueueFeedback(entry('first'));
	let enqueuedMidFlight = false;
	const sent = await flushFeedbackQueue(settings, async () => {
		// The user rates something else while the flush is awaiting the network.
		if (!enqueuedMidFlight) {
			enqueuedMidFlight = true;
			await enqueueFeedback(entry('during-flush'));
		}
		return response(200);
	});
	assert.equal(sent, 1, 'the queued entry was sent');
	const left = await queued();
	assert.deepEqual(
		left.map((e) => e.localId),
		['during-flush'],
		'feedback added mid-flush is still queued, and the sent one is gone'
	);
}

// --- issue 2b: overlapping flushes must not send the same entry twice -----------------
installChromeMock({ storage: {} });
{
	await enqueueFeedback(entry('once'));
	let posts = 0;
	const slow = async () => {
		posts++;
		await new Promise((r) => setTimeout(r, 10));
		return response(200);
	};
	const [a, b] = await Promise.all([
		flushFeedbackQueue(settings, slow),
		flushFeedbackQueue(settings, slow),
	]);
	assert.equal(posts, 1, 'the second flush stands down rather than re-sending');
	assert.equal(a + b, 1, 'and only one of them reports a send');
	assert.deepEqual(await queued(), []);
}

// --- a follow-up replaces the queued entry rather than adding a second ---------------
installChromeMock({ storage: {} });
{
	await enqueueFeedback(entry('same'));
	await enqueueFeedback({ ...entry('same'), message: 'second thoughts' });
	const q = await queued();
	assert.equal(q.length, 1, 'one entry per localId');
	assert.equal(q[0].message, 'second thoughts', 'the later version is the one that is sent');
}

// Sharing off means nothing leaves the browser, and nothing is dropped either.
installChromeMock({ storage: {} });
{
	await enqueueFeedback(entry('held'));
	const sent = await flushFeedbackQueue({ shareAnonymous: false, serverEndpoint: 'x' }, async () => {
		throw new Error('must not be called');
	});
	assert.equal(sent, 0);
	assert.equal((await queued()).length, 1, 'still queued for when sharing is turned on');
}

console.log('✅ feedback queue tests passed');
