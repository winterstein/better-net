/**
 * Ad detection for content chunks (chunker → ad-blocker pipeline).
 */

import { inferAdvert, ensureAdvertTag, hasTag, TAG } from '../chunking/chunk-tags.js';

/**
 * @param {object} chunk
 * @param {string} [url]
 */
export function isAdChunk(chunk, url = '') {
  return inferAdvert(chunk, url);
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
      ensureAdvertTag(chunk, url);
      adChunks.push(chunk);
    } else {
      contentChunks.push(chunk);
    }
  }
  return { contentChunks, adChunks };
}

export { hasTag, TAG };
