/**
 * Hide page elements identified as ads via chunk xpaths.
 */

import { isLikelyAdElement } from '../chunking/chunking-fixed-patterns.js';
import { findElementByXPath } from '../utils/utils.js';
import {
  BN_BLOCKED_ATTR,
  BN_PREVIEW_ATTR,
  isFacebookHost,
  findFacebookFeedPostRoot,
  blockSponsoredFacebookFeedPosts,
} from './facebook-sponsored.js';
import { isAdsPreviewActive, setAdsPreviewActive } from './state.js';

/**
 * @param {Element} el
 * @param {string} [hostname]
 * @returns {Element | null}
 */
export function findAdHideRoot(el, hostname = '') {
  if (!el) return null;

  if (isFacebookHost(hostname)) {
    return findFacebookFeedPostRoot(el) || el;
  }

  let node = el;
  for (let depth = 0; depth < 8 && node; depth++) {
    if (isLikelyAdElement(node)) return node;
    node = node.parentElement;
  }

  return el;
}

/**
 * @param {Element[]} elements
 */
function hideElements(elements) {
  let blocked = 0;
  for (const el of elements) {
    if (!el?.setAttribute || el.getAttribute(BN_BLOCKED_ATTR)) continue;
    el.setAttribute(BN_BLOCKED_ATTR, '1');
    el.style.setProperty('display', 'none', 'important');
    blocked++;
  }
  return blocked;
}

/**
 * Blocked on this page (including while previewing).
 * @param {ParentNode} [root]
 * @returns {number}
 */
export function getBlockedAdCount(root = document) {
  return root.querySelectorAll(`[${BN_BLOCKED_ATTR}]`).length;
}

/**
 * Temporarily reveal blocked ads so the user can see what was hidden.
 * @param {ParentNode} [root]
 * @returns {number}
 */
export function showBlockedAds(root = document) {
  setAdsPreviewActive(true);
  const elements = root.querySelectorAll(`[${BN_BLOCKED_ATTR}]`);
  for (const el of elements) {
    el.setAttribute(BN_PREVIEW_ATTR, '1');
    el.classList.add('bn-ad-block-preview');
    el.style.removeProperty('display');
  }
  return elements.length;
}

/**
 * End preview and re-hide blocked ads.
 * @param {ParentNode} [root]
 * @returns {number}
 */
export function hideBlockedAdsPreview(root = document) {
  setAdsPreviewActive(false);
  const elements = root.querySelectorAll(`[${BN_PREVIEW_ATTR}]`);
  for (const el of elements) {
    el.removeAttribute(BN_PREVIEW_ATTR);
    el.classList.remove('bn-ad-block-preview');
    if (el.getAttribute(BN_BLOCKED_ATTR)) {
      el.style.setProperty('display', 'none', 'important');
    }
  }
  return elements.length;
}

/**
 * @param {object[]} adChunks
 * @param {string} [url]
 * @returns {number} newly hidden elements
 */
export function hideAdChunks(adChunks, url = '') {
  let hostname = '';
  try {
    hostname = url ? new URL(url).hostname : '';
  } catch {
    hostname = '';
  }
  if (!hostname && typeof window !== 'undefined') {
    hostname = window.location?.hostname || '';
  }

  let blocked = 0;

  if (isFacebookHost(hostname)) {
    blocked += blockSponsoredFacebookFeedPosts(document);
  }

  const roots = new Set();
  for (const chunk of adChunks) {
    if (!chunk?.xpath) continue;
    const el = findElementByXPath(chunk.xpath);
    if (!el) continue;
    const root = findAdHideRoot(el, hostname);
    if (root) roots.add(root);
  }

  blocked += hideElements([...roots]);
  return blocked;
}

export { isAdsPreviewActive };
