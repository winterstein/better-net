/**
 * Page-type classifier tests (src/classify/page-type.ts).
 *
 * Two errors matter more than overall accuracy (specs/content-classification.md,
 * Evaluation): a login or checkout page read as content, and a real article read as
 * something that stops analysis. Both are asserted below.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { CLASSIFIER_CONFIDENCES, classifyPageType } from '../src/classify/page-type.js';
import { MIN_CLASSIFICATION_CONFIDENCE, classified } from '../src/types/Classification.js';
import { hardSkipPageReason, moduleSkipReason } from '../src/features/module-routing.js';

function classify(html: string, url = 'https://example.com/') {
  const doc = new JSDOM(html, { url }).window.document;
  return classifyPageType(doc, url);
}

const PROSE = 'The council met on Tuesday to discuss the bridge. '.repeat(12);

// --- every answer this module gives must clear the routing gate ---

for (const [name, confidence] of Object.entries(CLASSIFIER_CONFIDENCES)) {
	assert.ok(
		confidence >= MIN_CLASSIFICATION_CONFIDENCE,
		`${name} confidence ${confidence} would always be discarded as unknown`
	);
}

// --- schema.org markup, the site's own answer ---

const newsArticle = classify(`
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"WebSite","name":"Example"},
    {"@type":"NewsArticle","headline":"Bridge repairs begin"}]}
  </script>`);
assert.equal(newsArticle.value, 'article');
assert.equal(newsArticle.source, 'jsonld');

assert.equal(classify('<script type="application/ld+json">{"@type":["Thing","QAPage"]}</script>').value, 'thread');
assert.equal(classify('<script type="application/ld+json">{"@type":"ProfilePage"}</script>').value, 'profile');
assert.equal(classify('<script type="application/ld+json">{"@type":"CheckoutPage"}</script>').value, 'checkout');

// Generic and broken markup must fall through, not answer.
assert.equal(classify('<script type="application/ld+json">{"@type":"WebPage"}</script>').value, 'unknown');
assert.equal(classify('<script type="application/ld+json">{ not json</script>').value, 'unknown');

// --- og:type ---

assert.deepEqual(
	classify('<meta property="og:type" content="article">'),
	{ value: 'article', confidence: CLASSIFIER_CONFIDENCES['og-type'], source: 'og-type' }
);
assert.equal(classify('<meta property="og:type" content="video.movie">').value, 'media');
assert.equal(classify('<meta property="og:type" content="website">').value, 'unknown');

// --- URL and DOM shape ---

assert.equal(classify('<p>hi</p>', 'https://shop.example.com/checkout').value, 'checkout');
assert.equal(classify('<p>hi</p>', 'https://shop.example.com/cart/').value, 'checkout');
assert.equal(classify('<p>hi</p>', 'https://example.com/sign-in?next=/home').value, 'login');
assert.equal(classify('<p>hi</p>', 'https://example.com/search?q=bridge').value, 'search_results');
assert.equal(classify(`<article>${PROSE}</article>`).value, 'article');
// A card-sized <article> element is not an article page.
assert.equal(classify('<article><h2>Bridge repairs begin</h2></article>').value, 'unknown');
// Path segments, not substrings: a story about shopping carts is not a checkout.
assert.equal(classify(`<article>${PROSE}</article>`, 'https://example.com/news/cartoons-return').value, 'article');

// --- the asymmetric errors ---

// A password field outranks the page's own markup: a sign-in page that also claims to be
// an article must not be analyzed.
const loginWithMarkup = classify(
	`<script type="application/ld+json">{"@type":"NewsArticle"}</script>
   <form><input type="password" name="pw"></form>`,
	'https://example.com/members'
);
assert.equal(loginWithMarkup.value, 'login');
assert.equal(hardSkipPageReason({ pageType: loginWithMarkup }), 'page:login');

// A plain news article keeps every module.
const article = classify(
	`<meta property="og:type" content="article"><article>${PROSE}</article>`,
	'https://www.bbc.co.uk/news/articles/c123'
);
assert.equal(classified(article), 'article');
assert.equal(hardSkipPageReason({ pageType: article }), null);
for (const id of ['factChecker', 'biasDetector', 'defuseRagebait', 'clickUnbait']) {
	assert.equal(
		moduleSkipReason(id, { tags: ['chunk-type:article'] }, { pageType: article }),
		null,
		`${id} must still run on an article page`
	);
}

// An empty page is unknown, and unknown analyzes.
assert.equal(classifyPageType(new JSDOM('').window.document, 'not a url').value, 'unknown');
assert.equal(classified(classifyPageType(null as any, '')), undefined);

console.log('✓ page-type tests passed');
