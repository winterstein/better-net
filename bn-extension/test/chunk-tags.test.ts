/**
 * Chunk tag helper tests.
 */

import { TAG, hasTag, inferAdvert, finalizeChunk } from '../src/chunking/chunk-tags.js';

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const chunk = { text: 'Hello world', metadata: { platform: 'reddit' } };
finalizeChunk(chunk, { platform: 'reddit', url: 'https://reddit.com/r/test' });
assert(hasTag(chunk, TAG.POST), 'reddit chunk should be tagged post');
assert(!hasTag(chunk, TAG.ADVERT), 'plain post should not be advert');

const sponsored = {
  text: 'Shop now — Sponsored',
  tags: [TAG.POST],
  metadata: { classes: ['feed-item'] },
};
assert(inferAdvert(sponsored), 'sponsored text infers advert');

console.log('✅ chunk-tags tests passed');
