/**
 * The popup's live status, end to end: chunk counts that move, and chunks that are only
 * analysed once the reader scrolls to them (specs/analysis-scheduling.md).
 *
 * Worth an e2e test because the chain is the whole point — background counts -> storage ->
 * popup render — and each link is invisible to a unit test.
 */

import { test, expect } from './fixtures.js';
import {
  FIXTURE_BASE,
  bringPageToFront,
  extensionUrl,
  waitForContentScript,
  waitForPopupReady,
} from './helpers.js';
import { ensureFixtureServer } from './start-fixture-server.js';

/** A real saved news front page: 50 chunks, nearly all of them below the fold. */
const LONG_PAGE = `${FIXTURE_BASE}/pages/bbc.co.uk-home.html`;

test('popup reports live chunk counts, and scrolling releases the rest', async ({
  context,
  extensionId,
}) => {
  await ensureFixtureServer();

  const contentPage = await context.newPage();
  await contentPage.setViewportSize({ width: 1000, height: 700 });
  await contentPage.goto(LONG_PAGE, { waitUntil: 'domcontentloaded' });
  await waitForContentScript(contentPage);

  const popupPage = await context.newPage();
  await popupPage.goto(extensionUrl(extensionId, 'popup/popup.html'), {
    waitUntil: 'domcontentloaded',
  });
  await bringPageToFront(contentPage);
  await popupPage.reload({ waitUntil: 'domcontentloaded' });
  await waitForPopupReady(popupPage);

  const stats = popupPage.locator('#chunk-stats');
  await expect(stats).toContainText(/\d+ chunks found/, { timeout: 60_000 });
  // A page this long cannot be on screen all at once, so some chunks must be held back.
  await expect(stats).toContainText('waiting until you scroll', { timeout: 60_000 });

  const waitingCount = async () => {
    const text = (await stats.textContent()) ?? '';
    return Number(/(\d+) waiting/.exec(text)?.[1] ?? 0);
  };
  const before = await waitingCount();
  expect(before).toBeGreaterThan(0);

  await contentPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await bringPageToFront(contentPage);

  await expect
    .poll(waitingCount, {
      timeout: 60_000,
      message: 'chunks scrolled into view should be handed over for analysis',
    })
    .toBeLessThan(before);

  console.log(
    `chunk stats: "${await stats.textContent()}" (${before} waiting before the scroll)`
  );
});
