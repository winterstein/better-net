import { expect, type BrowserContext, type Page } from '@playwright/test';

export const FIXTURE_BASE = `http://127.0.0.1:${process.env.FIXTURE_PORT || 8765}`;

export function extensionUrl(extensionId: string, path: string) {
  return `chrome-extension://${extensionId}/${path}`;
}

export function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

export async function bringPageToFront(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.bringToFront');
}

export async function waitForPopupReady(page: Page, timeoutMs = 15_000) {
  await page.waitForFunction(
    () => {
      const loading = document.getElementById('loading');
      const noTab = document.getElementById('no-tab');
      const analysis = document.getElementById('analysis-container');
      if (!loading) return false;
      if (noTab && !noTab.classList.contains('hidden')) return true;
      if (analysis && !analysis.classList.contains('hidden')) return true;
      if (!loading.classList.contains('hidden')) {
        const text = loading.textContent?.trim() ?? '';
        return text.length > 0 && !text.includes('Loading analysis');
      }
      return false;
    },
    { timeout: timeoutMs }
  );
}

export async function waitForOptionsReady(page: Page, timeoutMs = 15_000) {
  await expect(page.locator('h1.top-bar-title')).toHaveText('better:net', { timeout: timeoutMs });
  await expect(page.locator('#nav-list li')).toHaveCount(5, { timeout: timeoutMs });
  await expect(page.locator('#analysis-mode')).toBeVisible({ timeout: timeoutMs });
  await expect(page.locator('#page-ai-model')).toBeVisible({ timeout: timeoutMs });
  await expect(page.locator('.status-message.error')).toHaveCount(0, { timeout: timeoutMs });
}

export async function getServiceWorker(context: BrowserContext) {
  const boot = context.pages()[0];
  if (!boot) {
    const page = await context.newPage();
    await page.goto('about:blank');
  }
  let [sw] = context.serviceWorkers();
  if (!sw) {
    sw = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  return sw;
}

export async function waitForContentScript(page: Page, timeoutMs = 30_000) {
  await page.waitForSelector('#betternet-highlight-styles', { state: 'attached', timeout: timeoutMs });
}

export type AnalysisRecord = {
  status?: string;
  progress?: number;
  result?: { chunks?: unknown[]; chunkResults?: unknown[]; url?: string };
  timestamp?: number;
};

export function chunkCount(analysis: AnalysisRecord) {
  const r = analysis.result;
  return r?.chunkResults?.length ?? r?.chunks?.length ?? 0;
}

export async function waitForAnalysisComplete(
  context: BrowserContext,
  timeoutMs = 90_000
): Promise<AnalysisRecord> {
  const sw = await getServiceWorker(context);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const record = await sw.evaluate(async () => {
      const data = await chrome.storage.local.get(null);
      const entries = Object.entries(data).filter(([k]) => k.startsWith('analysis_'));
      if (entries.length === 0) return null;
      entries.sort((a, b) => ((b[1] as { timestamp?: number }).timestamp || 0) - ((a[1] as { timestamp?: number }).timestamp || 0));
      return entries[0][1] as AnalysisRecord;
    });

    if (record?.status === 'completed' || record?.result) {
      return record;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`Analysis did not complete within ${timeoutMs}ms`);
}

export function fixtureUrl(htmlFile: string) {
  return `${FIXTURE_BASE}/${encodeURIComponent(htmlFile)}`;
}
