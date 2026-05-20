/**
 * Offscreen document: loads transformers.js pipelines and runs inference.
 */

import { pipeline, env } from '@huggingface/transformers';
import { LOCAL_MODELS, getLocalModel } from '../ai/model-catalog.js';

const LOG = '[BN:local-model]';

const WASM_BASE = chrome.runtime.getURL('wasm/');
env.allowLocalModels = false;
env.useBrowserCache = true;

/** Configure ONNX WASM for MV3 offscreen (no CDN, no proxy worker, single-threaded). */
function configureOnnxWasm() {
  const wasm = env.backends?.onnx?.wasm;
  if (!wasm) {
    console.error(LOG, 'offscreen: env.backends.onnx.wasm missing');
    return;
  }
  wasm.wasmPaths = {
    mjs: WASM_BASE + 'ort-wasm-simd-threaded.jsep.mjs',
    wasm: WASM_BASE + 'ort-wasm-simd-threaded.jsep.wasm',
  };
  // Proxy workers cannot load extension WASM reliably; transformers.js defaults to false.
  wasm.proxy = false;
  // Extension pages are not cross-origin isolated — threaded WASM fails with ErrorEvent.
  wasm.numThreads = 1;
  console.log(LOG, 'offscreen: ONNX wasm configured', {
    mjs: wasm.wasmPaths.mjs,
    wasm: wasm.wasmPaths.wasm,
    proxy: wasm.proxy,
    numThreads: wasm.numThreads,
  });
}
configureOnnxWasm();

/** @type {Map<string, unknown>} */
const pipelines = new Map();

/** @type {Map<string, { status: string, progress?: number, error?: string }>} */
const modelState = new Map();

/** @type {chrome.runtime.Port | null} */
let backgroundPort = null;

function setModelState(modelId, patch) {
  const prev = modelState.get(modelId) || { status: 'idle' };
  const next = { ...prev, ...patch };
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

async function reportProgress(modelId, progress) {
  const pct = progress?.progress != null ? Math.round(progress.progress) : undefined;
  setModelState(modelId, {
    status: 'downloading',
    progress: pct ?? 0,
  });
}

async function getPipeline(modelId) {
  if (pipelines.has(modelId)) return pipelines.get(modelId);

  const spec = getLocalModel(modelId);
  console.log(LOG, 'offscreen: loading pipeline', modelId, spec.huggingFaceId);
  setModelState(modelId, { status: 'loading', progress: 0 });

  const pipe = await pipeline(spec.pipeline, spec.huggingFaceId, {
    progress_callback: (p) => reportProgress(modelId, p),
  });

  pipelines.set(modelId, pipe);
  setModelState(modelId, { status: 'ready', progress: 100, error: undefined });
  console.log(LOG, 'offscreen: pipeline ready', modelId);
  return pipe;
}

async function zeroShot({ modelId, text, candidateLabels, multiLabel }) {
  const pipe = await getPipeline(modelId);
  const output = await pipe(text, candidateLabels, { multi_label: multiLabel });
  return {
    labels: output.labels,
    scores: output.scores,
  };
}

async function generate({ modelId, prompt, maxNewTokens }) {
  const spec = getLocalModel(modelId);
  if (spec.pipeline !== 'text2text-generation') {
    throw new Error(`Model ${modelId} does not support text generation`);
  }
  const pipe = await getPipeline(modelId);
  const outputs = await pipe(prompt, {
    max_new_tokens: maxNewTokens ?? 256,
  });
  const text = Array.isArray(outputs) ? outputs[0]?.generated_text : outputs?.generated_text;
  return { text: text ?? '' };
}

async function removeModel(modelId) {
  pipelines.delete(modelId);
  setModelState(modelId, { status: 'not_installed', progress: 0, error: undefined });
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // Cache API may be limited in offscreen; model files may remain in IndexedDB until cleared
  }
}

function startDownload(modelId) {
  if (!modelId) {
    return Promise.reject(new Error('modelId required'));
  }
  console.log(LOG, 'offscreen: startDownload', modelId);
  setModelState(modelId, { status: 'downloading', progress: 0, error: undefined });
  return getPipeline(modelId).catch((err) => {
    const msg = formatOnnxError(err);
    console.error(LOG, 'offscreen: download failed', modelId, msg, err);
    setModelState(modelId, { status: 'error', error: msg });
    throw err;
  });
}

async function handleOffscreenAction(action, message) {
  switch (action) {
    case 'PING':
      return { ok: true };
    case 'DOWNLOAD': {
      const { modelId } = message;
      if (!modelId) return { error: 'modelId required' };
      startDownload(modelId).catch((err) => {
        console.error(LOG, 'offscreen: background download task failed', modelId, err);
      });
      return { ok: true, started: true, modelId };
    }
    case 'REMOVE':
      await removeModel(message.modelId);
      return { ok: true };
    case 'GET_STATUS':
      return { models: Object.fromEntries(modelState), catalog: LOCAL_MODELS };
    case 'ZERO_SHOT':
      return zeroShot(message);
    case 'GENERATE':
      return generate(message);
    default:
      return { error: `Unknown action: ${action}` };
  }
}

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

function formatOnnxError(err) {
  if (err instanceof ErrorEvent) {
    return err.message || err.type || 'WebAssembly failed to load (check extension wasm/ files)';
  }
  return err?.message || String(err);
}

console.log(LOG, 'offscreen: script loaded, wasm base', WASM_BASE);
