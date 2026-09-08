/**
 * Unit tests for the canned demo dataset: url lookup and the Nutrient Label band each
 * demo page is meant to land in.
 */

import assert from 'node:assert/strict';
import {
  DEMO_LINKS,
  DEMO_PAGES,
  demoAnalyses,
  demoAnalysisForChunk,
  demoChunks,
  demoLinkResultsForChunks,
  demoResultsForChunks,
  findDemoPage,
  normaliseDemoUrl,
  renderDemoPage,
} from '../src/analysis/demo-analysis.js';
import { riskLevelForScore } from '../src/types/RiskLevel.js';
import { chunkProblemScore } from '../src/types/ChunkAnalysis.js';
import { findAnalysisByModule } from '../src/types/ModuleAnalysis.js';
import { applyClickUnbaitFromAnalysis } from '../src/content/apply-click-unbait.js';
import { DEFAULT_MAX_TITLE_LEN } from '../src/features/click-unbait/format-unbait-title.js';

const [sharePost, fakeArticle, statPost, clickbait] = DEMO_PAGES;
const POST_URL = 'https://x.com/drhossamsamy65/status/2047310606361899350';
const ARTICLE_URL =
  'https://thepeoplesvoice.tv/study-bill-gates-lab-grown-meat-causes-cancer-in-humans/';
const STAT_POST_URL = 'https://x.com/realMaalouf/status/2094452781843100052';
const CLICKBAIT_URL =
  'https://www.upworthy.com/harvard-psychiatrist-reveals-the-fastest-way-to-change-your-life-using-just-one-post-it-note/';

// --- lookup ---

assert.equal(normaliseDemoUrl('https://WWW.Example.com/a/b/?utm=x'), 'example.com/a/b');
assert.equal(findDemoPage(POST_URL), sharePost);
assert.equal(findDemoPage(ARTICLE_URL), fakeArticle);
assert.equal(findDemoPage(STAT_POST_URL), statPost);
assert.equal(findDemoPage(CLICKBAIT_URL), clickbait);
// Tracking params and a trailing slash must not lose the match
assert.equal(findDemoPage(POST_URL + '?s=20&t=abc'), sharePost);
// Offline mirror, on any local port
assert.equal(findDemoPage('http://127.0.0.1:9999/fake-news-article.html'), fakeArticle);
assert.equal(findDemoPage('https://example.com/other'), undefined);
assert.equal(findDemoPage(''), undefined);

// --- shape ---

assert.equal(sharePost.chunks.length, 1, 'the X post is one chunk');
assert.equal(fakeArticle.chunks.length, 3, 'the article plus its two sidebar teasers');
assert.equal(statPost.chunks.length, 1, 'the fabricated-statistic post is one chunk');
assert.equal(clickbait.chunks.length, 1, 'the clickbait teaser is one chunk');
for (const page of DEMO_PAGES) {
  for (const { chunk, analysis } of page.chunks) {
    assert.equal(analysis.chunkId, chunk.fingerprint);
    assert.equal(analysis.url, page.urls[0]);
    assert.ok(chunk.text.length >= 100, 'chunkers drop content under minTextLength');
    // Every fact-check verdict cites a source the demo can click through to
    for (const a of analysis.analyses) {
      if (a.methodName === 'factChecker') assert.ok(a.url, 'fact-check needs a source link');
    }
  }
}
assert.equal(demoChunks(POST_URL).length, 1);
assert.equal(demoAnalyses(ARTICLE_URL).length, 3);

// The post shares a link to the article that is the other demo page
assert.ok(sharePost.chunks[0].chunk.text.includes(ARTICLE_URL));

// --- the bands the demo script relies on ---
//
// The fake-news examples are High Risk. The clickbait one is Caution on purpose: the story
// behind that headline is true and sincere, only the packaging is manipulative, and a demo
// that scored the two the same would be teaching the wrong thing about what a label means.
const EXPECTED_BAND = [
  [sharePost, 'high-risk'],
  [fakeArticle, 'high-risk'],
  [statPost, 'high-risk'],
  [clickbait, 'caution'],
] as const;
assert.equal(EXPECTED_BAND.length, DEMO_PAGES.length, 'every demo page declares its band');

