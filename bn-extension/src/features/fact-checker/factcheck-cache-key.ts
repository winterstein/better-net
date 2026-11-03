/**
 * Fact Checker cache key (specs/cache/spec.md).
 *
 * Same claim, minor wording: lowercased, punctuation and stop-words removed, then a
 * short English stem (not a full Porter stemmer). "not" is kept, so a negated claim
 * stays a different key. Uses the extracted claims when there are any, otherwise the
 * whole text — a later sentence that is not extracted does not change the key.
 */

import { extractClaims } from './extract-claims.js';
import { hashCacheKey } from '../../analysis/cache-key.js';
import type { Chunk } from '../../types/Chunk.js';

/** Dropped because they rarely change what is being claimed. Negation is not in this list. */
const STOP_WORDS = new Set(
  'a an the of to in on for with as at by from and or but is are was were be been being it this that these those'.split(
    ' '
  )
);

function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
  // "es" only after a sibilant, so "vaccines" and "vaccine" still meet (the e belongs to the word).
  if (/(?:s|x|z|ch|sh)es$/.test(word) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

/** Claim text folded so small wording changes share a key. Exported for tests. */
export function normalizeClaimText(text: string): string {
  const lowered = text.toLowerCase().replace(/n't\b/g, ' not ');
  return lowered
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map(stem)
    .join(' ');
}

export function factcheckCacheKey(chunk: Partial<Chunk>): string {
  const text = chunk.text || chunk.title || '';
  const claims = extractClaims(text);
  const source = claims.length ? claims.join(' ') : text;
  return hashCacheKey(normalizeClaimText(source));
}
