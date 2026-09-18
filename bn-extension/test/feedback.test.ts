/**
 * Feedback client. Two shapes of statement: a **tag edit** (`module`, `chunk`, and `page`,
 * where the user corrects our tags directly) and a **thumb** (`summary` and `chunker`,
 * whose output has no tags). Plus the derived localId that makes a correction an update rather
 * than a second row. See specs/feedback.md.
 */

import assert from 'node:assert/strict';
import {
	buildFeedbackSubmission,
	editableTags,
	feedbackLocalId,
	isFeedbackEnabled,
	MAX_FEEDBACK_MESSAGE_LENGTH,
} from '../src/feedback/feedback-client.js';
import type { FeedbackPayload } from '../src/feedback/feedback-client.js';
import { issuesForTarget, issueLabel, OTHER_ISSUE_ID } from '../src/feedback/feedback-issues.js';
import { tagsForModule } from '../src/features/module-tags.js';
import { DEFAULT_SERVER_ENDPOINT, mergeSettings } from '../src/settings/modules-esm.js';
import { ANALYSIS_MODULE_IDS } from '../src/features/registry.js';
import type { FeedbackSubmission } from '../src/types/Feedback.js';

assert.equal(isFeedbackEnabled({ shareAnonymous: false, serverEndpoint: 'http://x' }), false);
assert.equal(isFeedbackEnabled({ shareAnonymous: true, serverEndpoint: '' }), false);
assert.equal(isFeedbackEnabled({ shareAnonymous: true, serverEndpoint: 'http://localhost:3001' }), true);

// Opting in to sharing has to be enough: a blank endpoint used to leave feedback off with
// nothing in the UI to say so, so mergeSettings supplies the server.
assert.equal(mergeSettings({}).serverEndpoint, DEFAULT_SERVER_ENDPOINT);
assert.equal(mergeSettings({ serverEndpoint: '' }).serverEndpoint, DEFAULT_SERVER_ENDPOINT);
assert.equal(mergeSettings({ serverEndpoint: '  ' }).serverEndpoint, DEFAULT_SERVER_ENDPOINT);
assert.equal(
	mergeSettings({ serverEndpoint: 'http://localhost:3001' }).serverEndpoint,
	'http://localhost:3001',
	'an endpoint the user set wins'
);
assert.equal(isFeedbackEnabled(mergeSettings({ shareAnonymous: true })), true);
assert.equal(isFeedbackEnabled(mergeSettings({})), false, 'sharing stays opt-in');

// --- every analysis module declares a tag vocabulary, or its card has no feedback ---

for (const moduleId of ANALYSIS_MODULE_IDS) {
	const tags = tagsForModule(moduleId);
	assert.ok(tags.length, `${moduleId} needs a {module}-tags.ts vocabulary`);
	assert.equal(new Set(tags.map((t) => t.id)).size, tags.length, `${moduleId} tag ids are unique`);
	for (const spec of tags) assert.ok(spec.label, `${moduleId}:${spec.id} needs a label`);
}
assert.deepEqual(tagsForModule('nonsense'), [], 'unknown modules offer nothing');

assert.ok(editableTags('module', 'clickUnbait').some((t) => t.id === 'clickbait'));
assert.ok(editableTags('chunk').some((t) => t.id === 'chunk-type:article'));
assert.deepEqual(editableTags('summary'), [], 'the summary has no tags of its own');
assert.deepEqual(editableTags('chunker'), []);
assert.ok(editableTags('page').some((t) => t.id === 'page-type:article'));
assert.ok(
	!editableTags('page').some((t) => t.id === 'page-type:unknown'),
	'"unknown" is our answer, not a correction a user makes'
);

// --- preset issues: thumb targets only ---

assert.deepEqual(issuesForTarget('module'), [], 'module feedback is tag editing, not presets');
assert.deepEqual(issuesForTarget('page'), [], 'so is the page-type row');
for (const target of ['summary', 'chunker', 'chunk'] as const) {
	const issues = issuesForTarget(target);
	assert.ok(issues.length >= 3, `${target} needs presets`);
	assert.equal(issues[issues.length - 1].id, OTHER_ISSUE_ID, `${target} ends with Other`);
	assert.equal(new Set(issues.map((i) => i.id)).size, issues.length, `${target} ids are unique`);
}
assert.equal(issueLabel('chunk', 'not-a-chunk'), "This shouldn't be a chunk");
assert.ok(
	!issuesForTarget('chunk').some((i) => i.id === 'wrong-tag'),
	'"Wrong tag" is superseded by editing the tag itself'
);

// --- helpers ---

const CHUNK = {
	chunkFingerprint: 'abc',
	chunkUrl: 'https://example.com/article',
	pageUrl: 'https://example.com/article',
};
const MODULE = { target: 'module' as const, moduleId: 'clickUnbait', ...CHUNK };

