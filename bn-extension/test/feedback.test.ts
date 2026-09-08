/**
 * Feedback client: what each target requires, the ground truth a thumb turns into, and
 * the derived localId that makes a follow-up an update rather than a second row.
 * See specs/feedback.md.
 */

import assert from 'node:assert/strict';
import {
	buildFeedbackSubmission,
	feedbackLocalId,
	isFeedbackEnabled,
	MAX_FEEDBACK_MESSAGE_LENGTH,
} from '../src/feedback/feedback-client.js';
import type { FeedbackPayload } from '../src/feedback/feedback-client.js';
import { issuesForTarget, issueLabel, OTHER_ISSUE_ID } from '../src/feedback/feedback-issues.js';
import { primaryTagForModule, MODULE_PRIMARY_TAG } from '../src/types/ModuleAnalysis.js';
import type { FeedbackSubmission } from '../src/types/Feedback.js';

assert.equal(primaryTagForModule('clickUnbait'), 'clickbait');
assert.equal(primaryTagForModule('factChecker', ['false-claim']), 'false-claim');
assert.equal(primaryTagForModule('unknown'), undefined);
assert.ok(Object.keys(MODULE_PRIMARY_TAG).length >= 5);

assert.equal(isFeedbackEnabled({ shareAnonymous: false, serverEndpoint: 'http://x' }), false);
assert.equal(isFeedbackEnabled({ shareAnonymous: true, serverEndpoint: '' }), false);
assert.equal(isFeedbackEnabled({ shareAnonymous: true, serverEndpoint: 'http://localhost:3001' }), true);

// --- preset issue lists ---

for (const target of ['summary', 'module', 'chunker', 'chunk'] as const) {
	const issues = issuesForTarget(target);
	assert.ok(issues.length >= 3, `${target} needs presets`);
	assert.equal(issues[issues.length - 1].id, OTHER_ISSUE_ID, `${target} ends with Other`);
	assert.equal(new Set(issues.map((i) => i.id)).size, issues.length, `${target} ids are unique`);
}
// "Does not apply" is phrased in the user's words, per module.
assert.equal(issueLabel('module', 'not-applicable', 'clickUnbait'), "This isn't clickbait");
assert.equal(issueLabel('module', 'not-applicable'), 'Does not apply');
assert.equal(issueLabel('chunk', 'not-a-chunk'), "This shouldn't be a chunk");

// --- helpers ---

const CHUNK = {
	chunkFingerprint: 'abc',
	chunkUrl: 'https://example.com/article',
	pageUrl: 'https://example.com/article',
};

async function build(payload: Partial<FeedbackPayload>, userId = 'user-1') {
	const built = await buildFeedbackSubmission(
		{ target: 'summary', thumbsUp: true, ...payload } as FeedbackPayload,
		userId
	);
	return built;
}

async function ok(payload: Partial<FeedbackPayload>, userId = 'user-1'): Promise<FeedbackSubmission> {
	const built = await build(payload, userId);
	assert.ok(!('error' in built), `expected a submission, got ${JSON.stringify(built)}`);
	return built as FeedbackSubmission;
}

const errorOf = async (payload: Partial<FeedbackPayload>) => {
	const built = await build(payload);
	assert.ok('error' in built, `expected a rejection, got ${JSON.stringify(built)}`);
	return (built as { error: string }).error;
};

// --- the localId is derived, so the same rating always lands on the same row ---

const idParts = { userId: 'user-1', target: 'module' as const, moduleId: 'clickUnbait', chunkFingerprint: 'abc' };
assert.equal(await feedbackLocalId(idParts), await feedbackLocalId(idParts), 'same rating, same id');
assert.notEqual(
	await feedbackLocalId(idParts),
	await feedbackLocalId({ ...idParts, userId: 'user-2' }),
	'one row per user, not per chunk'
);
for (const differs of [
	{ target: 'chunk' as const },
	{ moduleId: 'factChecker' },
	{ chunkFingerprint: 'def' },
]) {
	assert.notEqual(
		await feedbackLocalId(idParts),
		await feedbackLocalId({ ...idParts, ...differs }),
		`${JSON.stringify(differs)} is a different thing to rate`
	);
}
// Chunker feedback has no chunk, so the page is the subject.
assert.notEqual(
	await feedbackLocalId({ userId: 'u', target: 'chunker', pageUrl: 'https://a.com' }),
	await feedbackLocalId({ userId: 'u', target: 'chunker', pageUrl: 'https://b.com' })
);

