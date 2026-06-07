/**
 * Chunk tag helpers — advert detection and content-type tagging.
 */

import { isLikelyAdElement } from './chunking-fixed-patterns.js';
import { ensureChunkTitle } from './chunk-title.js';
import { findElementByXPath } from '../utils/utils.js';
import {
  isFacebookHost,
  isFacebookSponsoredPost,
  findFacebookFeedPostRoot,
} from '../ad-blocker/facebook-sponsored.js';

/** @typedef {import('../types/Tag.js').Tag} Tag */

/** @type {Record<string, Tag>} */
export const TAG = {
  ADVERT: 'advert',
  ARTICLE: 'article',
  POST: 'post',
  SEARCH_RESULT: 'search_result',
  COMMENT: 'comment',
  SIDEBAR: 'sidebar',
  OTHER: 'other',
};

const AD_TEXT_KEYWORDS = ['advertisement', 'sponsored', 'promoted'];

/**
 * @param {object | null | undefined} chunk
 * @param {Tag} tag
 */
export function hasTag(chunk, tag) {
  return Array.isArray(chunk?.tags) && chunk.tags.includes(tag);
}

/**
 * @param {object} chunk
 * @param {Tag} tag
 */
export function addTag(chunk, tag) {
  if (!chunk.tags) chunk.tags = [];
  if (!chunk.tags.includes(tag)) chunk.tags.push(tag);
  return chunk;
}

/**
 * @param {object} chunk
 * @param {Tag[]} tags
 */
export function setContentTags(chunk, tags) {
  const withoutContent = (chunk.tags || []).filter((t) => t === TAG.ADVERT);
  chunk.tags = [...new Set([...tags, ...withoutContent])];
  return chunk;
}

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
 * Whether chunk is an advert or sponsored unit (does not mutate tags).
 * @param {object} chunk
 * @param {string} [url]
 */
export function inferAdvert(chunk, url = '') {
  if (!chunk) return false;
  if (hasTag(chunk, TAG.ADVERT)) return true;

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
 * @param {object} chunk
 * @param {string} [url]
 */
export function ensureAdvertTag(chunk, url = '') {
  if (inferAdvert(chunk, url)) addTag(chunk, TAG.ADVERT);
  return chunk;
}

/** @param {string} [platform] */
function platformContentTag(platform) {
  switch (platform) {
    case 'google':
    case 'duckduckgo':
      return TAG.SEARCH_RESULT;
    case 'facebook':
    case 'reddit':
    case 'threads':
    case 'bluesky':
      return TAG.POST;
    default:
      return null;
  }
}

/**
 * Apply content + advert tags before returning chunks from extractors.
 * @param {object} chunk
 * @param {{ platform?: string, url?: string, contentTag?: Tag }} [options]
 */
export function finalizeChunk(chunk, options: any = {}) {
  const { platform, url = '', contentTag } = options;
  ensureChunkTitle(chunk);
  if (!chunk.tags) chunk.tags = [];

  const content =
    contentTag ||
    platformContentTag(platform) ||
    (chunk.metadata?.platform ? platformContentTag(String(chunk.metadata.platform)) : null);

  const hasContentTag = chunk.tags.some((t) => t !== TAG.ADVERT);
  if (content && !hasContentTag) {
    setContentTags(chunk, [content]);
  } else if (!hasContentTag) {
    addTag(chunk, TAG.OTHER);
  }

  ensureAdvertTag(chunk, url);
  return chunk;
}

/**
 * @param {object[]} chunks
 * @param {{ platform?: string, url?: string }} [options]
 */
export function finalizeChunks(chunks, options: any = {}) {
  return chunks.map((c) => finalizeChunk(c, options));
}
