/**
 * Dedicated worker that owns transformers.js pipelines and runs ONNX inference.
 *
 * This must NOT run on the offscreen document's main thread: every same-origin
 * extension page (popup, options, offscreen) shares one renderer main thread,
 * so a multi-second synchronous WASM inference there stops the toolbar popup
 * from painting at all — the user sees the click do nothing.
 * See e2e/popup-blocking.spec.ts.
 *
 * No chrome.* APIs are available or used here. Everything the worker needs
 * (the WASM base URL) arrives in the INIT message, and all state changes go
 * back to offscreen.ts over postMessage.
 */

import { pipeline, env } from '@huggingface/transformers';
import { getLocalModel } from '../ai/model-catalog.js';
import type { TraceStep } from '../tracing/tracer-hook.js';
import {
  applyDownloadProgressEvent,
  type FileByteProgress,
} from '../ai/download-progress.js';

const LOG = '[BN:local-model]';

env.allowLocalModels = false;
env.useBrowserCache = true;

/** @type {Map<string, unknown>} */
const pipelines = new Map();

/** Per-model file byte totals while a download is in flight. */
const downloadFiles = new Map<string, Map<string, FileByteProgress>>();

/** Configure ONNX WASM for MV3 (no CDN, no proxy worker, single-threaded). */
function configureOnnxWasm(wasmBase: string) {
  const wasm = env.backends?.onnx?.wasm;
  if (!wasm) {
    console.error(LOG, 'worker: env.backends.onnx.wasm missing');
    return;
  }
  wasm.wasmPaths = {
    mjs: wasmBase + 'ort-wasm-simd-threaded.jsep.mjs',
    wasm: wasmBase + 'ort-wasm-simd-threaded.jsep.wasm',
  };
  // We are already off the main thread; ORT's own proxy worker cannot load
  // extension WASM reliably, so keep it off.
  wasm.proxy = false;
  // Extension pages are not cross-origin isolated — threaded WASM fails with ErrorEvent.
  wasm.numThreads = 1;
  console.log(LOG, 'worker: ONNX wasm configured', {
    mjs: wasm.wasmPaths.mjs,
    wasm: wasm.wasmPaths.wasm,
    proxy: wasm.proxy,
    numThreads: wasm.numThreads,
  });
}

/** Report a model state change; offscreen.ts owns the map and syncs it to the background. */
function postState(modelId, patch) {
  self.postMessage({ type: 'STATE', modelId, patch });
}

function reportProgress(modelId, progress) {
  let files = downloadFiles.get(modelId);
  if (!files) {
    files = new Map();
    downloadFiles.set(modelId, files);
  }
  const estimated = getLocalModel(modelId)?.sizeBytes ?? 0;
  const pct = applyDownloadProgressEvent(files, progress, estimated);
  if (pct == null) return;

  // Monotonic within a download — offscreen.ts clamps against the previous value.
  postState(modelId, { status: 'downloading', progress: pct, monotonic: true });
}

/** Release in-memory ONNX sessions. WASM heaps rarely shrink; prefer a fresh offscreen doc for large loads. */
async function disposePipelines() {
  const entries = [...pipelines.entries()];
  pipelines.clear();
  for (const [id, pipe] of entries) {
    try {
      const disposable = pipe as { dispose?: () => Promise<void> | void };
      await disposable.dispose?.();
      console.log(LOG, 'worker: disposed pipeline', id);
    } catch (err) {
      console.warn(LOG, 'worker: dispose failed', id, err);
    }
  }
}

async function getPipeline(modelId) {
  if (pipelines.has(modelId)) return pipelines.get(modelId);

  // One resident model: free others before allocating a new WASM session buffer.
  await disposePipelines();

  const spec = getLocalModel(modelId);
  console.log(LOG, 'worker: loading pipeline', modelId, spec.huggingFaceId);
  // Keep last download % while the pipeline finishes initializing.
  postState(modelId, { status: 'loading' });

  const pipe = await pipeline(
    spec.pipeline as import('@huggingface/transformers').PipelineType,
    spec.huggingFaceId,
    {
      progress_callback: (p) => reportProgress(modelId, p),
      ...(spec.pipelineOptions || {}),
    }
  );

  pipelines.set(modelId, pipe);
  downloadFiles.delete(modelId);
  postState(modelId, { status: 'ready', progress: 100, error: undefined });
  console.log(LOG, 'worker: pipeline ready', modelId);
  return pipe;
}

/**
 * Time one stage of an inference request into `steps`, for AIQA.
 *
 * The background's `local.*` span can only see the messaging round-trip, which also
 * covers port hops and a first-call model load; these steps are what the model
 * actually spent. Always recorded — two Date.now() calls, and the worker has no way
 * to know whether tracing is on. Replayed by tracing/aiqa-tracer.ts.
 */
async function timeStep<T>(
  steps: TraceStep[],
  name: string,
  attributes: TraceStep['attributes'],
  fn: () => Promise<T>
): Promise<T> {
  const step: TraceStep = { name, start: Date.now(), end: 0, attributes: { ...attributes } };
  steps.push(step);
  try {
    return await fn();
  } finally {
    step.end = Date.now();
  }
}

/** Load the pipeline as a timed step, flagged so a cache hit is distinguishable. */
function loadPipelineStep(steps: TraceStep[], modelId: string) {
  const cached = pipelines.has(modelId);
  return timeStep(steps, 'local.load_model', { 'betternet.model.cached': cached }, () =>
    getPipeline(modelId)
  );
}

