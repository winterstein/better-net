/**
 * Page-level ad blocking (content script).
 */

import { mergeSettings, isModuleEnabled } from '../settings/modules-esm.js';
import {
  isFacebookHost,
  blockSponsoredFacebookFeedPosts,
} from './facebook-sponsored.js';
import {
  hideAdChunks,
  showBlockedAds,
  hideBlockedAdsPreview,
  getBlockedAdCount,
  isAdsPreviewActive,
} from './hide-chunks.js';

export { showBlockedAds, hideBlockedAdsPreview, getBlockedAdCount, isAdsPreviewActive };

/**
 * @returns {Promise<import('../settings/modules-esm.js').mergeSettings extends Function ? ReturnType<typeof mergeSettings> : object>}
 */
async function loadSettings() {
  const stored = await chrome.storage.sync.get(null);
  return mergeSettings(stored);
}

/**
 * @param {object} settings
 * @param {string} [hostname]
 */
export function shouldBlockPageAds(settings, hostname) {
  if (!isModuleEnabled(settings, 'adBlocker', hostname)) return false;
  return settings.modules?.adBlocker?.blockPageAds !== false;
}

/**
 * Hide ad chunks from the chunker pipeline.
 * @param {object[]} adChunks
 * @param {string} [url]
 */
export function blockAdsFromChunks(adChunks, url = '') {
  if (!adChunks?.length) return 0;
  return hideAdChunks(adChunks, url);
}

/**
 * @param {object} settings
 * @returns {(() => void) | null}
 */
export function startPageAdBlocker(settings) {
  const hostname = window.location.hostname;
  if (!shouldBlockPageAds(settings, hostname)) return null;

  if (!isFacebookHost(hostname)) return null;

  return startFacebookFeedAdBlocker();
}

function startFacebookFeedAdBlocker() {
  let scheduled = false;

  const run = () => {
    blockSponsoredFacebookFeedPosts(document);
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      run();
    });
  };

  run();

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const feedPoll = setInterval(() => {
    if (document.querySelector('[role="feed"]')) {
      run();
      clearInterval(feedPoll);
    }
  }, 500);
  setTimeout(() => clearInterval(feedPoll), 15000);

  return () => {
    observer.disconnect();
    clearInterval(feedPoll);
  };
}

/**
 * Load settings and start ad blocking when enabled.
 */
export async function initAdBlocker() {
  try {
    const settings = await loadSettings();
    return startPageAdBlocker(settings) ?? (() => {});
  } catch {
    return () => {};
  }
}
