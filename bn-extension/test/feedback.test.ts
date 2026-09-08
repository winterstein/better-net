/**
 * Feedback client: what each target requires, and the localId that makes a follow-up
 * an update rather than a second row. See specs/feedback.md.
 */

import assert from 'node:assert/strict';
import { moduleToAspect, MODULE_ASPECT_MAP } from '../src/feedback/aspect-map.js';
import {
	buildFeedbackSubmission,
	isFeedbackEnabled,
	newFeedbackLocalId,
	MAX_FEEDBACK_MESSAGE_LENGTH,
} from '../src/feedback/feedback-client.js';
import { issuesForTarget, issueLabel, OTHER_ISSUE_ID } from '../src/feedback/feedback-issues.js';
import { AspectType } from '../src/types/AspectAnalysis.js';

assert.equal(moduleToAspect('factChecker'), AspectType.ACCURACY);
assert.equal(moduleToAspect('biasDetector'), AspectType.BIAS);
assert.equal(moduleToAspect('defuseRagebait'), AspectType.TOXICITY);
assert.equal(moduleToAspect('clickUnbait'), AspectType.CLICKBAIT);
assert.equal(moduleToAspect('unknown'), undefined);
assert.ok(Object.keys(MODULE_ASPECT_MAP).length >= 5);

assert.equal(isFeedbackEnabled({ shareAnonymous: false, serverEndpoint: 'http://x' }), false);
assert.equal(isFeedbackEnabled({ shareAnonymous: true, serverEndpoint: '' }), false);
assert.equal(isFeedbackEnabled({ shareAnonymous: true, serverEndpoint: 'http://localhost:3001' }), true);

// --- preset issue lists ---

for (const target of ['summary', 'aspect', 'chunker', 'chunk'] as const) {
	const issues = issuesForTarget(target);
	assert.ok(issues.length >= 3, `${target} needs presets`);
	assert.equal(issues[issues.length - 1].id, OTHER_ISSUE_ID, `${target} ends with Other`);
	assert.equal(new Set(issues.map((i) => i.id)).size, issues.length, `${target} ids are unique`);
}
// "Does not apply" is phrased in the user's words, per module.
assert.equal(issueLabel('aspect', 'not-applicable', 'clickUnbait'), "This isn't clickbait");
assert.equal(issueLabel('aspect', 'not-applicable'), 'Does not apply');
assert.equal(issueLabel('chunk', 'not-a-chunk'), "This shouldn't be a chunk");

// --- aspect feedback (the v1 shape) ---

const localId = newFeedbackLocalId();
assert.ok(localId.length > 8);

const aspect = buildFeedbackSubmission(
	{
		localId,
		target: 'aspect',
		chunkFingerprint: 'abc',
		chunkUrl: 'https://example.com',
		moduleId: 'factChecker',
		applies: false,
		problemScore: 0.8,
		traceId: 'a'.repeat(32),
		spanId: 'b'.repeat(16),
	},
	'user-1'
);
assert.ok(!('error' in aspect));
assert.equal(aspect.aspectType, AspectType.ACCURACY);
assert.equal(aspect.applies, false);
assert.equal(aspect.localId, localId);
assert.equal(aspect.traceId, 'a'.repeat(32));
assert.equal(aspect.spanId, 'b'.repeat(16));

// A follow-up issue reuses the localId, so the server updates one row.
const followUp = buildFeedbackSubmission(
	{
		localId,
		target: 'aspect',
		chunkFingerprint: 'abc',
		chunkUrl: 'https://example.com',
		moduleId: 'factChecker',
		applies: false,
		issueId: 'overstated',
		issueLabel: 'Overstated',
	},
	'user-1'
);
assert.ok(!('error' in followUp));
assert.equal(followUp.localId, localId);
assert.equal(followUp.issueId, 'overstated');

// --- the other three targets ---

const summary = buildFeedbackSubmission(
	{
		localId: newFeedbackLocalId(),
		target: 'summary',
		chunkFingerprint: 'abc',
		chunkUrl: 'https://example.com',
		applies: false,
		issueId: 'score-too-high',
		problemScore: 0.9,
	},
	'user-1'
);
assert.ok(!('error' in summary));
assert.equal(summary.aspectType, undefined, 'summary feedback has no aspect');
assert.equal(summary.problemScore, 0.9);

const chunk = buildFeedbackSubmission(
	{
		localId: newFeedbackLocalId(),
		target: 'chunk',
		chunkFingerprint: 'abc',
		chunkUrl: 'https://example.com',
		applies: false,
		issueId: 'not-a-chunk',
	},
	'user-1'
);
assert.ok(!('error' in chunk));

// Chunker feedback is about the page: no chunk needed, page url required.
const chunker = buildFeedbackSubmission(
	{
		localId: newFeedbackLocalId(),
		target: 'chunker',
		applies: false,
		issueId: 'missed-content',
		pageUrl: 'https://example.com/feed',
		chunkCount: 12,
	},
	'user-1'
);
assert.ok(!('error' in chunker));
assert.equal(chunker.chunkCount, 12);
assert.equal(chunker.chunkFingerprint, undefined);

assert.ok(
	'error' in
		buildFeedbackSubmission(
			{ localId: newFeedbackLocalId(), target: 'chunker', applies: true },
			'user-1'
		),
	'chunker feedback without a page url is rejected'
);

// --- validation ---

const badTarget = buildFeedbackSubmission(
	{ localId: 'x', target: 'nonsense' as any, applies: true },
	'user-1'
);
assert.ok('error' in badTarget);

assert.ok('error' in buildFeedbackSubmission({ localId: '', target: 'summary', applies: true }, 'u'));

assert.ok(
	'error' in
		buildFeedbackSubmission(
			{
				localId: newFeedbackLocalId(),
				target: 'summary',
				chunkFingerprint: 'abc',
				chunkUrl: 'https://example.com',
				applies: false,
				message: 'x'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 1),
			},
			'user-1'
		)
);

assert.ok(
	'error' in
		buildFeedbackSubmission(
			{
				localId: newFeedbackLocalId(),
				target: 'aspect',
				chunkFingerprint: 'abc',
				chunkUrl: 'https://example.com',
				moduleId: 'notAModule',
				applies: true,
			},
			'user-1'
		),
	'aspect feedback needs a known module'
);

// Retracting keeps the record; the vote is what is withdrawn.
const retracted = buildFeedbackSubmission(
	{
		localId,
		target: 'summary',
		chunkFingerprint: 'abc',
		chunkUrl: 'https://example.com',
		applies: true,
		retracted: true,
	},
	'user-1'
);
assert.ok(!('error' in retracted));
assert.equal(retracted.retracted, true);

console.log('✅ feedback tests passed');
