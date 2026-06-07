/**
 * Unit tests for background local model / offscreen client.
 */

import {
  installChromeMock,
  createOffscreenPort,
} from './helpers/chrome-mock.js';

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const chrome = installChromeMock({
  storage: { localModels: { 'mobilebert-mnli': { status: 'ready' } } },
});

const { sendToOffscreen, ensureOffscreen, closeOffscreenIfIdle } = await import(
  '../src/ai/local-inference-client.js'
);

await ensureOffscreen();

// Port connect: INIT_STATE from storage
const initPosted = chrome._test.connectedPort.posted.filter((m) => m.type === 'INIT_STATE');
assert(initPosted.length === 1, 'offscreen should receive INIT_STATE on connect');
assert(
  initPosted[0].localModels['mobilebert-mnli']?.status === 'ready',
  'INIT_STATE should include stored localModels'
);

// MODEL_STATE_SYNC persists to chrome.storage.local
chrome._test.connectedPort.emit({
  type: 'MODEL_STATE_SYNC',
  localModels: { 'flan-t5-small': { status: 'downloading', progress: 0.5 } },
});
await new Promise((r) => setTimeout(r, 10));
const stored = await chrome.storage.local.get({ localModels: {} });
assert(
  stored.localModels['flan-t5-small']?.progress === 0.5,
  'MODEL_STATE_SYNC should persist localModels to storage'
);

// sendToOffscreen round-trip
const analyzeRes = await sendToOffscreen('ANALYZE', { modelId: 'mobilebert-mnli', text: 'hi' });
assert(analyzeRes?.ok === true, 'default port mock should respond ok to ANALYZE');

// ensureOffscreen is idempotent when port already connected
await ensureOffscreen();
await ensureOffscreen();

// custom port handler
const customPort = createOffscreenPort({
  REMOVE({ requestId }) {
    return { requestId, removed: true, modelId: 'mobilebert-mnli' };
  },
});
chrome.offscreen.closeDocument();
chrome._test.connectPort(customPort);
await ensureOffscreen();
const removeRes = await sendToOffscreen('REMOVE', { modelId: 'mobilebert-mnli' });
assert(removeRes?.removed === true, 'REMOVE should return handler payload');

// port disconnect rejects in-flight request
await chrome.offscreen.closeDocument();
const slowPort = createOffscreenPort({
  SLOW: () => null,
});
chrome._test.connectPort(slowPort);
await ensureOffscreen();
let disconnectErr = null;
const pending = sendToOffscreen('SLOW', {}).catch((e) => {
  disconnectErr = e;
});
await new Promise((r) => setTimeout(r, 5));
slowPort.disconnect();
await pending.catch(() => {});
assert(
  disconnectErr?.message?.includes('disconnected'),
  `expected disconnect error, got: ${disconnectErr?.message}`
);

// missing offscreen API
const savedOffscreen = chrome.offscreen;
chrome.offscreen = undefined;
let noApiErr = null;
try {
  await ensureOffscreen();
} catch (e) {
  noApiErr = e;
}
chrome.offscreen = savedOffscreen;
assert(
  noApiErr?.message?.includes('offscreen document support'),
  'ensureOffscreen should fail without chrome.offscreen'
);

// closeOffscreenIfIdle closes document when PING fails
await chrome.offscreen.closeDocument();
const failPort = createOffscreenPort({
  default() {
    return { error: 'worker dead' };
  },
});
chrome._test.setOffscreenDocumentExists(true);
chrome._test.connectPort(failPort);
await closeOffscreenIfIdle();
assert(!(await chrome.offscreen.hasDocument()), 'closeOffscreenIfIdle should close offscreen on PING failure');

console.log('✅ local-inference-client tests passed');