async function zeroShot({ modelId, text, candidateLabels, multiLabel }) {
  const traceSteps: TraceStep[] = [];
  const pipe = await loadPipelineStep(traceSteps, modelId);
  const output = await timeStep<{ labels: string[]; scores: number[] }>(
    traceSteps,
    'local.infer',
    {
      'gen_ai.operation.name': 'zero-shot-classification',
      'gen_ai.request.model': modelId,
      'betternet.input.chars': text?.length ?? 0,
      'betternet.label_count': candidateLabels?.length ?? 0,
    },
    () => pipe(text, candidateLabels, { multi_label: multiLabel })
  );
  return {
    labels: output.labels,
    scores: output.scores,
    traceSteps,
  };
}

const GENERATIVE_PIPELINES = new Set(['text2text-generation', 'text-generation']);

function extractGeneratedText(outputs, prompt) {
  const first = Array.isArray(outputs) ? outputs[0] : outputs;
  const generated = first?.generated_text;
  if (typeof generated === 'string') {
    if (prompt && generated.startsWith(prompt)) {
      return generated.slice(prompt.length).trim();
    }
    return generated.trim();
  }
  if (Array.isArray(generated)) {
    const last = generated.at(-1);
    if (last?.content != null) return String(last.content).trim();
  }
  return '';
}

async function generate({ modelId, prompt, maxNewTokens }) {
  const spec = getLocalModel(modelId);
  if (!GENERATIVE_PIPELINES.has(spec.pipeline)) {
    throw new Error(`Model ${modelId} does not support text generation`);
  }
  const traceSteps: TraceStep[] = [];
  const pipe = await loadPipelineStep(traceSteps, modelId);
  const opts = { max_new_tokens: maxNewTokens ?? 256, do_sample: false };
  const outputs = await timeStep(
    traceSteps,
    'local.infer',
    {
      'gen_ai.operation.name': spec.pipeline,
      'gen_ai.request.model': modelId,
      'gen_ai.request.max_tokens': opts.max_new_tokens,
      'betternet.input.chars': prompt?.length ?? 0,
    },
    () =>
      spec.pipeline === 'text-generation'
        ? pipe([{ role: 'user', content: prompt }], opts)
        : pipe(prompt, opts)
  );
  return { text: extractGeneratedText(outputs, prompt), traceSteps };
}

async function removeModel(modelId) {
  const pipe = pipelines.get(modelId);
  pipelines.delete(modelId);
  if (pipe) {
    try {
      await (pipe as { dispose?: () => Promise<void> | void }).dispose?.();
    } catch (err) {
      console.warn(LOG, 'worker: dispose on remove failed', modelId, err);
    }
  }
  postState(modelId, { status: 'not_installed', progress: 0, error: undefined });
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // Cache API may be limited here; model files may remain in IndexedDB until cleared
  }
}

function startDownload(modelId) {
  if (!modelId) {
    return Promise.reject(new Error('modelId required'));
  }
  console.log(LOG, 'worker: startDownload', modelId);
  downloadFiles.set(modelId, new Map());
  postState(modelId, { status: 'downloading', progress: 0, error: undefined });
  return getPipeline(modelId).catch((err) => {
    const msg = formatOnnxError(err);
    console.error(LOG, 'worker: download failed', modelId, msg, err);
    downloadFiles.delete(modelId);
    postState(modelId, { status: 'error', error: msg });
    throw err;
  });
}

/**
 * Worker heap, when the engine exposes it. `performance.memory` is a
 * main-thread-only Chrome extra, so this is usually null here — offscreen.ts
 * fills in the main-thread numbers.
 */
function workerHeap() {
  const perfMem = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  if (!perfMem) return null;
  return {
    jsHeapUsedBytes: perfMem.usedJSHeapSize,
    jsHeapTotalBytes: perfMem.totalJSHeapSize,
    jsHeapLimitBytes: perfMem.jsHeapSizeLimit,
  };
}

function formatOnnxError(err) {
  if (err instanceof ErrorEvent) {
    return err.message || err.type || 'WebAssembly failed to load (check extension wasm/ files)';
  }
  const msg = err?.message || String(err);
  if (/failed to allocate a buffer|Can't create a session/i.test(msg)) {
    return (
      'Not enough memory to load this model on-device. ' +
      'Close other tabs, delete unused local models, retry, or use MobileBERT. ' +
      `(${msg})`
    );
  }
  return msg;
}

async function handleAction(action, message) {
  switch (action) {
    case 'DOWNLOAD': {
      const { modelId } = message;
      if (!modelId) return { error: 'modelId required' };
      startDownload(modelId).catch((err) => {
        console.error(LOG, 'worker: background download task failed', modelId, err);
      });
      return { ok: true, started: true, modelId };
    }
    case 'REMOVE':
      await removeModel(message.modelId);
      return { ok: true };
    case 'GET_MEMORY':
      return { ...(workerHeap() || {}), loadedModelIds: [...pipelines.keys()] };
    case 'ZERO_SHOT':
      return zeroShot(message);
    case 'GENERATE':
      return generate(message);
    default:
      return { error: `Unknown worker action: ${action}` };
  }
}

self.addEventListener('message', async (event: MessageEvent) => {
  const { id, action, wasmBase } = event.data || {};

  if (action === 'INIT') {
    configureOnnxWasm(wasmBase);
    self.postMessage({ id, result: { ok: true } });
    return;
  }

  const started = Date.now();
  try {
    const result = await handleAction(action, event.data);
    console.log(LOG, `worker: ${action} done in ${Date.now() - started}ms`);
    self.postMessage({ id, result });
  } catch (err) {
    // Errors (notably ErrorEvent) are not structured-cloneable — send a string.
    const message = formatOnnxError(err);
    console.error(LOG, `worker: ${action} failed after ${Date.now() - started}ms:`, message);
    self.postMessage({ id, error: message });
  }
});

self.addEventListener('error', (event) => {
  console.error(LOG, 'worker: uncaught error', event.message);
});

console.log(LOG, 'worker: inference worker loaded');