for (const [page, band] of EXPECTED_BAND) {
  for (const { chunk, analysis } of page.chunks) {
    const score = chunkProblemScore(analysis);
    assert.equal(riskLevelForScore(score).id, band, `${page.title}: ${chunk.title}`);
  }
}

// The article is the "true premise, false conclusion" example: one true statement, one not
const verdicts = fakeArticle.chunks[0].analysis.statements.map((s) => s.analyses[0].tags[0].tag);
assert.deepEqual(verdicts, ['false-claim', 'verified-claims']);

// --- chunk matching against a live-chunked page ---

const article = fakeArticle.chunks[0];
assert.ok(article.chunk.text.includes('lab-grown meat'), 'first chunk is the story itself');
assert.equal(demoAnalysisForChunk(ARTICLE_URL, { title: article.chunk.title }), article.analysis);
assert.equal(demoAnalysisForChunk(ARTICLE_URL, { text: article.chunk.text }), article.analysis);
assert.equal(demoAnalysisForChunk(ARTICLE_URL, { xpath: '/html/body/div' }), undefined);

// The real page's chunk: share counters in front, newlines through the middle
const liveText =
  '4kSHARESX3.8kFacebookLinkedInEmail111RedditTelegram\n' +
  'Bill Gates\u2019 lab-grown meat causes cancer in humans who consume it, according to a disturbing new study. \n\n\n\n' +
  'Synthetic meat has been heavily promoted by Bill Gates and the globalist elites at the WEF as the solution to ' +
  'so-called climate change. However, this same food has now been shown to cause cancer via the immortalized cell ' +
  'lines used to manufacture it.\n\nNaturalnews.com reports: Raw Egg Nationalist (REN) shined a light on this issue.';
assert.equal(demoAnalysisForChunk(ARTICLE_URL, { text: liveText }), article.analysis);
// A different story on the same site is not the demo chunk
assert.equal(
  demoAnalysisForChunk(ARTICLE_URL, {
    text: 'Queen Guitarist Brian May, Who Promoted Covid Vaccines During Pandemic, Unable To Use Arm Following Stroke September 4, 2024 11 Comments. Related posts from The People\u2019s Voice archive, published in 2024 and after.',
  }),
  undefined
);
assert.equal(demoAnalysisForChunk('https://example.com', { title: article.chunk.title }), undefined);

// --- replay onto live chunks (what background.ts serves in demo mode) ---

// The live chunk keeps its own xpath and fingerprint: the on-page label is placed by xpath
const live = { xpath: '/html/body/div[3]/article', fingerprint: 'live-1', title: article.chunk.title };
const [replayed] = demoResultsForChunks(ARTICLE_URL, [live]);
assert.equal(replayed.chunk, live);
assert.equal(replayed.analysis.xpath, live.xpath);
assert.equal(replayed.analysis.fingerprint, 'live-1');
assert.equal(replayed.analysis.chunkId, 'live-1');
assert.equal(replayed.analysis.summary.overallRisk, article.analysis.summary.overallRisk);

// Unrecognised chunks are dropped, not guessed at
assert.equal(demoResultsForChunks(ARTICLE_URL, [live, { xpath: '/html/body/nav', text: 'Menu' }]).length, 1);
// Nothing recognised at all -> fall back to the canned chunks, but without the offline
// mirror's xpaths: on the live page they point at elements that do not exist.
const fallback = demoResultsForChunks(ARTICLE_URL, []);
assert.equal(fallback.length, fakeArticle.chunks.length);
assert.deepEqual(
  fallback.map((r) => r.analysis.title),
  fakeArticle.chunks.map((r) => r.analysis.title)
);
assert.ok(fallback.every((r) => r.chunk.xpath === undefined && r.analysis.xpath === undefined));
// Each verdict is stamped with the page it is for, so a result arriving after the reader has
// navigated away can be told apart from one for the page on screen.
assert.ok(fallback.every((r) => r.analysis.url === ARTICLE_URL));
assert.deepEqual(demoResultsForChunks('https://example.com', [live]), []);

