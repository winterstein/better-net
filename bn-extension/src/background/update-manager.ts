/**
 * Background wiring for BN_UPDATE_DATA messages and periodic bundle checks.
 */

import {
  checkAllBundles,
  ensureBundlesSeeded,
  getBundle,
  getMeta,
  getStoredBundles,
  isUpdateCheckAlarm,
  scheduleUpdateChecks,
} from '../update-manager/update-manager.js';

export function setupUpdateManager() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'BN_UPDATE_DATA') return false;

    handleUpdateMessage(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err?.message || String(err) }));
    return true;
  });

  chrome.runtime.onInstalled?.addListener(() => {
    void bootstrapUpdateManager();
  });

  chrome.runtime.onStartup?.addListener(() => {
    void bootstrapUpdateManager();
  });

  if (chrome.alarms?.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (!isUpdateCheckAlarm(alarm.name)) return;
      void checkAllBundles().catch((err) => {
        console.warn('[BN:update-manager] periodic check failed:', err);
      });
    });
  }

  void bootstrapUpdateManager();
}

async function bootstrapUpdateManager() {
  await ensureBundlesSeeded();
  scheduleUpdateChecks();
  const meta = await getMeta();
  const dayMs = 24 * 60 * 60 * 1000;
  if (!meta.lastCheckAt || Date.now() - meta.lastCheckAt > dayMs) {
    void checkAllBundles().catch((err) => {
      console.warn('[BN:update-manager] initial check failed:', err);
    });
  }
}

async function handleUpdateMessage(message) {
  const { action, bundleId } = message;

  switch (action) {
    case 'get': {
      if (!bundleId) return { error: 'bundleId required' };
      const entry = await getBundle(bundleId);
      return { bundleId, entry };
    }
    case 'list': {
      const bundles = await getStoredBundles();
      const meta = await getMeta();
      return { bundles, meta };
    }
    case 'check':
      if (bundleId) {
        const { checkBundleForUpdate } = await import('../update-manager/update-manager.js');
        const result = await checkBundleForUpdate(bundleId);
        return { result };
      }
      return checkAllBundles();
    case 'seed':
      await ensureBundlesSeeded();
      return { ok: true };
    default:
      return { error: `Unknown update action: ${action}` };
  }
}