const build = (payload: Partial<FeedbackPayload>, userId = 'user-1') =>
	buildFeedbackSubmission({ target: 'summary', ...payload } as FeedbackPayload, userId);

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

// --- tag edits are ground truth, with nothing inferred ---

// The x on a tag we applied: it does not belong.
const removed = await ok({ ...MODULE, tag: 'clickbait', tagOn: false, problemScore: 0.8 });
assert.equal(removed.tag, 'clickbait');
assert.equal(removed.tagOn, false);
assert.equal(removed.thumbsUp, undefined, 'a tag edit is not a thumb');
assert.equal(removed.retracted, undefined);
assert.equal(removed.moduleId, 'clickUnbait');
// The band we claimed, for weighing the correction. 0.8 came in as a fraction and is
// bucketed on the way to storage — see the problemScore block below.
assert.equal(removed.problemScore, 'high', 'what we claimed, for weighing the correction');

// "+" then picking a tag: we missed it.
const added = await ok({ ...MODULE, tag: 'clickbait', tagOn: true });
assert.equal(added.tagOn, true);

/*
 * The reading of a tag edit must not depend on the module's own verdict — that dependency
 * is what made thumbs ambiguous. A benign primary tag is the case that used to invert:
 * agreeing there is no bias has to record bias:neutral as ON.
 */
const neutral = await ok({
	target: 'module',
	moduleId: 'biasDetector',
	tag: 'bias:neutral',
	tagOn: true,
	problemScore: 0.05,
	...CHUNK,
});
assert.equal(neutral.tag, 'bias:neutral');
assert.equal(neutral.tagOn, true, 'a low-scoring module does not flip its own tag edit');

const verified = await ok({
	target: 'module',
	moduleId: 'factChecker',
	tag: 'verified-claims',
	tagOn: true,
	problemScore: 0.05,
	...CHUNK,
});
assert.equal(verified.tagOn, true);

// The chunk's own tags are editable the same way.
const chunkTag = await ok({ target: 'chunk', tag: 'advert', tagOn: true, ...CHUNK });
assert.equal(chunkTag.tag, 'advert');
assert.equal(chunkTag.tagOn, true);
assert.equal(chunkTag.thumbsUp, undefined);

// --- a tag edit is checked against the vocabulary that was on offer ---

assert.match(
	await errorOf({ ...MODULE, tag: 'ragebait', tagOn: false }),
	/Tag not offered here/,
	"a module cannot be told about another module's tag"
);
assert.match(
	await errorOf({ target: 'chunk', tag: 'clickbait', tagOn: true, ...CHUNK }),
	/Tag not offered here/
);
assert.match(
	await errorOf({ target: 'summary', tag: 'clickbait', tagOn: true, ...CHUNK }),
	/no editable tags/
);
assert.match(await errorOf({ ...MODULE, tag: 'clickbait' }), /needs tagOn/);
assert.match(
	await errorOf({ target: 'module', moduleId: 'nonsense', tag: 'clickbait', tagOn: true, ...CHUNK }),
	/no editable tags/
);

// --- thumbs, for the output that has no tags ---

const summary = await ok({ target: 'summary', thumbsUp: false, ...CHUNK });
assert.equal(summary.thumbsUp, false);
assert.equal(summary.tag, undefined, 'a thumb names no tag');
assert.equal(summary.retracted, false, 'explicit, so voting again is not still a withdrawal');
assert.equal(summary.issueId, null, 'and a fresh thumb drops the previous complaint');
assert.equal(summary.message, null);

const withIssue = await ok({
	target: 'summary',
	thumbsUp: false,
	issueId: 'score-too-high',
	...CHUNK,
});
assert.equal(withIssue.issueId, 'score-too-high', 'the follow-up keeps the issue it sets');

const retracted = await ok({ target: 'summary', thumbsUp: true, retracted: true, ...CHUNK });
assert.equal(retracted.retracted, true);

// The chunk target keeps its thumb: no tag edit can say "this shouldn't be a chunk".
const chunkThumb = await ok({ target: 'chunk', thumbsUp: false, issueId: 'not-a-chunk', ...CHUNK });
assert.equal(chunkThumb.thumbsUp, false);
assert.equal(chunkThumb.issueId, 'not-a-chunk');

// The module card has no thumb, on either side of the wire.
assert.match(await errorOf({ ...MODULE, thumbsUp: false }), /module feedback is a tag edit/i);
assert.match(await errorOf({ target: 'summary', ...CHUNK }), /needs a thumb or a tag edit/);

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

// --- the page-type tag: about the page, so no chunk is needed ---

