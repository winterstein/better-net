/**
 * Offscreen document: thin proxy between the background service worker and the
 * inference worker.
 *
 * Deliberately does no heavy work. Every same-origin extension page (popup,
 * options, this document) shares one renderer main thread, so running ONNX
 * inference here blocked the toolbar popup from painting — clicking the badge
 * appeared to do nothing. All model work lives in inference-worker.ts.
 */

import { LOCAL_MODELS } from '../ai/model-catalog.js';

const LOG = '[BN:local-model]';

const WASM_BASE = chrome.runtime.getURL('wasm/');
const WORKER_URL = chrome.runtime.getURL('offscreen/inference-worker.js');

/** @type {Map<string, { status: string, progress?: number, error?: string }>} */
const modelState = new Map();

/** @type {chrome.runtime.Port | null} */
let backgroundPort = null;

// --- inference worker ------------------------------------------------------

/** @type {Worker | null} */
let worker = null;
let nextRequestId = 1;
const pendingWorkerRequests = new Map();

function handleWorkerMessage(event) {
  const { id, result, error, type, modelId, patch } = event.data || {};

  if (type === 'STATE') {
    setModelState(modelId, patch);
    return;
  }

  const pending = pendingWorkerRequests.get(id);
  if (!pending) return;
  pendingWorkerRequests.delete(id);
  if (error) pending.reject(new Error(error));
  else pending.resolve(result);
}

function startWorker() {
  // Module worker: ONNX loads its jsep runtime with a dynamic import(), which
  // classic workers cannot do.
  worker = new Worker(WORKER_URL, { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', (event) => {
    console.error(LOG, 'offscreen: inference worker error', event.message);
    for (const [id, pending] of pendingWorkerRequests) {
      pending.reject(new Error(event.message || 'inference worker failed'));
      pendingWorkerRequests.delete(id);
    }
  });
  console.log(LOG, 'offscreen: inference worker started', WORKER_URL);
  return callWorker('INIT', { wasmBase: WASM_BASE });
}

function callWorker(action, payload = {}) {
  if (!worker) {
    return Promise.reject(new Error('inference worker not started'));
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingWorkerRequests.set(id, { resolve, reject });
    worker.postMessage({ id, action, ...payload });
  });
}

// --- model state (owned here, synced to the background) --------------------

function setModelState(modelId, patch) {
  const prev = modelState.get(modelId) || { status: 'idle' };
  const next = { ...prev, ...patch };
  // New files can temporarily lower the download ratio — keep the UI monotonic.
  if (patch?.monotonic) {
    next.progress = Math.max(prev.progress ?? 0, patch.progress ?? 0);
    delete next.monotonic;
  }
  modelState.set(modelId, next);
  console.log(LOG, 'offscreen: state', modelId, next);
  // Offscreen documents cannot use chrome.storage — sync via port to background.
  try {
    backgroundPort?.postMessage({
      type: 'MODEL_STATE_SYNC',
      localModels: Object.fromEntries(modelState),
    });
  } catch (err) {
    console.warn(LOG, 'offscreen: state sync to background failed', err);
  }
}

/**
 * Main-thread heap plus the worker's resident models. The models themselves
 * live in the worker's isolate, so `performance.memory` here no longer counts
 * their weights — it reports this document, not the ONNX sessions.
 */
async function getMemoryStats() {
  const perfMem = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;

  let fromWorker: Record<string, unknown> = { loadedModelIds: [] };
  try {
    fromWorker = (await callWorker('GET_MEMORY')) as Record<string, unknown>;
  } catch (err) {
    console.warn(LOG, 'offscreen: worker memory query failed', err);
  }

  return {
    jsHeapUsedBytes: fromWorker.jsHeapUsedBytes ?? perfMem?.usedJSHeapSize ?? null,
    jsHeapTotalBytes: fromWorker.jsHeapTotalBytes ?? perfMem?.totalJSHeapSize ?? null,
    jsHeapLimitBytes: fromWorker.jsHeapLimitBytes ?? perfMem?.jsHeapSizeLimit ?? null,
    loadedModelIds: fromWorker.loadedModelIds ?? [],
  };
}

async function handleOffscreenAction(action, message) {
  switch (action) {
    // Answered on this thread so a health check never waits behind inference.
    case 'PING':
      return { ok: true };
    case 'GET_STATUS':
      return { models: Object.fromEntries(modelState), catalog: LOCAL_MODELS };
    case 'GET_MEMORY':
      return getMemoryStats();
    case 'DOWNLOAD':
    case 'REMOVE':
    case 'ZERO_SHOT':
    case 'GENERATE':
      return callWorker(action, message);
    default:
      return { error: `Unknown action: ${action}` };
  }
}

// --- background port -------------------------------------------------------

function replyOnPort(port, requestId, result) {
  if (!port || requestId == null) return;
  console.log(LOG, 'offscreen: port reply', requestId, result);
  port.postMessage({ requestId, ...result });
}

function applyInitState(localModels) {
  for (const [id, state] of Object.entries(localModels || {})) {
    modelState.set(id, state);
  }
  console.log(LOG, 'offscreen: restored state from background', localModels);
}

function connectToBackground() {
  try {
    const port = chrome.runtime.connect({ name: 'bn-offscreen' });
    backgroundPort = port;
    console.log(LOG, 'offscreen: connected port to background');

    port.onMessage.addListener(async (message) => {
      if (message?.type === 'INIT_STATE') {
        applyInitState(message.localModels);
        return;
      }
      const { requestId, action } = message || {};
      console.log(LOG, 'offscreen: port message', requestId, action);
      try {
        const result = await handleOffscreenAction(action, message);
        replyOnPort(port, requestId, result);
      } catch (err) {
        replyOnPort(port, requestId, { error: err.message });
      }
    });

    port.onDisconnect.addListener(() => {
      backgroundPort = null;
      console.warn(LOG, 'offscreen: port disconnected, reconnecting…');
      setTimeout(connectToBackground, 400);
    });
  } catch (err) {
    console.error(LOG, 'offscreen: port connect failed', err);
    setTimeout(connectToBackground, 1000);
  }
}

startWorker().catch((err) => {
  console.error(LOG, 'offscreen: inference worker init failed', err);
});
connectToBackground();

// Legacy broadcast path (background should use port; log if this still fires)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'BN_OFFSCREEN') return false;

  console.warn(LOG, 'offscreen: received BN_OFFSCREEN via broadcast (unexpected)', message.action);

  const run = async () => handleOffscreenAction(message.action, message);

  run()
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

console.log(LOG, 'offscreen: script loaded, wasm base', WASM_BASE);
