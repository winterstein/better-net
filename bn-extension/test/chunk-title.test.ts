/**
 * Chunk title heuristic tests.
 */

import {
  titleFromHtml,
  titleFromText,
  inferChunkTitle,
  ensureChunkTitle,
} from '../src/chunking/chunk-title.js';
import { finalizeChunk } from '../src/chunking/chunk-tags.js';

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

assert(
  titleFromHtml('<p>intro</p><h2>Section A</h2><h1>Main Title</h1>') === 'Main Title',
  'prefers first h1 over h2'
);
assert(
  titleFromHtml('<h3>Small</h3><h2>Medium</h2>') === 'Medium',
  'uses h2 when no h1'
);
assert(
  titleFromHtml('<h3>Only heading</h3>') === 'Only heading',
  'falls back to h3'
);

assert(
  titleFromText('Hello world. More text here.') === 'Hello world.',
  'first sentence with period'
);
assert(
  titleFromText('No end punctuation here') === 'No end punctuation here',
  'whole line when no sentence end'
);

const chunk = {
  text: 'Body starts here. Rest of article.',
  html: '<article><h2>Article Headline</h2><p>Body</p></article>',
};
assert(inferChunkTitle(chunk) === 'Article Headline', 'html heading beats text');

const textOnly = { text: 'Lead sentence! Second sentence.' };
ensureChunkTitle(textOnly);
assert(textOnly.title === 'Lead sentence!', 'ensureChunkTitle sets from text');

const finalized = { text: 'Fallback title here. More content.', tags: [] };
finalizeChunk(finalized, { url: 'https://example.com' });
assert(finalized.title === 'Fallback title here.', 'finalizeChunk applies title');

console.log('✅ chunk-title tests passed');