// --- the sidebar teasers on the article page ---

// Chunk text as the page produces it: the editor's-pick card wraps the headline in furniture,
// the spotlight teaser is the bare headline.
const DENZEL_LIVE = {
  xpath: '/html/body/div/div[4]/aside/div[5]/article',
  text:
    'EDITOR’S PICKS Denzel Washington: NYPD Covered-Up Taylor Swift ‘Satanic Sacrifices’ Involving ' +
    'Missing Kids by Baxter Dmitry in News 6 Comments',
};
const SILVERSTONE_LIVE = {
  xpath: '/html/body/div/div[4]/aside/div[3]/div/h4',
  text: "Alicia Silverstone Reveals 4 More Epstein Victims Will Die as 'Sacrifice Season' Rips Through Hollywood",
};
const denzel = demoAnalysisForChunk(ARTICLE_URL, DENZEL_LIVE);
const silverstone = demoAnalysisForChunk(ARTICLE_URL, SILVERSTONE_LIVE);
assert.ok(denzel?.title.includes('Denzel Washington'), 'editor’s-pick teaser matches its canned analysis');
assert.ok(silverstone?.title.includes('Alicia Silverstone'), 'spotlight teaser matches its canned analysis');
assert.equal(denzel.statements[0].analyses[0].tags[0].tag, 'false-claim');
assert.equal(silverstone.statements[0].analyses[0].tags[0].tag, 'false-claim');

// The same headline appears twice on the page (ticker strip and sidebar card): both get
// the verdict, and a container that merely mentions it does not.
const DENZEL_TICKER = { xpath: '/html/body/div/div[3]/div/div/div/div/ul/li[2]', text: 'Denzel Washington: NYPD Covered-Up Taylor Swift ‘Satanic Sacrifices’ Involving Missing Kids' };
const bothDenzel = demoResultsForChunks(ARTICLE_URL, [DENZEL_TICKER, DENZEL_LIVE]);
assert.equal(bothDenzel.length, 2, 'ticker and editor’s-pick instances both labelled');
assert.deepEqual(
  bothDenzel.map((r) => r.analysis.xpath).sort(),
  [DENZEL_LIVE.xpath, DENZEL_TICKER.xpath].sort()
);
const notTheWholePage = demoResultsForChunks(ARTICLE_URL, [
  DENZEL_TICKER,
  { xpath: '/html/body/div/div[4]/aside', text: `Sidebar. ${DENZEL_TICKER.text}. ${'More teasers below. '.repeat(30)}` },
]);
assert.equal(notTheWholePage.length, 1, 'a container that only mentions the headline is not labelled');
assert.equal(notTheWholePage[0].chunk.xpath, DENZEL_TICKER.xpath);

// All three chunks on the page resolve to different analyses, each on its own element
const pageResults = demoResultsForChunks(ARTICLE_URL, [
  { xpath: article.chunk.xpath, text: article.chunk.text },
  DENZEL_LIVE,
  SILVERSTONE_LIVE,
]);
assert.equal(pageResults.length, 3);
assert.equal(new Set(pageResults.map((r) => r.analysis.title)).size, 3, 'no two chunks share an analysis');
assert.deepEqual(
  pageResults.map((r) => r.analysis.xpath),
  [article.chunk.xpath, DENZEL_LIVE.xpath, SILVERSTONE_LIVE.xpath]
);

// --- marker fallback (x.com: the shared link renders as a truncated display URL) ---

const POST_MARKER_CHUNK = {
  xpath: '/html/body/div/div/div/main/article',
  text:
    'Dr.Sam Youssef Ph.D.,Ph.D.,DPT. @drhossamsamy65 · Apr 23 ' +
    'Study: Bill Gates’ Lab Grown Meat Causes Cancer in Humans thepeoplesvoice.tv/study-bill-gate… via @realtpv ' +
    '15 reposts 11 likes',
};
const [postResult] = demoResultsForChunks(POST_URL, [
  { xpath: '/html/body/div/nav', text: 'Home Explore Notifications Messages Bookmarks Profile More Post '.repeat(3) },
  POST_MARKER_CHUNK,
]);
assert.equal(postResult.chunk, POST_MARKER_CHUNK, 'the post chunk matches on its headline marker');
assert.equal(postResult.analysis.xpath, POST_MARKER_CHUNK.xpath);
assert.equal(demoAnalysisForChunk(POST_URL, POST_MARKER_CHUNK), sharePost.chunks[0].analysis);