// A thumb and the preset issue that follows derive the same id, so one thumbs down is one row.
const thumb = await ok({ target: 'module', thumbsUp: false, moduleId: 'clickUnbait', problemScore: 0.8, ...CHUNK });
const followUp = await ok({
	target: 'module',
	thumbsUp: false,
	moduleId: 'clickUnbait',
	problemScore: 0.8,
	issueId: 'overstated',
	issueLabel: 'Overstated',
	...CHUNK,
});
assert.equal(followUp.localId, thumb.localId);
assert.equal(followUp.issueId, 'overstated');
assert.ok(thumb.localId.startsWith('fb-'));

// --- a thumb clears what the previous one collected ---

assert.equal(thumb.issueId, null, 'a thumb wipes the stored issue');
assert.equal(thumb.issueLabel, null);
assert.equal(thumb.message, null, 'and the stored note');
assert.equal(thumb.retracted, false, 'and is explicit that it is not a retraction');
// The follow-up must not wipe the issue it is itself setting.
assert.equal(followUp.retracted, false);

// --- thumbs become ground truth: tag X is on / off ---

const flagged = { target: 'module' as const, moduleId: 'clickUnbait', problemScore: 0.8, ...CHUNK };
const unflagged = { ...flagged, problemScore: 0.05 };

// 👍 on "this is clickbait" and 👎 on "this is not clickbait" both mean clickbait is on.
assert.equal((await ok({ ...flagged, thumbsUp: true })).tagOn, true);
assert.equal((await ok({ ...unflagged, thumbsUp: false })).tagOn, true);
// And the other way round.
assert.equal((await ok({ ...flagged, thumbsUp: false })).tagOn, false);
assert.equal((await ok({ ...unflagged, thumbsUp: true })).tagOn, false);

const module = await ok({ ...flagged, thumbsUp: false });
assert.equal(module.tag, 'clickbait', 'the tag being judged');
assert.equal(module.moduleId, 'clickUnbait');
assert.equal(module.thumbsUp, false, 'the raw click is kept too');
assert.equal(module.problemScore, 0.8, 'what we claimed, so a borderline score is recoverable');

// Retracting withdraws the rating, so there is no ground truth left to record.
const retracted = await ok({ ...flagged, thumbsUp: false, retracted: true });
assert.equal(retracted.retracted, true);
assert.equal(retracted.tagOn, null, 'a withdrawn rating asserts nothing about the tag');

// Only the module target judges a single tag; the rest rate our output as a whole.
for (const target of ['summary', 'chunk'] as const) {
	const other = await ok({ target, thumbsUp: false, ...CHUNK });
	assert.equal(other.tag, undefined, `${target} feedback is not about one tag`);
	assert.equal(other.tagOn, undefined);
}

// --- every target records the page it came from ---

const chunk = await ok({ target: 'chunk', thumbsUp: false, issueId: 'not-a-chunk', ...CHUNK });
assert.equal(chunk.pageUrl, CHUNK.pageUrl, 'chunk feedback knows which page it was given on');
assert.equal((await ok({ target: 'summary', thumbsUp: true, ...CHUNK })).pageUrl, CHUNK.pageUrl);
assert.equal(
	(await ok({ ...flagged, thumbsUp: true })).pageUrl,
	CHUNK.pageUrl,
	'module feedback too'
);

// Chunker feedback is about the page: no chunk needed, page url required.
const chunker = await ok({
	target: 'chunker',
	thumbsUp: false,
	issueId: 'missed-content',
	pageUrl: 'https://example.com/feed',
	chunkCount: 12,
});
assert.equal(chunker.chunkCount, 12);
assert.equal(chunker.chunkFingerprint, undefined);
assert.equal(chunker.pageUrl, 'https://example.com/feed');

const summary = await ok({
	target: 'summary',
	thumbsUp: false,
	issueId: 'score-too-high',
	problemScore: 0.9,
	...CHUNK,
});
assert.equal(summary.moduleId, undefined, 'summary feedback has no module');
assert.equal(summary.problemScore, 0.9);

// --- validation ---

assert.match(await errorOf({ target: 'nonsense' as any }), /Unknown feedback target/);
assert.match(await errorOf({ target: 'chunker' }), /page context/);
assert.match(await errorOf({ target: 'summary' }), /chunk context/);
assert.match(
	await errorOf({ ...CHUNK, message: 'x'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 1) }),
	/too long/
);
assert.match(
	await errorOf({ target: 'module', moduleId: 'notAModule', ...CHUNK }),
	/Unknown analysis module/
);

console.log('✅ feedback tests passed');
