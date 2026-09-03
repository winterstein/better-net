/**
 * X (twitter.com / x.com) chunker tests.
 *
 * X renders generated class names, so the generic chunker returned 0 chunks on a post
 * permalink and the demo label had nothing to attach to. Markup below mirrors the
 * `data-testid` hooks X exposes.
 */

import assert from 'node:assert/strict';
import { looksUnrendered } from '../src/chunking/chunking.js';
import { Window } from 'happy-dom';

const URL_ = 'https://x.com/drhossamsamy65/status/2047310606361899350';

const HTML = `<!DOCTYPE html><html><body><div id="react-root"><main role="main">
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name"><span>Dr.Sam Youssef Ph.D.,Ph.D.,DPT.</span><span>@drhossamsamy65</span></div>
      <time datetime="2026-04-23T13:44:20.000Z">Apr 23</time>
      <div data-testid="tweetText">Study: Bill Gates’ Lab Grown Meat Causes Cancer in Humans
        <a href="https://t.co/W22BflKQpQ">thepeoplesvoice.tv/study-bill-gate…</a> via
        <a href="/realtpv">@realtpv</a></div>
      <div data-testid="card.wrapper">Study: Bill Gates’ Lab Grown Meat Causes Cancer in Humans thepeoplesvoice.tv</div>
    </article>
  </div>
  <div data-testid="cellInnerDiv">
    <div data-testid="placementTracking">
      <article data-testid="tweet" role="article">
        <div data-testid="User-Name"><span>Acme Insurance</span><span>@acme</span></div>
        <div data-testid="tweetText">Switch today and save on your car insurance with Acme, the smarter way to cover your vehicle.</div>
      </article>
    </div>
  </div>
</main></div></body></html>`;

const w = new Window({ url: URL_ });
(globalThis as any).window = w as any;
(globalThis as any).document = w.document as any;
w.document.write(HTML);

const { extractChunks } = await import('../src/chunking/chunking.js');
const chunks = await extractChunks(w.document as any, URL_, {});

assert.equal(chunks.length, 1, 'one post chunk, promoted post excluded');
const [post] = chunks;
assert.ok(post.text.includes('Lab Grown Meat Causes Cancer'), 'post text captured');
assert.ok(post.text.includes('@drhossamsamy65'), 'author captured — the demo matches on the handle');
assert.ok(post.text.length >= 100, 'above the chunker minTextLength');
assert.ok(post.xpath?.includes('article'), `xpath points at the post: ${post.xpath}`);
assert.ok(post.tags.includes('post'), 'tagged post');

// The canned demo analysis must recognise this chunk
const { demoResultsForChunks } = await import('../src/analysis/demo-analysis.js');
const [result] = demoResultsForChunks(URL_, chunks);
assert.ok(result, 'demo entry matches the live X chunk');
assert.equal(result.chunk.xpath, post.xpath, 'label is placed on the real element');
assert.equal(result.analysis.summary.overallRisk, 'high');

// Promoted posts are available when ads are wanted
const withAds = await extractChunks(w.document as any, URL_, { includeAds: true });
assert.equal(withAds.length, 2);
assert.ok(withAds.some((c) => c.tags.includes('advert')), 'placementTracking tags an advert');

// Re-analysis after an SPA navigation sees the previous run's nutrient labels still in the
// DOM. They are our own UI, not page content, and must not be read back as post text.
const LABELLED = HTML.replace(
  '</article>',
  `<div class="betternet-chunk-badge"><span class="betternet-badge-text">Safe</span>` +
    `<button class="betternet-badge-dismiss">\u00d7</button></div></article>`
);
const w2 = new Window({ url: URL_ });
(globalThis as any).window = w2 as any;
(globalThis as any).document = w2.document as any;
w2.document.write(LABELLED);
const relabelled = await extractChunks(w2.document as any, URL_);
assert.ok(relabelled.length >= 1, 'still chunks a post that already carries a label');
for (const chunk of relabelled) {
  assert.ok(!chunk.text.includes('Safe'), `own nutrient label leaked into chunk text: ${chunk.text}`);
}

/**
 * The retry guard. x.com's loading screen yields one headline chunk of site furniture, and
 * a truthy count used to end the content script's render backoff on attempt 1 — so the post
 * was never chunked and never labelled. See test-data/pages/x.com-post-3-loading.html.
 */
const furniture = [{ metadata: { headline: true } }];
const realPost = [{ metadata: { platform: 'x' } }];

assert.equal(looksUnrendered([], URL_), true, 'no chunks at all is not rendered');
assert.equal(looksUnrendered(furniture, URL_), true, 'teasers only, on a platform we chunk');
assert.equal(looksUnrendered([...furniture, ...realPost], URL_), false, 'a real post is enough');
assert.equal(looksUnrendered(realPost, URL_), false);
// Off-platform, teasers are the content: a news homepage must not be retried five times.
assert.equal(looksUnrendered(furniture, 'https://bbc.co.uk/news'), false);

console.log('✅ X chunker tests passed');