// One live chunk per canned chunk, and unrelated chunks stay unlabelled
assert.equal(demoResultsForChunks(POST_URL, [POST_MARKER_CHUNK]).length, 1);
assert.equal(
  demoAnalysisForChunk(POST_URL, { text: 'Trending now: football scores, weather warnings and travel news for the weekend ahead.' }),
  undefined
);

// --- clickbait -> rewritten headline ---

const CLICKBAIT_HEADLINE =
  'Harvard psychiatrist reveals ‘the fastest way to change your life’ using just one Post-it note';
const teaser = clickbait.chunks[0];
assert.equal(teaser.chunk.title, CLICKBAIT_HEADLINE);

// The rewrite the content script applies, derived from the live formatter rather than
// hand-written, so the demo cannot drift from what the feature would actually produce.
const unbait = findAnalysisByModule(teaser.analysis.analyses, 'clickUnbait');
assert.ok(unbait, 'the clickbait chunk carries a clickUnbait verdict');
assert.equal(unbait.metadata?.originalTitle, CLICKBAIT_HEADLINE);
assert.equal(unbait.metadata?.hoverTitle, CLICKBAIT_HEADLINE, 'the full headline stays on hover');
assert.equal(unbait.metadata?.destinationUrl, CLICKBAIT_URL);
const displayTitle = String(unbait.metadata?.displayTitle);
assert.ok(
  displayTitle.startsWith('[The note says ‘awareness’] '),
  `the honest summary leads: ${displayTitle}`
);
// The whole headline survives the rewrite. Cutting it short would leave the reader an
// ellipsis to wonder about — a second curiosity gap where we just closed the first.
assert.equal(displayTitle, `[The note says ‘awareness’] ${CLICKBAIT_HEADLINE}`);
assert.ok(!displayTitle.includes('…'), 'nothing withheld by the rewrite itself');
assert.ok(
  CLICKBAIT_HEADLINE.length <= DEFAULT_MAX_TITLE_LEN,
  'a demo headline past the cap would be shown truncated'
);

// The one statement is true. Clickbait is a packaging problem, not a truth problem, and the
// demo is the place that distinction has to be visible.
assert.deepEqual(
  teaser.analysis.statements.map((st) => st.analyses[0].tags[0].tag),
  ['verified-claims']
);

// The mirror renders the headline as an anchor, which is what the rewrite needs to target.
const teaserHtml = renderDemoPage(clickbait);
assert.ok(teaserHtml.includes('class="teaser"'), 'rendered as a link card, not a post');
assert.ok(teaserHtml.includes(`<a href="${CLICKBAIT_URL}">`), 'the headline is a link to the story');

// --- the same headline as a link on somebody else's page ---
//
// This is the case the click-unbait demo exists for: no demo entry matches the page URL, and
// the headline still has to be recognised.
assert.equal(DEMO_LINKS.length, 1);
assert.equal(findDemoPage('https://news.example.com/feed'), undefined, 'not a demo page');

