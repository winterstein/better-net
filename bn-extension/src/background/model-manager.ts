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

import { sendToOffscreen, ensureOffscreen, restartOffscreen } from '../ai/local-inference-client.js';
import { abandonedState, isBusyStatus, type LocalModelState } from '../ai/model-status.js';
import { logit } from '../utils/logger.js';

/**
 * Tear the worker down and settle whatever it was doing. Shared by cancel (one model) and
 * clearMemory (all busy models) — the same operation with a different filter.
 *
 * Storage is rewritten *while the offscreen document is down*, because a live document
 * owns the authoritative copy: on connect it is seeded from storage (INIT_STATE) and its
 * next state change overwrites the whole `localModels` object. Resetting after the restart
 * let the stale pre-reset status come back and re-lock the card.
 */
async function resetBusyModels(modelId?: string): Promise<Record<string, LocalModelState>> {
  let localModels: Record<string, LocalModelState> = {};
  await restartOffscreen(async () => {
    ({ localModels = {} } = await chrome.storage.local.get({ localModels: {} }));
    const targets = modelId ? [modelId] : Object.keys(localModels);
    let changed = false;
    for (const id of targets) {
      if (!isBusyStatus(localModels[id]?.status)) continue;
      localModels[id] = abandonedState(localModels[id]);
      changed = true;
    }
    if (changed) await chrome.storage.local.set({ localModels });
  });
  return localModels;
}

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
      // Fresh offscreen page → clean WASM heap (avoids "failed to allocate a buffer" after prior models).
      await restartOffscreen();
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
    case 'memory': {
      await ensureOffscreen();
      return sendToOffscreen('GET_MEMORY');
    }
    case 'cancel': {
      // Worker may be hung mid-download; tear it down and unlock the card.
      const models = await resetBusyModels(modelId);
      return { ok: true, models };
    }
    case 'clearMemory': {
      // Restarting the offscreen doc is the reliable way to free WASM heap. Whatever the
      // old worker had in flight is gone with it, so unlock those cards for Retry.
      const models = await resetBusyModels();
      const memory = await sendToOffscreen('GET_MEMORY');
      return { ok: true, memory, models };
    }
    default:
      return { error: `Unknown model action: ${action}` };
  }
}
