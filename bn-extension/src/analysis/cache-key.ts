/**
 * Default chunk -> cache key (specs/cache/spec.md).
 *
 * Position is left out: a reload can move a chunk's xpath, and the text is the same
 * analysis. The outbound link is included because Click Unbait's result is about that
 * destination, and two chunks can share a headline while pointing at different pages.
 */

import { hash } from '../utils/hash.js';
import type { Chunk } from '../types/Chunk.js';

/** 64-bit key. The shared hash() is 32-bit, which collides too easily across a few thousand entries. */
export function hashCacheKey(text: string): string {
  return hash(`a:${text}`) + hash(`b:${text}`);
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function defaultCacheKey(chunk: Partial<Chunk>): string {
  const title = squash(chunk.title ?? '');
  const text = squash(chunk.text ?? '');
  const body = title && text && !text.startsWith(title) ? `${title}\n${text}` : text || title;
  const link = (chunk.primaryLink?.url ?? '').trim().toLowerCase();
  return hashCacheKey(`${body}\n${link}`);
}