const FEED_URL = 'https://news.example.com/feed';
const feedLink = {
  xpath: '/html/body/div[2]/ul/li[4]',
  title: CLICKBAIT_HEADLINE,
  text: `${CLICKBAIT_HEADLINE} upworthy.com \u00b7 Cecily Knobler \u00b7 1 Sep 2026`,
};
const unrelated = { xpath: '/html/body/div[2]/ul/li[5]', title: 'Council approves the new bypass', text: 'Council approves the new bypass after a four-year inquiry.' };
const [linkResult, ...restOfFeed] = demoLinkResultsForChunks(FEED_URL, [unrelated, feedLink]);
assert.equal(restOfFeed.length, 0, 'only the headline is served from the dataset');
assert.equal(linkResult.chunk, feedLink, 'replayed onto the live chunk, xpath and all');
assert.equal(linkResult.analysis.xpath, feedLink.xpath);
assert.equal(linkResult.analysis.url, FEED_URL, 'stamped with the page it is for');
assert.equal(
  findAnalysisByModule(linkResult.analysis.analyses, 'clickUnbait')?.metadata?.displayTitle,
  displayTitle
);
// No mirror xpath leaks onto a page that has never heard of the mirror.
assert.equal(DEMO_LINKS[0].chunk.xpath, undefined);
assert.equal(DEMO_LINKS[0].analysis.xpath, undefined);

// Matched by a marker phrase too, for a card whose title the chunker did not pick out
assert.equal(
  demoLinkResultsForChunks(FEED_URL, [{ xpath: '/html/body/aside/div', text: `Sponsored: ${CLICKBAIT_HEADLINE}` }]).length,
  1
);
// ...but not a whole feed that merely contains it, which would put the label on the page
assert.equal(
  demoLinkResultsForChunks(FEED_URL, [
    { xpath: '/html/body/div[2]', text: `Today's stories. ${CLICKBAIT_HEADLINE} ${'And nineteen more below. '.repeat(20)}` },
  ]).length,
  0
);
assert.deepEqual(demoLinkResultsForChunks(FEED_URL, [unrelated]), []);
assert.deepEqual(demoLinkResultsForChunks(FEED_URL, []), []);

// End to end: the link on the feed page really is rewritten in the DOM.
const { Window } = await import('happy-dom');
const feedWindow = new Window();
feedWindow.document.body.innerHTML = `
  <ul>
    <li id="teaser"><a href="${CLICKBAIT_URL}">${CLICKBAIT_HEADLINE}</a></li>
    <li id="other"><a href="https://news.example.com/bypass">Council approves the new bypass</a></li>
  </ul>
`;
const teaserEl = feedWindow.document.getElementById('teaser');
assert.equal(applyClickUnbaitFromAnalysis(teaserEl as any, linkResult.analysis), true);
const rewritten = teaserEl!.querySelector('a')!;
assert.equal(rewritten.textContent, displayTitle);
assert.equal(rewritten.getAttribute('title'), CLICKBAIT_HEADLINE, 'the original is one hover away');
assert.equal(rewritten.getAttribute('href'), CLICKBAIT_URL, 'the link still goes to the story');
const otherEl = feedWindow.document.getElementById('other');
assert.equal(
  otherEl!.querySelector('a')!.textContent,
  'Council approves the new bypass',
  'the other links on the page are untouched'
);

// --- canned chunks must not claim an xpath they cannot have ---
//
// buildChunk()'s xpath describes the offline mirror. When the live chunker finds nothing
// (x.com had not rendered yet) the background stands these chunks in — and on the live site
// `/html/body/main/article[1]` is not there, so the label and the popup's highlight both
// aimed at nothing, with only a console warning to show for it.

const cannedLive = demoChunks(POST_URL);
assert.equal(cannedLive.length, 1);
assert.equal(cannedLive[0].xpath, undefined, 'no mirror xpath on the live site');
assert.equal(demoAnalyses(POST_URL)[0].xpath, undefined, 'nor on the analysis');

const cannedMirror = demoChunks('http://localhost:8080/shared-fake-news-post.html');
assert.equal(
  cannedMirror[0].xpath,
  '/html/body/main/article[1]',
  'the mirror renders that DOM, so there the xpath is real'
);
assert.ok(renderDemoPage(sharePost).includes('<article'), 'and the mirror really has an article');

// --- both X examples, against the real pages saved from x.com ---
//
// The rest of this file matches against hand-written chunk text. These two go through the
// actual chunker on the actual saved pages, so a chunking change that stops the label
// landing on the post shows up here.

const { JSDOM } = await import('jsdom');
const { readFileSync } = await import('node:fs');
const { extractChunks } = await import('../src/chunking/chunking.js');

