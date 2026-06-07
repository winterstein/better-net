import { test, expect } from './fixtures.js';
import {
  bringPageToFront,
  collectPageErrors,
  extensionUrl,
  fixtureUrl,
  getServiceWorker,
  waitForOptionsReady,
  waitForPopupReady,
} from './helpers.js';
import { ensureFixtureServer } from './start-fixture-server.js';

test.describe('extension smoke', () => {
  test('service worker loads and background responds', async ({ context, extensionId }) => {
    const sw = await getServiceWorker(context);
    expect(sw.url()).toContain(extensionId);

    const page = await context.newPage();
    await page.goto(extensionUrl(extensionId, 'popup/popup.html'), { waitUntil: 'domcontentloaded' });
    const health = await page.evaluate(async () => {
      const popupPath = await new Promise<string | undefined>((resolve) => {
        chrome.action.getPopup({}, (p) => resolve(p || undefined));
      });
      const status = await new Promise<unknown>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_STATUS' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response ?? null);
        });
      });
      return { popupPath, status };
    });

    expect(health.popupPath).toContain('popup/popup.html');
    expect(health.status).toBeTruthy();
    expect(health.status).not.toHaveProperty('error');
    await page.close();
  });

  test('options page loads bundled scripts', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const failed: string[] = [];
    page.on('requestfailed', (req) => failed.push(req.url()));
    page.on('response', (res) => {
      if (res.status() >= 400 && res.url().includes(extensionId)) failed.push(res.url());
    });

    await page.goto(extensionUrl(extensionId, 'options/options.html'), { waitUntil: 'domcontentloaded' });
    expect(failed).toEqual([]);
    await expect(page.locator('script[src$="defaults.js"]')).toHaveCount(1);
    await expect(page.locator('script[src$="options.js"]')).toHaveCount(1);
  });

  test('options page initializes', async ({ context, extensionId }) => {
    const page = await context.newPage();
    const errors = collectPageErrors(page);

    await page.goto(extensionUrl(extensionId, 'options/options.html'), { waitUntil: 'domcontentloaded' });
    await waitForOptionsReady(page);

    expect(errors).toEqual([]);
  });

  test('popup initializes when active tab is analyzable', async ({ context, extensionId }) => {
    await ensureFixtureServer();

    const contentPage = await context.newPage();
    await contentPage.goto(fixtureUrl('duckduckgo.com.hello.html'), { waitUntil: 'domcontentloaded' });

    const popupPage = await context.newPage();
    const errors = collectPageErrors(popupPage);
    await popupPage.goto(extensionUrl(extensionId, 'popup/popup.html'), { waitUntil: 'domcontentloaded' });

    await bringPageToFront(contentPage);
    await popupPage.reload({ waitUntil: 'domcontentloaded' });
    await waitForPopupReady(popupPage);

    await expect(popupPage.locator('#analysis-container')).toBeVisible();
    await expect(popupPage.locator('#loading')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('popup settings button opens options page', async ({ context, extensionId }) => {
    const popupPage = await context.newPage();
    const errors = collectPageErrors(popupPage);
    await popupPage.goto(extensionUrl(extensionId, 'popup/popup.html'), { waitUntil: 'domcontentloaded' });
    await waitForPopupReady(popupPage);

    const optionsPagePromise = context.waitForEvent('page');
    await popupPage.locator('#settings-btn').click();
    const optionsPage = await optionsPagePromise;

    await waitForOptionsReady(optionsPage);
    expect(optionsPage.url()).toContain('/options/options.html');
    expect(errors).toEqual([]);
  });
});
