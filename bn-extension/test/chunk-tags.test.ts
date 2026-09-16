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

// --- ad labels vs prose (regression: whole articles were hidden as ads) ---
// Real text from thepeoplesvoice.tv/study-bill-gates-lab-grown-meat-causes-cancer-in-humans/,
// which the ad-blocker hid because the body says "promoted" and "sponsored".
const article = {
  text:
    'Bill Gates’ lab-grown meat causes cancer in humans who consume it, according to a disturbing new study. ' +
    'Synthetic meat has been heavily promoted by Bill Gates and the globalist elites at the WEF as the solution ' +
    'to so-called climate change. However, this same food has now been shown to cause cancer via the immortalized ' +
    'cell lines used to manufacture it. REN cited an instance where New York City Mayor Eric Adams – a vegan – ' +
    'attended a VIP event sponsored by cultured salmon manufacturer Wildtype.',
  metadata: { classes: ['post', 'type-post', 'category-news'], id: 'post-238066' },
};
assert(!inferAdvert(article), 'article prose mentioning promoted/sponsored is not an advert');

// A related-posts headline: keyword mid-sentence, short enough to look label-ish
const relatedPost = {
  text:
    'Queen Guitarist Brian May, Who Promoted Covid Vaccines During Pandemic, ' +
    'Unable To Use Arm Following Stroke September 4, 2024 11 Comments',
  metadata: { classes: ['mh-custom-posts-item'] },
};
assert(!inferAdvert(relatedPost), 'headline containing "Promoted" is not an advert');

// Real ad units still get caught: the label opens its own segment
assert(
  inferAdvert({ text: 'Advertisement\nBook cheap flights with SkyDeals today, prices from £29 return' }),
  'advertisement label on its own line infers advert'
);
assert(
  inferAdvert({ text: 'Sponsored · Acme Corp — the smarter way to insure your car' }),
  'sponsored label before a separator infers advert'
);
assert(inferAdvert({ text: 'Promoted post: try our new energy drink' }), 'promoted label infers advert');

// Class metadata still wins regardless of length
assert(
  inferAdvert({ text: article.text, metadata: { classes: ['ad-slot'] } }),
  'ad class still infers advert on long text'
);

/*
 * Chunk identity. finalizeChunk is the one place every extractor's chunks pass through, so
 * it is where url + fingerprint get set. Nothing in the chunker called createChunk(), so
 * chunks from real pages used to arrive with both undefined — which silently hid the
 * Content Analysis modal's feedback controls (it needs a fingerprint) and left bn-server
 * with no key for the chunk row. See specs/feedback.md.
 */
const bare = finalizeChunk(
  { text: 'A story about something that happened', title: 'A headline' },
  { url: 'https://news.example.com/story' }
);
assert(bare.url === 'https://news.example.com/story', 'finalizeChunk sets the chunk url');
assert(!!bare.fingerprint, 'finalizeChunk fingerprints the chunk');

// Same url + title is the same chunk across page loads: that is what the fingerprint is for.
const again = finalizeChunk(
  { text: 'A story about something that happened, reworded', title: 'A headline' },
  { url: 'https://news.example.com/story' }
);
assert(again.fingerprint === bare.fingerprint, 'fingerprint is stable across an edit to the body');

// A different page, or a retitled one, is a different chunk.
assert(
  finalizeChunk({ text: 'x', title: 'A headline' }, { url: 'https://news.example.com/other' })
    .fingerprint !== bare.fingerprint,
  'a different page is a different chunk'
);
assert(
  finalizeChunk({ text: 'x', title: 'Another headline' }, { url: 'https://news.example.com/story' })
    .fingerprint !== bare.fingerprint,
  'a retitled chunk is a different chunk'
);

// An extractor that already knows the identity keeps it.
const preset = finalizeChunk(
  { text: 'x', title: 'T', url: 'https://a.example/1', fingerprint: 'given' },
  { url: 'https://b.example/2' }
);
assert(preset.url === 'https://a.example/1', 'an existing chunk url is not overwritten');
assert(preset.fingerprint === 'given', 'an existing fingerprint is not overwritten');

console.log('✅ chunk-tags tests passed');
