/**
 * The Fact Checker card lists what it looked at.
 *
 * The finding "we checked these claims and nobody has rated them" needs both halves:
 * factCheckContent has to keep an entry for every claim it looked up, matched or not
 * (`metadata.factChecks` is a ClaimCheck[]), and the Content Analysis modal has to render
 * them. Before this, only matched claims survived, so a chunk with no coverage showed a
 * bare "No fact-checks found" and never said what the claims were.
 *
 * See specs/fact-checker.md and specs/content-analysis-modal.md.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { factCheckContent } from '../src/features/fact-checker/factcheck-google.js';

const CLAIMED = 'According to experts, the water supply is entirely safe to drink';
const UNCLAIMED = 'Studies show that nobody has ever fact-checked this particular line';
const TEXT = `${CLAIMED}. ${UNCLAIMED}.`;

const originalFetch = globalThis.fetch;

/** @param matchQueries substrings of a query that should come back with a fact-check */
function stubFetch(matchQueries: string[], { fail = false } = {}) {
  globalThis.fetch = (async (url: string) => {
    if (fail) return { ok: false, status: 500, statusText: 'Server Error', text: async () => 'boom' };
    const query = new URL(String(url)).searchParams.get('query') || '';
    const matched = matchQueries.some((q) => query.includes(q));
    return {
      ok: true,
      status: 200,
      json: async () =>
        matched
          ? {
              claims: [
                {
                  text: query,
                  claimant: 'A source',
                  claimReview: [
                    {
                      publisher: { name: 'PolitiFact' },
                      url: 'https://politifact.com/1',
                      title: 'We looked into it',
                      textualRating: 'False',
                    },
                  ],
                },
              ],
            }
          : {},
    };
  }) as unknown as typeof fetch;
}

// --- factCheckContent keeps every claim ------------------------------------------------

stubFetch([]);
const none = await factCheckContent({ text: TEXT }, {}, { apiKey: 'k' });
const noneChecks = none.metadata?.factChecks as any[];
assert.equal(noneChecks.length, 2, 'both claims listed even though neither matched');
assert.deepEqual(
  noneChecks.map((c) => c.status),
  ['unverified', 'unverified']
);
assert.ok(
  noneChecks.every((c) => c.claim && c.factChecks.length === 0),
  'each entry carries its claim text and no reviews'
);
assert.equal(none.metadata?.claimsChecked, 2);
assert.equal(none.metadata?.factChecksFound, 0);
assert.equal(none.problemScore, 'low', 'finding nothing is not evidence of a false claim');
assert.ok(!none.tags?.some((t: any) => t.tag === 'suspect-claim' || t === 'suspect-claim'));
// The old wording never said a search had happened, let alone how much of one.
assert.match(String(none.explanation), /Checked 2 claims/);

stubFetch([CLAIMED]);
const some = await factCheckContent({ text: TEXT }, {}, { apiKey: 'k' });
const someChecks = some.metadata?.factChecks as any[];
assert.equal(someChecks.length, 2, 'the unmatched claim is not dropped');
assert.deepEqual(
  someChecks.map((c) => c.status),
  ['checked', 'unverified']
);
assert.equal(some.metadata?.factChecksFound, 1, 'only the matched claim counts as found');
assert.equal(someChecks[0].factChecks[0].claimReview[0].textualRating, 'False');

// A lookup that fails is not the same as a claim nobody has rated.
stubFetch([], { fail: true });
const broken = await factCheckContent({ text: TEXT }, {}, { apiKey: 'k' });
const brokenChecks = broken.metadata?.factChecks as any[];
assert.deepEqual(
  brokenChecks.map((c) => c.status),
  ['error', 'error']
);
assert.match(String(broken.explanation), /Could not reach fact-check sources/);

globalThis.fetch = originalFetch;

const noKey = await factCheckContent({ text: TEXT }, {}, { apiKey: '' });
assert.equal(noKey.metadata?.diagnostic, 'no_api_key');
assert.equal(noKey.problemScore, 'low', 'a missing key must not label the chunk Caution');

// --- the modal renders them ------------------------------------------------------------

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/a' });
Object.assign(globalThis as any, {
  window: dom.window,
  document: dom.window.document,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  KeyboardEvent: dom.window.KeyboardEvent,
  chrome: { runtime: { sendMessage: async () => ({ ok: true }) }, storage: { sync: { get: async () => ({}) } } },
});

const { showContentAnalysisModal } = await import('../src/content/content-analysis-modal.js');

showContentAnalysisModal({
  fingerprint: 'fp-1',
  url: 'https://example.com/a',
  analyses: [
    {
      id: 'fc1',
      methodName: 'factChecker',
      model: 'google',
      problemScore: 'medium',
      confidence: 0.3,
      tags: [{ tag: 'suspect-claim', strength: 'medium', confidence: 0.6 }],
      explanation: String(some.explanation),
      metadata: { moduleId: 'factChecker', ...(some.metadata as object) },
    } as any,
  ],
});

const modalText = dom.window.document.getElementById('betternet-detail-modal')!.textContent!;
assert.match(modalText, /Claims checked \(2\)/);
assert.ok(modalText.includes(CLAIMED.slice(0, 60)), 'the matched claim is shown');
assert.ok(modalText.includes(UNCLAIMED.slice(0, 60)), 'the unmatched claim is shown too');
assert.match(modalText, /Not fact-checked/, 'and is labelled as such');
assert.match(modalText, /PolitiFact/, 'the review behind the matched claim is shown');

// Feedback is off here, so the modal has to say why rather than render an empty gap.
assert.match(modalText, /Share anonymous analysis data/);

console.log('✅ factcheck claims tests passed');
