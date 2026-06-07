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

// download surfaces offscreen errors
await chrome.offscreen.closeDocument();
const errorPort = createOffscreenPort({
  DOWNLOAD() {
    return { error: 'disk full' };
  },
});
chrome._test.setOffscreenDocumentExists(true);
chrome._test.connectPort(errorPort);
const downloadErr = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'download',
  modelId: 'mobilebert-mnli',
});
assert(downloadErr?.error === 'disk full', `download error should propagate, got: ${JSON.stringify(downloadErr)}`);

// remove delegates to offscreen
await chrome.offscreen.createDocument();
const removeRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'remove',
  modelId: 'mobilebert-mnli',
});
assert(removeRes?.removed === true, 'remove should return offscreen REMOVE response');

// unknown action
const unknownRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_LOCAL_MODEL',
  action: 'nope',
});
assert(unknownRes?.error?.includes('Unknown model action'), 'unknown action should return error');

console.log('✅ model-manager tests passed');
