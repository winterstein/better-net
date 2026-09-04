/**
 * Unit tests for BN_LOCAL_MODEL background message handling.
 */

import {
  installChromeMock,
  dispatchRuntimeMessage,
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
  portHandlers: {
    DOWNLOAD() {
      return { started: true, modelId: 'mobilebert-mnli' };
    },
    REMOVE(msg) {
      return { removed: true, modelId: msg.modelId };
    },
    GET_MEMORY() {
      return {
        jsHeapUsedBytes: 50_000_000,
        jsHeapTotalBytes: 60_000_000,
        jsHeapLimitBytes: 2_000_000_000,
        loadedModelIds: ['mobilebert-mnli'],
      };
    },
  },
});

const { setupModelManager } = await import('../src/background/model-manager.js');
setupModelManager();

// Non-local-model messages are ignored
const ignored = await dispatchRuntimeMessage(chrome, { type: 'OTHER', action: 'status' });
assert(ignored === undefined, 'non BN_LOCAL_MODEL messages should not be handled');

// status reads storage only
const statusRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'status',
});
assert(
  statusRes?.models?.['mobilebert-mnli']?.status === 'ready',
  'status should return localModels from storage'
);

// download delegates to offscreen
const downloadRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'download',
  modelId: 'mobilebert-mnli',
});
assert(downloadRes?.started === true, 'download should return offscreen DOWNLOAD response');

// download surfaces offscreen errors (after restartOffscreen recreates the doc)
await chrome.offscreen.closeDocument();
const errorPort = createOffscreenPort({
  DOWNLOAD() {
    return { error: 'disk full' };
  },
});
const origCreateForErr = chrome.offscreen.createDocument.bind(chrome.offscreen);
chrome.offscreen.createDocument = async (...args) => {
  const result = await origCreateForErr(...args);
  chrome._test.connectPort(errorPort);
  return result;
};
const downloadErr = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'download',
  modelId: 'mobilebert-mnli',
});
chrome.offscreen.createDocument = origCreateForErr;
assert(downloadErr?.error === 'disk full', `download error should propagate, got: ${JSON.stringify(downloadErr)}`);

// remove delegates to offscreen
await chrome.offscreen.createDocument();
const removeRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'remove',
  modelId: 'mobilebert-mnli',
});
assert(removeRes?.removed === true, 'remove should return offscreen REMOVE response');

// memory reads offscreen heap stats
const memoryRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'memory',
});
assert(memoryRes?.jsHeapUsedBytes === 50_000_000, 'memory should return heap stats');
assert(
  memoryRes?.loadedModelIds?.includes('mobilebert-mnli'),
  'memory should list loaded models'
);

// clearMemory restarts offscreen then returns fresh stats
const clearRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'clearMemory',
});
assert(clearRes?.ok === true, 'clearMemory should return ok');
assert(clearRes?.memory?.jsHeapLimitBytes === 2_000_000_000, 'clearMemory should include memory');

// clearMemory keeps a downloaded model downloaded. 'initialising' covers a warm load of
// weights already on disk, so resetting it to not_installed used to make Settings offer a
// re-download of a model that never left the cache.
chrome.storage.local.set({
  localModels: {
    'mobilebert-mnli': { status: 'initialising', installed: true, progress: 100 },
    'flan-t5-small': { status: 'downloading', progress: 42 },
  },
});
const keptRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'clearMemory',
});
assert(
  keptRes?.models?.['mobilebert-mnli']?.status === 'ready',
  `installed model should revert to ready, got ${JSON.stringify(keptRes?.models?.['mobilebert-mnli'])}`
);
assert(
  keptRes?.models?.['flan-t5-small']?.status === 'not_installed',
  `partial download should reset, got ${JSON.stringify(keptRes?.models?.['flan-t5-small'])}`
);

// The reset has to survive the offscreen restart: a live document is seeded from storage
// and its next state sync overwrites the whole map, so writing after the restart lost it.
const { localModels: afterClear } = await chrome.storage.local.get({ localModels: {} });
assert(
  afterClear?.['flan-t5-small']?.status === 'not_installed',
  `reset should be persisted, got ${JSON.stringify(afterClear?.['flan-t5-small'])}`
);

// cancel unlocks one busy model and leaves the rest alone
chrome.storage.local.set({
  localModels: {
    'mobilebert-mnli': { status: 'ready', installed: true },
    'flan-t5-small': { status: 'downloading', progress: 7 },
  },
});
const cancelRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'cancel',
  modelId: 'flan-t5-small',
});
assert(
  cancelRes?.models?.['flan-t5-small']?.status === 'not_installed',
  `cancel should unlock the card, got ${JSON.stringify(cancelRes?.models?.['flan-t5-small'])}`
);
assert(
  cancelRes?.models?.['mobilebert-mnli']?.status === 'ready',
  'cancel should not touch other models'
);

// unknown action
const unknownRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'nope',
});
assert(unknownRes?.error?.includes('Unknown model action'), 'unknown action should return error');

console.log('✅ model-manager tests passed');
