/**
 * Ad detection for content chunks (chunker → ad-blocker pipeline).
 */

import { isLikelyAdElement } from '../chunking/chunking-fixed-patterns.js';
import { findElementByXPath } from '../utils/utils.js';
import {
  isFacebookHost,
  isFacebookSponsoredPost,
  findFacebookFeedPostRoot,
} from './facebook-sponsored.js';

const AD_TEXT_KEYWORDS = ['advertisement', 'sponsored', 'promoted'];

/**
 * @param {object} chunk
 */
function isLikelyAdFromChunkMetadata(chunk) {
  const fakeElement = {
    classList: chunk.metadata?.classes || [],
    id: chunk.metadata?.id || '',
    getAttribute: (name) => {
      const attrs = chunk.metadata?.dataAttributes;
      if (!attrs) return null;
      return attrs[name] ?? null;
    },
    parentElement: null,
  };
  return isLikelyAdElement(fakeElement);
}

/**
 * @param {object} chunk
 */
function isLikelyAdFromChunkText(chunk) {
  const text = (chunk.text || '').toLowerCase();
  return AD_TEXT_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * @param {object} chunk
 * @param {string} [url]
 */
export function isAdChunk(chunk, url = '') {
  if (!chunk) return false;
  if (chunk.metadata?.isAd) return true;

  let hostname = '';
  try {
    hostname = url ? new URL(url).hostname : '';
  } catch {
    hostname = '';
  }
  if (!hostname && typeof window !== 'undefined') {
    hostname = window.location?.hostname || '';
  }

  if (isFacebookHost(hostname) && chunk.xpath) {
    const el = findElementByXPath(chunk.xpath);
    if (el) {
      const root = findFacebookFeedPostRoot(el) || el;
      if (isFacebookSponsoredPost(root)) return true;
    }
  }

  return isLikelyAdFromChunkMetadata(chunk) || isLikelyAdFromChunkText(chunk);
}

/**
 * @param {object[]} chunks
 * @param {string} [url]
 * @returns {{ contentChunks: object[], adChunks: object[] }}
 */
export function partitionChunks(chunks, url = '') {
  const contentChunks = [];
  const adChunks = [];
  for (const chunk of chunks) {
    if (isAdChunk(chunk, url)) {
      adChunks.push(chunk);
    } else {
      contentChunks.push(chunk);
    }
  }
  return { contentChunks, adChunks };
}
