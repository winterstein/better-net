import { test, expect } from './fixtures.js';
import { fixtureUrl, waitForAnalysisComplete, waitForContentScript, chunkCount } from './helpers.js';
import { ensureFixtureServer } from './start-fixture-server.js';

const FIXTURE_PAGES = [
  'duckduckgo.com.hello.html',
  'bbc.co.uk-news.1.html',
  'google.com.edinburgh - Google Search.html',
];

test.beforeAll(async () => {
  await ensureFixtureServer();
});

for (const htmlFile of FIXTURE_PAGES) {
  test(`analyzes fixture ${htmlFile}`, async ({ context }) => {
    const page = await context.newPage();
    await page.goto(fixtureUrl(htmlFile), { waitUntil: 'domcontentloaded' });

    await waitForContentScript(page);
    const analysis = await waitForAnalysisComplete(context);

    expect(analysis.status).toBe('completed');
    expect(chunkCount(analysis)).toBeGreaterThan(0);
  });
}

