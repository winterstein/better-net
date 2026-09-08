/**
 * Clicking through an SPA is how a reader actually reaches a post: x.com, Facebook and
 * Reddit swap the view with pushState and never load a page. Two bugs lived here —
 * navigation did not re-analyse at all, and once it did, the new page was dropped because
 * the previous page's analysis (minutes long, on a slow model) was still running.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from './fixtures.js';
import { getServiceWorker } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const postPage = fs.readFileSync(
  path.join(__dirname, '..', 'test-data', 'pages', 'x.com-post-2.html'),
  'utf-8'
);
const POST_ROUTE = '/demo/shared-fake-news-post.html';

/** A timeline that swaps in the post on click, exactly as an SPA router would. */
function timelineHtml() {
  const body = postPage.slice(postPage.indexOf('<body'), postPage.lastIndexOf('</body>') + 7);
  const inner = JSON.stringify(body.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, ''));
  return `<!DOCTYPE html><html><head><title>Home</title></head><body>
    <main><h1>Timeline</h1><p>Ordinary timeline copy, long enough to be chunked and analysed
    like any other page, but nothing here is worth a label.</p></main>
    <button id="go">Open post</button>
    <script>
      document.getElementById('go').onclick = () => {
        history.pushState({}, '', ${JSON.stringify(POST_ROUTE)});
        document.body.innerHTML = ${inner};
      };
    </script></body></html>`;
}

test('an SPA navigation gets analysed and labelled', async ({ context }) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.url?.includes('shared-fake-news-post') ? postPage : timelineHtml());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };

  try {
    const sw = await getServiceWorker(context);
    await sw.evaluate(() => chrome.storage.sync.set({ demoMode: true, developerMode: true }));

    const page = await context.newPage();
    // Wait for the timeline's own analysis to be under way, so the navigation has something
    // to supersede — that is the case being tested, and a fixed sleep makes it a race.
    const timelineAnalysing = page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('Starting page analysis'),
      timeout: 60_000,
    });
    await page.goto(`http://127.0.0.1:${port}/home`, { waitUntil: 'load' });
    await timelineAnalysing;

    await page.click('#go');

    await expect
      .poll(
        () => page.evaluate(() => document.querySelectorAll('.betternet-chunk-badge').length),
        { timeout: 30_000, message: 'the post navigated to should be labelled' }
      )
      .toBeGreaterThan(0);

    const badge = await page.evaluate(
      () => document.querySelector('.betternet-chunk-badge')?.textContent?.trim() ?? ''
    );
    expect(badge).toContain('High Risk');

    // The label belongs to the post, not to leftover markup from the timeline.
    const labelled = await page.evaluate(
      () => document.querySelector('.betternet-chunk-badge')?.closest('article')?.textContent ?? ''
    );
    expect(labelled).toContain('Lab Grown Meat Causes Cancer');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