const PAGE_URL = 'https://example.com/checkout';
const pageTag = await ok({
	target: 'page',
	tag: 'page-type:checkout',
	tagOn: true,
	pageUrl: PAGE_URL,
});
assert.equal(pageTag.tag, 'page-type:checkout');
assert.equal(pageTag.tagOn, true);
assert.equal(pageTag.pageUrl, PAGE_URL);
assert.equal(pageTag.chunkFingerprint, undefined, 'a page type is not about one chunk');
assert.equal(pageTag.thumbsUp, undefined);

// Correcting a type is two statements: the old value withdrawn, the new one asserted. Each
// keys its own record, so both survive.
const pageTagOff = await ok({
	target: 'page',
	tag: 'page-type:article',
	tagOn: false,
	pageUrl: PAGE_URL,
});
assert.equal(pageTagOff.tagOn, false);
assert.notEqual(pageTagOff.localId, pageTag.localId);

// A page type we never offered is a caller bug, and so is a thumb here.
assert.match(
	await errorOf({ target: 'page', tag: 'page-type:nonsense', tagOn: true, pageUrl: PAGE_URL }),
	/Tag not offered here/
);
assert.match(
	await errorOf({ target: 'page', tag: 'chunk-type:article', tagOn: true, pageUrl: PAGE_URL }),
	/Tag not offered here/
);
assert.match(await errorOf({ target: 'page', thumbsUp: true, pageUrl: PAGE_URL }), /tag edit/);
assert.match(
	await errorOf({ target: 'page', tag: 'page-type:article', tagOn: true }),
	/page context/,
	'the page url is the whole subject'
);

// --- every target records the page it came from ---

for (const s of [summary, chunkTag, removed]) {
	assert.equal(s.pageUrl, CHUNK.pageUrl, `${s.target} knows which page it came from`);
}

// --- the localId keys one statement, and the tag is part of the statement ---

const idOf = (extra: Record<string, unknown>) =>
	feedbackLocalId({
		userId: 'user-1',
		target: 'module',
		moduleId: 'clickUnbait',
		chunkFingerprint: 'abc',
		...extra,
	});

assert.equal(await idOf({ tag: 'clickbait' }), await idOf({ tag: 'clickbait' }), 'same statement, same id');
// Removing a tag then re-adding it is the same statement corrected, so it is one row.
assert.equal(removed.localId, added.localId, 're-adding a removed tag updates that row');

for (const differs of [
	{ tag: 'urgency' },
	{ userId: 'user-2' },
	{ target: 'chunk' as const },
	{ moduleId: 'factChecker' },
	{ chunkFingerprint: 'def' },
]) {
	assert.notEqual(
		await idOf({ tag: 'clickbait' }),
		await idOf({ tag: 'clickbait', ...differs }),
		`${JSON.stringify(differs)} is a different statement`
	);
}
// Two tags edited on one module are independent corrections, not one overwriting the other.
const editA = await ok({ ...MODULE, moduleId: 'antiManipulation', tag: 'urgency', tagOn: false });
const editB = await ok({ ...MODULE, moduleId: 'antiManipulation', tag: 'fear', tagOn: true });
assert.notEqual(editA.localId, editB.localId);
assert.ok(editA.localId.startsWith('fb-'));

// A thumb and a tag edit on the same chunk are different statements too.
assert.notEqual(chunkThumb.localId, chunkTag.localId);

// Chunker feedback has no chunk, so the page is the subject.
assert.notEqual(
	await feedbackLocalId({ userId: 'u', target: 'chunker', pageUrl: 'https://a.com' }),
	await feedbackLocalId({ userId: 'u', target: 'chunker', pageUrl: 'https://b.com' })
);

// --- remaining validation ---

assert.match(await errorOf({ target: 'nonsense' as any }), /Unknown feedback target/);
assert.match(await errorOf({ target: 'chunker', thumbsUp: true }), /page context/);
assert.match(await errorOf({ target: 'summary', thumbsUp: true }), /chunk context/);
assert.match(
	await errorOf({
		target: 'summary',
		thumbsUp: false,
		message: 'x'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 1),
		...CHUNK,
	}),
	/too long/
);

// problemScore is stored as a band: the enum is the vocabulary, and a finer band added
// later must not mean re-bucketing what is already stored (types/Feedback.ts).
{
	const band = await ok({ ...CHUNK, thumbsUp: true, problemScore: 'high' });
	assert.equal(band.problemScore, 'high', 'a band is stored as sent');

	const fraction = await ok({ ...CHUNK, thumbsUp: true, problemScore: 0.9 });
	assert.equal(fraction.problemScore, 'high', 'a fraction from an older caller is bucketed');

	const low = await ok({ ...CHUNK, thumbsUp: true, problemScore: 0.1 });
	assert.equal(low.problemScore, 'low');

	const none = await ok({ ...CHUNK, thumbsUp: true });
	assert.equal(none.problemScore, undefined, 'absent stays absent rather than becoming low');
}

console.log('✅ feedback tests passed');
