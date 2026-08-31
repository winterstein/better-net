/**
 * Unit tests for the canned demo dataset: url lookup and the Nutrient Label band each
 * demo page is meant to land in.
 */

import assert from 'node:assert/strict';
import {
  DEMO_PAGES,
  demoAnalyses,
  demoAnalysisForChunk,
  demoChunks,
  demoResultsForChunks,
  findDemoPage,
  normaliseDemoUrl,
  renderDemoPage,
} from '../src/analysis/demo-analysis.js';
import { riskLevelForScore } from '../src/types/RiskLevel.js';
import { chunkProblemScore } from '../src/types/ChunkAnalysis.js';

const [sharePost, fakeArticle] = DEMO_PAGES;
const POST_URL = 'https://x.com/drhossamsamy65/status/2047310606361899350';
const ARTICLE_URL =
  'https://thepeoplesvoice.tv/study-bill-gates-lab-grown-meat-causes-cancer-in-humans/';

// --- lookup ---

assert.equal(normaliseDemoUrl('https://WWW.Example.com/a/b/?utm=x'), 'example.com/a/b');
assert.equal(findDemoPage(POST_URL), sharePost);
assert.equal(findDemoPage(ARTICLE_URL), fakeArticle);
// Tracking params and a trailing slash must not lose the match
assert.equal(findDemoPage(POST_URL + '?s=20&t=abc'), sharePost);
// Offline mirror, on any local port
assert.equal(findDemoPage('http://127.0.0.1:9999/demo/fake-news-article.html'), fakeArticle);
assert.equal(findDemoPage('https://example.com/other'), undefined);
assert.equal(findDemoPage(''), undefined);

// --- shape ---

assert.equal(sharePost.chunks.length, 1, 'the X post is one chunk');
assert.equal(fakeArticle.chunks.length, 3, 'the article plus its two sidebar teasers');
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

for (const page of DEMO_PAGES) {
  for (const { chunk, analysis } of page.chunks) {
    const score = chunkProblemScore(analysis);
    assert.equal(riskLevelForScore(score).id, 'high-risk', `${page.title}: ${chunk.title}`);
  }
}

// The article is the "true premise, false conclusion" example: one true statement, one not
const verdicts = fakeArticle.chunks[0].analysis.statements.map((s) => s.analyses[0].flags[0]);
assert.deepEqual(verdicts, ['false', 'true']);

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
// Nothing recognised at all -> fall back to the canned chunks
assert.deepEqual(demoResultsForChunks(ARTICLE_URL, []), fakeArticle.chunks);
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
assert.equal(denzel.statements[0].analyses[0].flags[0], 'false');
assert.equal(silverstone.statements[0].analyses[0].flags[0], 'false');

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

// --- rendering ---

const html = renderDemoPage(sharePost);
assert.ok(html.includes('<article class="post"'));
assert.ok(html.includes('link-card'), 'the share post renders its link card');

console.log('demo-analysis tests passed');
