/**
 * Chunk-based ad detection tests (no DOM required).
 */

import { isAdChunk, partitionChunks } from '../src/ad-blocker/detect-chunk.js';
import { TAG } from '../src/chunking/chunk-tags.js';

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const sponsoredChunk = {
  text: 'Buy now\nSponsored',
  tags: [TAG.POST],
  metadata: { classes: ['post'], id: null },
  xpath: '/html/body/div[1]',
};

const adClassChunk = {
  text: 'Limited offer inside',
  tags: [TAG.OTHER],
  metadata: { classes: ['ad-banner', 'widget'], id: null },
  xpath: '/html/body/div[2]',
};

const advertTaggedChunk = {
  text: 'Neutral promo copy',
  tags: [TAG.ADVERT, TAG.POST],
  metadata: { classes: ['post'], id: null },
  xpath: '/html/body/div[3]',
};

const articleChunk = {
  text: 'A long form news article about local events and community updates for readers.',
  tags: [TAG.ARTICLE],
  metadata: { classes: ['article-body'], id: 'story-1' },
  xpath: '/html/body/article[1]',
};

assert(isAdChunk(sponsoredChunk), 'sponsored text should be ad');
assert(isAdChunk(adClassChunk), 'ad-banner class should be ad');
assert(isAdChunk(advertTaggedChunk), 'advert tag should be ad');
assert(!isAdChunk(articleChunk), 'normal article should not be ad');

const { adChunks, contentChunks } = partitionChunks(
  [sponsoredChunk, adClassChunk, articleChunk],
  'https://example.com/news'
);
assert(adChunks.length === 2, `expected 2 ad chunks, got ${adChunks.length}`);
assert(contentChunks.length === 1, `expected 1 content chunk, got ${contentChunks.length}`);
assert(
  adChunks.every((c) => c.tags?.includes(TAG.ADVERT)),
  'partitioned ad chunks should have advert tag'
);

console.log('✅ Ad-blocker detect-chunk tests passed');
