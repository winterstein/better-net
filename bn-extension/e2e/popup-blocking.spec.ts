/**
 * Regression: local inference must not run on the shared extension main thread.
 *
 * Every same-origin extension page — popup.html, options.html and the offscreen
 * document — shares one renderer process and one main thread. Running ONNX/WASM
 * inference on the offscreen document's main thread therefore stopped the
 * toolbar popup from painting for as long as analysis ran: clicking the badge
 * did nothing. (Measured: a 6s synchronous burn on one extension page delayed
 * the popup by 5.8s.)
 *
 * The fix keeps all model work in offscreen/inference-worker.ts, which has its
 * own thread. These tests assert that separation still holds.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from './fixtures.js';
import { extensionUrl, waitForPopupReady } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist', 'chrome');

/** offscreen.js is a message proxy; anything close to the ONNX bundle size means it regressed. */
const OFFSCREEN_MAX_BYTES = 100_000;
/** The popup must paint promptly even with the inference stack loaded. */
const POPUP_BUDGET_MS = 3_000;

test.describe('popup availability', () => {
  test('offscreen document does not bundle the inference runtime', () => {
    const offscreen = path.join(distDir, 'offscreen', 'offscreen.js');
    const worker = path.join(distDir, 'offscreen', 'inference-worker.js');

    expect(fs.existsSync(offscreen)).toBe(true);
    expect(fs.existsSync(worker)).toBe(true);

    const offscreenBytes = fs.statSync(offscreen).size;
    const workerBytes = fs.statSync(worker).size;
    console.log(`offscreen.js ${offscreenBytes}B, inference-worker.js ${workerBytes}B`);

    // The heavy runtime belongs in the worker, not on the shared main thread.
    expect(offscreenBytes).toBeLessThan(OFFSCREEN_MAX_BYTES);
    expect(workerBytes).toBeGreaterThan(OFFSCREEN_MAX_BYTES);
  });

  test('offscreen document runs inference in a dedicated worker', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(extensionUrl(extensionId, 'offscreen/offscreen.html'), {
      waitUntil: 'domcontentloaded',
    });

    await expect
      .poll(() => page.workers().length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const workerUrls = page.workers().map((w) => w.url());
    console.log('offscreen workers:', workerUrls);
    expect(workerUrls.some((u) => u.includes('inference-worker.js'))).toBe(true);

    await page.close();
  });

  test('inference requests round-trip through the worker', async ({ context, extensionId }) => {
    // GET_MEMORY is proxied offscreen -> worker -> offscreen, so a real answer
    // proves the whole message path works, not just that the worker loaded.
    // Sent from an extension page: a service worker does not receive its own messages.
    const page = await context.newPage();
    await page.goto(extensionUrl(extensionId, 'options/options.html'), {
      waitUntil: 'domcontentloaded',
    });

    const memory = await page.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'BN_LOCAL_MODEL', action: 'memory' },
            (response) => resolve(chrome.runtime.lastError ?? response)
          );
        })
    );

    console.log('memory round-trip:', JSON.stringify(memory));
    expect(memory).toBeTruthy();
    expect(memory).not.toHaveProperty('error');
    expect(memory).toHaveProperty('loadedModelIds');
    await page.close();
  });

  test('popup renders promptly while the offscreen document is alive', async ({
    context,
    extensionId,
  }) => {
    const offscreen = await context.newPage();
    await offscreen.goto(extensionUrl(extensionId, 'offscreen/offscreen.html'), {
      waitUntil: 'domcontentloaded',
    });
    await expect.poll(() => offscreen.workers().length, { timeout: 15_000 }).toBeGreaterThan(0);

    const popup = await context.newPage();
    const started = Date.now();
    await popup.goto(extensionUrl(extensionId, 'popup/popup.html'), {
      waitUntil: 'domcontentloaded',
    });
    await waitForPopupReady(popup);
    const renderMs = Date.now() - started;

    console.log(`popup ready in ${renderMs}ms with the offscreen document loaded`);
    expect(renderMs).toBeLessThan(POPUP_BUDGET_MS);

    await popup.close();
    await offscreen.close();
  });
});