async function labelPage(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  Object.assign(globalThis as any, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    XPathResult: dom.window.XPathResult,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  const chunks = await extractChunks(dom.window.document, url);
  return { dom, results: demoResultsForChunks(url, chunks) };
}

async function labelSavedPage(fixture: string, url: string) {
  const { results } = await labelPage(
    readFileSync(new URL(`../test-data/pages/${fixture}`, import.meta.url), 'utf-8'),
    url
  );
  return results;
}

for (const page of [
  { fixture: 'x.com-post-2.html', url: POST_URL, expect: 'Lab Grown Meat Causes Cancer' },
  { fixture: 'x.com-post.html', url: STAT_POST_URL, expect: 'Out of 50 million Muslims in Europe' },
  { fixture: 'x.com-post-3.html', url: STAT_POST_URL, expect: 'Out of 50 million Muslims in Europe' },
]) {
  const results = await labelSavedPage(page.fixture, page.url);
  assert.equal(results.length, 1, `${page.fixture}: exactly the post is labelled, not the replies`);
  const [labelled] = results;
  assert.ok(
    labelled.chunk.text.includes(page.expect),
    `${page.fixture}: label landed on the wrong chunk: ${labelled.chunk.text.slice(0, 80)}`
  );
  assert.ok(labelled.chunk.xpath, `${page.fixture}: the label has an element to attach to`);
  assert.ok(!labelled.canned, `${page.fixture}: matched the page, rather than falling back`);
  assert.equal(
    riskLevelForScore(chunkProblemScore(labelled.analysis)).id,
    'high-risk',
    `${page.fixture}: should be High Risk`
  );
  // Every verdict cites a published fact-check.
  for (const moduleResult of labelled.analysis.analyses) {
    assert.ok(moduleResult.url?.startsWith('https://'), `${page.fixture}: ${moduleResult.methodName} cites no source`);
  }
}

// --- the clickbait mirror, chunked and rewritten for real ---
//
// The offline mirror is what gets recorded, so the whole path has to work on it: the chunker
// finds the teaser, the canned analysis is replayed onto it, and the rewrite lands on the
// anchor the mirror rendered. A chunking change that misses the teaser shows up here.

const MIRROR_URL = 'http://localhost:8080/clickbait-headline-link.html';
const { dom: mirrorDom, results: mirrorResults } = await labelPage(
  renderDemoPage(clickbait),
  MIRROR_URL
);
assert.equal(mirrorResults.length, 1, 'the mirror produces exactly the teaser chunk');
const [mirrored] = mirrorResults;
assert.ok(mirrored.analysis.xpath, 'the label has an element to attach to');
const { findElementByXPath } = await import('../src/utils/utils.js');
const mirrorEl = findElementByXPath(mirrored.analysis.xpath);
assert.ok(mirrorEl, `xpath does not resolve on the mirror: ${mirrored.analysis.xpath}`);
assert.equal(applyClickUnbaitFromAnalysis(mirrorEl, mirrored.analysis), true);
assert.equal(mirrorEl.querySelector('a').textContent, displayTitle);
assert.equal(riskLevelForScore(chunkProblemScore(mirrored.analysis)).id, 'caution');
mirrorDom.window.close();

// --- the canned fallback says so ---
//
// When the page chunks to something we do not recognise — x.com mid-load offered only its
// "To view keyboard shortcuts" heading — the canned chunk comes back with no xpath, and the
// content script has nothing to label. That is the right answer, but it has to be legible:
// the flag is what lets the background log say so instead of reporting a match.
const unmatched = demoResultsForChunks(STAT_POST_URL, [
  { text: 'To view keyboard shortcuts, press question mark', xpath: '/html/body/div' },
]);
assert.equal(unmatched.length, 1);
assert.equal(unmatched[0].canned, true, 'the fallback is flagged');
assert.equal(unmatched[0].analysis.xpath, undefined, 'and carries no xpath into the live page');

// --- rendering ---

const html = renderDemoPage(sharePost);
assert.ok(html.includes('<article class="post"'));
assert.ok(html.includes('link-card'), 'the share post renders its link card');

console.log('demo-analysis tests passed');
