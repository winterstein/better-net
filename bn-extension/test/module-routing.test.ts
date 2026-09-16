/**
 * Content-classification routing tests — which modules run on which chunk
 * (src/features/module-routing.ts, specs/content-classification.md).
 */

import assert from 'node:assert/strict';
import {
	MODULE_ROUTING,
	hardSkipPageReason,
	moduleSkipReason,
	routeChunk,
} from '../src/features/module-routing.js';
import { ANALYSIS_MODULE_IDS } from '../src/features/registry.js';
import { ASSIGNED_CHUNK_ROLES, chunkRole } from '../src/types/Classification.js';
import { TAG } from '../src/chunking/chunk-tags.js';

const ALL = ANALYSIS_MODULE_IDS;

/** Module ids that would run on a chunk, with no page classification. */
function runsOn(tags: string[]): string[] {
	return routeChunk(ALL, { tags }).run;
}

// --- the unknown-role rule: today's generic chunker tags plain prose `other`, so an
// article on a news site must still get every module (regression: an allow-list that
// excluded `other` would silently stop fact-checking ordinary pages) ---

assert.deepEqual(runsOn([TAG.OTHER]), ALL);
assert.deepEqual(runsOn([]), ALL);
assert.deepEqual(routeChunk(ALL, undefined).run, ALL);
assert.deepEqual(runsOn(['chunk-type:nonsense']), ALL);

// --- adverts: no fact-check, no bias, no unbaiting; anti-manipulation still looks ---

assert.deepEqual(runsOn([TAG.POST, TAG.ADVERT]), ['antiManipulation', 'defuseRagebait']);
assert.equal(moduleSkipReason('factChecker', { tags: [TAG.POST, TAG.ADVERT] }), 'modifier:advert');
// `sponsored` is disclosed editorial content, not an ad slot — it stays analyzable.
assert.deepEqual(runsOn([TAG.ARTICLE, TAG.SPONSORED]).includes('factChecker'), true);

// --- roles ---

assert.deepEqual(runsOn([TAG.ARTICLE]), ALL);
assert.deepEqual(runsOn([TAG.POST]), ALL);
assert.deepEqual(runsOn([TAG.COMMENT]), ['factChecker', 'biasDetector', 'defuseRagebait']);
assert.deepEqual(runsOn([TAG.SEARCH_RESULT]), ['factChecker', 'biasDetector', 'clickUnbait']);
assert.deepEqual(runsOn(['chunk-type:form']), ['antiManipulation']);
assert.deepEqual(runsOn(['chunk-type:cta']), ['antiManipulation']);
assert.deepEqual(runsOn(['chunk-type:chrome']), []);
assert.deepEqual(runsOn(['chunk-type:headline_link']), [
	'factChecker',
	'biasDetector',
	'defuseRagebait',
	'clickUnbait',
]);

// A sidebar chunk is claimed by no module. Headline chunks carry [article, sidebar] and the
// first role wins, so they are still analyzed as articles — see chunking-headlines.ts.
assert.deepEqual(runsOn([TAG.SIDEBAR]), []);
assert.equal(chunkRole({ tags: [TAG.ARTICLE, TAG.SIDEBAR] }), 'article');
assert.deepEqual(runsOn([TAG.ARTICLE, TAG.SIDEBAR]), ALL);

// The `media` role — video/audio content — is claimed by nobody.
assert.equal(chunkRole({ tags: ['chunk-type:media'] }), 'media');
assert.deepEqual(runsOn(['chunk-type:media']), []);

// --- page and site type: only act on a classification we believe ---

const login = { pageType: { value: 'login' as const, confidence: 0.95, source: 'dom-shape' } };
assert.equal(hardSkipPageReason(login), 'page:login');
assert.equal(hardSkipPageReason({}), null);
assert.equal(
	hardSkipPageReason({ pageType: { value: 'login', confidence: 0.3, source: 'url-shape' } }),
	null,
	'a low-confidence guess is unknown, not a verdict'
);
assert.equal(hardSkipPageReason({ pageType: { value: 'article', confidence: 1, source: 'jsonld' } }), null);

const profile = { pageType: { value: 'profile' as const, confidence: 0.8, source: 'jsonld' } };
assert.equal(moduleSkipReason('factChecker', { tags: [TAG.POST] }, profile), 'page:profile');
assert.equal(moduleSkipReason('defuseRagebait', { tags: [TAG.POST] }, profile), null);
assert.equal(
	moduleSkipReason(
		'factChecker',
		{ tags: [TAG.POST] },
		{ pageType: { value: 'profile', confidence: 0.4, source: 'jsonld' } }
	),
	null
);

// --- matrix invariants ---

// Every module in the registry is routed, and every routed id is a real module.
for (const id of ALL) assert.ok(MODULE_ROUTING[id], `${id} has no routing`);
for (const id of Object.keys(MODULE_ROUTING)) assert.ok(ALL.includes(id), `${id} is not a module`);

// An unrouted module runs everywhere rather than nowhere: a new feature must not be
// silently disabled by forgetting this file.
assert.equal(moduleSkipReason('newFeature', { tags: ['chunk-type:chrome'] }), null);

// No live role may be a skip reason nobody understands: every role the chunker actually
// assigns is either analyzed by someone or deliberately claimed by no-one (chrome/sidebar).
const UNCLAIMED_ROLES = ['sidebar'];
for (const role of ASSIGNED_CHUNK_ROLES) {
	const run = runsOn([`chunk-type:${role}`]);
	if (UNCLAIMED_ROLES.includes(role)) assert.deepEqual(run, [], `${role} should be unclaimed`);
	else assert.ok(run.length, `no module runs on ${role}`);
}

console.log('✓ module-routing tests passed');
