import { test, expect } from './fixtures.js';
import { waitForAnalysisComplete, waitForContentScript, chunkCount } from './helpers.js';

const ONLINE_PAGES = [
  { name: 'BBC News home', url: 'https://www.bbc.co.uk/news' },
];

for (const { name, url } of ONLINE_PAGES) {
  test(`analyzes live page: ${name}`, async ({ context }) => {
    test.setTimeout(120_000);

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await waitForContentScript(page, 60_000);
    const analysis = await waitForAnalysisComplete(context, 90_000);

    expect(analysis.status).toBe('completed');
    expect(chunkCount(analysis)).toBeGreaterThan(0);
  });
}
