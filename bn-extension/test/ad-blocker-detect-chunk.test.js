/**
 * Chunk-based ad detection tests (no DOM required).
 */

import { isAdChunk, partitionChunks } from '../src/ad-blocker/detect-chunk.js';

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const sponsoredChunk = {
  text: 'Buy now\nSponsored',
  metadata: { classes: ['post'], id: null },
  xpath: '/html/body/div[1]',
};

const adClassChunk = {
  text: 'Limited offer inside',
  metadata: { classes: ['ad-banner', 'widget'], id: null },
  xpath: '/html/body/div[2]',
};

const articleChunk = {
  text: 'A long form news article about local events and community updates for readers.',
  metadata: { classes: ['article-body'], id: 'story-1' },
  xpath: '/html/body/article[1]',
};

assert(isAdChunk(sponsoredChunk), 'sponsored text should be ad');
assert(isAdChunk(adClassChunk), 'ad-banner class should be ad');
assert(!isAdChunk(articleChunk), 'normal article should not be ad');

const { adChunks, contentChunks } = partitionChunks(
  [sponsoredChunk, adClassChunk, articleChunk],
  'https://example.com/news'
);
assert(adChunks.length === 2, `expected 2 ad chunks, got ${adChunks.length}`);
assert(contentChunks.length === 1, `expected 1 content chunk, got ${contentChunks.length}`);

console.log('✅ Ad-blocker detect-chunk tests passed');
