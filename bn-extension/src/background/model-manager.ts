/**
 * Handles local model download / removal from options and popup.
 * Handles local model download and removal for BetterNet.
 * 
 * Downloads are triggered from the options or popup UI
 * (see: `src/options/options.js` and `src/popup/popup.js`), 
 * and the model files themselves are fetched from trusted sources
 * as defined per-model in `src/ai/model-catalog.js`.
 * 
 * Downloaded models are stored in browser-managed persistent storage
 * (using IndexedDB via the browser's File System Access APIs).
 * The download is done by offscreen.js
 * 
 * This module listens for `BN_LOCAL_MODEL` messages and
 * orchestrates download/remove/status requests between UI and
 * offscreen scripts.
 */

import { sendToOffscreen, ensureOffscreen } from '../ai/local-inference-client.js';
import { logit } from '../utils/logger.js';

export function setupModelManager() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'BN_LOCAL_MODEL') return false;

    console.log('[BN:local-model] background: BN_LOCAL_MODEL', message.action, message.modelId, {
      from: sender.url || sender.id,
    });

    handleLocalModelMessage(message)
      .then((result) => {
        console.log('[BN:local-model] background: BN_LOCAL_MODEL response', message.action, result);
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[BN:local-model] background: BN_LOCAL_MODEL error', message.action, err);
        sendResponse({ error: err.message });
      });
    return true;
  });
}

async function handleLocalModelMessage(message) {
  const { action, modelId } = message;
  logit('log', '[LOCAL_AI] Model action:', action, modelId);

  switch (action) {
    case 'download': {
      console.log('[BN:local-model] background: starting download flow for', modelId);
      await ensureOffscreen();
      const start = await sendToOffscreen('DOWNLOAD', { modelId });
      if (start?.error) throw new Error(start.error);
      return start;
    }
    case 'remove':
      await ensureOffscreen();
      return sendToOffscreen('REMOVE', { modelId });
    case 'status': {
      const { localModels = {} } = await chrome.storage.local.get({ localModels: {} });
      return { models: localModels };
    }
    default:
      return { error: `Unknown model action: ${action}` };
  }
}
