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

/** @typedef {import('../types/Tag.js').ChunkTag} ChunkTag */

/** @type {Record<string, ChunkTag>} */
export const TAG = {
  ADVERT: 'advert',
  SPONSORED: 'sponsored',
  ARTICLE: 'chunk-type:article',
  POST: 'chunk-type:post',
  SEARCH_RESULT: 'chunk-type:search_result',
  COMMENT: 'chunk-type:comment',
  SIDEBAR: 'chunk-type:sidebar',
  OTHER: 'chunk-type:other',
};

const ROLE_TAGS = new Set([
  TAG.ARTICLE,
  TAG.POST,
  TAG.SEARCH_RESULT,
  TAG.COMMENT,
  TAG.SIDEBAR,
  TAG.OTHER,
]);

/** Labels an ad unit puts on itself. Matched as a label, never as prose — see
 *  isLikelyAdFromChunkText. */
const AD_LABEL_RE = /^(advertisement|sponsored|promoted)\b/i;
/** Longest chunk that can plausibly be an ad unit. Anything longer is an article: a story
 *  that happens to say "heavily promoted by ..." must not be hidden. */
const MAX_AD_UNIT_TEXT = 400;
/** A label stands alone ("Sponsored", "Advertisement — scroll to continue"), so a segment
 *  much longer than this is a sentence that starts with the word, not a label. */
const MAX_AD_LABEL_SEGMENT = 40;
/** Separators an ad label usually sits behind. */
const AD_LABEL_SEPARATORS = /[\n\r\u00b7\u2022|\u2013\u2014:]+/;

/**
 * @param {object | null | undefined} chunk
 * @param {ChunkTag} tag
 */
export function hasTag(chunk, tag) {
  return Array.isArray(chunk?.tags) && chunk.tags.includes(tag);
}

/**
 * @param {object} chunk
 * @param {ChunkTag} tag
 */
export function addTag(chunk, tag) {
  if (!chunk.tags) chunk.tags = [];
  if (!chunk.tags.includes(tag)) chunk.tags.push(tag);
  return chunk;
}

/**
 * @param {object} chunk
 * @param {ChunkTag[]} tags
 */
export function setContentTags(chunk, tags) {
  const withoutContent = (chunk.tags || []).filter(
    (t) => t === TAG.ADVERT || t === TAG.SPONSORED
  );
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
 * Ad units label themselves: "Sponsored", "ADVERTISEMENT", "Promoted post". Articles only
 * mention those words mid-sentence, so match the label shape — a short segment that opens
 * with the keyword, in a chunk short enough to be an ad slot. A plain substring search here
 * hid whole news stories (any article containing "promoted" or "sponsored").
 * @param {object} chunk
 */
function isLikelyAdFromChunkText(chunk) {
  const text = (chunk.text || '').trim();
  if (!text || text.length > MAX_AD_UNIT_TEXT) return false;
  return text
    .split(AD_LABEL_SEPARATORS)
    .some((segment) => {
      const label = segment.trim();
      return !!label && label.length <= MAX_AD_LABEL_SEGMENT && AD_LABEL_RE.test(label);
    });
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
 * @param {{ platform?: string, url?: string, contentTag?: ChunkTag }} [options]
 */
export function finalizeChunk(chunk, options: any = {}) {
  const { platform, url = '', contentTag } = options;
  ensureChunkTitle(chunk);
  if (!chunk.tags) chunk.tags = [];

  const content =
    contentTag ||
    platformContentTag(platform) ||
    (chunk.metadata?.platform ? platformContentTag(String(chunk.metadata.platform)) : null);

  const hasRoleTag = chunk.tags.some((t) => ROLE_TAGS.has(t));
  if (content && !hasRoleTag) {
    setContentTags(chunk, [content]);
  } else if (!hasRoleTag) {
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
