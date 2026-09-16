/**
 * Page type from the page itself (specs/content-classification.md, "How classification is
 * derived"). Cheap first: the site's own schema.org markup, then og:type, then URL shape,
 * then DOM shape. Runs once per page load in the content script — no network, no model.
 *
 * `unknown` is a real answer and the common one. Routing reads it as "analyze anyway"
 * (features/module-routing.ts), so a miss here costs nothing; a false `app` or `profile`
 * would silently stop analysis, which is why only high-precision signals are used.
 */

import type { Classification, PageType } from '../types/Classification.js';

/** The page told us in its own markup. */
const CONFIDENCE_JSONLD = 0.9;
/** A password field, or a checkout/login URL: precise, and the privacy rule leans on it. */
const CONFIDENCE_HARD_SIGNAL = 0.85;
/** og:type is coarse ("article" covers a lot) but publishers do set it deliberately. */
const CONFIDENCE_OG = 0.7;
/** Path patterns: conventional, not guaranteed. */
const CONFIDENCE_URL = 0.7;
/** Shape of the DOM: the weakest signal here, and deliberately just above unknown. */
const CONFIDENCE_DOM = 0.6;

/** Enough prose for `<article>` to mean an article rather than a card. */
const MIN_ARTICLE_CHARS = 400;

/** Parsing every ld+json block on a heavy page is not worth it; the type is in the first few. */
const MAX_JSONLD_BLOCKS = 5;

export const UNKNOWN_PAGE_TYPE: Classification<PageType> = {
	value: 'unknown',
	confidence: 0,
	source: 'none',
};

/**
 * schema.org type → our page type. Types absent from this map (WebPage, WebSite, …) are
 * too generic to route on and fall through to the next classifier.
 */
const SCHEMA_PAGE_TYPES: Record<string, PageType> = {
	newsarticle: 'article',
	article: 'article',
	blogposting: 'article',
	liveblogposting: 'article',
	scholarlyarticle: 'article',
	advertisercontentarticle: 'article',
	report: 'article',
	techarticle: 'reference',
	collectionpage: 'listing',
	searchresultspage: 'search_results',
	discussionforumposting: 'thread',
	qapage: 'thread',
	product: 'product',
	itempage: 'product',
	checkoutpage: 'checkout',
	contactpage: 'form',
	profilepage: 'profile',
	videoobject: 'media',
	audioobject: 'media',
	faqpage: 'reference',
	aboutpage: 'reference',
};

const OG_PAGE_TYPES: Record<string, PageType> = {
	article: 'article',
	product: 'product',
	profile: 'profile',
	video: 'media',
	music: 'media',
};

/**
 * Paths that mean money or credentials — the two page types content analysis must never
 * touch. Matched as a whole path segment, so `/cart` does not catch `/cartoons`.
 */
const HARD_URL_PATTERNS: Array<{ value: PageType; re: RegExp }> = [
	{ value: 'checkout', re: /(^|\/)(checkout|cart|basket|payment|pay|order)(\/|$)/ },
	{
		value: 'login',
		re: /(^|\/)(login|log-in|signin|sign-in|signup|sign-up|register|auth|password)(\/|$)/,
	},
];

const SEARCH_PATH = /(^|\/)(search|results)(\/|$)/;
const SEARCH_QUERY = /[?&](q|query|s|search)=/;

/**
 * Credentials and payment first, ahead of the site's own markup: a false negative here is
 * a privacy failure (page content sent to a model), while a false positive only costs
 * analysis on a sign-in page. Everything after this follows the spec's cheap-first chain.
 */
function hardSignal(doc: Document, path: string): Classification<PageType> | null {
	if (doc.querySelector('input[type="password"]')) {
		return { value: 'login', confidence: CONFIDENCE_HARD_SIGNAL, source: 'dom-shape' };
	}
	for (const { value, re } of HARD_URL_PATTERNS) {
		if (re.test(path)) {
			return { value, confidence: CONFIDENCE_HARD_SIGNAL, source: 'url-shape' };
		}
	}
	return null;
}

/** schema.org `@type`, from `<script type="application/ld+json">`. */
function fromJsonLd(doc: Document): Classification<PageType> | null {
	const blocks = Array.from(
		doc.querySelectorAll('script[type="application/ld+json"]')
	).slice(0, MAX_JSONLD_BLOCKS);
	for (const block of blocks) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(block.textContent || '');
		} catch {
			continue;
		}
		const value = findSchemaType(parsed);
		if (value) return { value, confidence: CONFIDENCE_JSONLD, source: 'jsonld' };
	}
	return null;
}

/**
 * First recognised `@type` in the graph. Publishers nest the page type under `@graph` or
 * `mainEntity`, and often list several types on one node.
 */
function findSchemaType(node: unknown, depth = 0): PageType | null {
	if (!node || depth > 6) return null;
	if (Array.isArray(node)) {
		for (const item of node) {
			const found = findSchemaType(item, depth + 1);
			if (found) return found;
		}
		return null;
	}
	if (typeof node !== 'object') return null;

	const obj = node as Record<string, unknown>;
	for (const name of [obj['@type']].flat()) {
		if (typeof name !== 'string') continue;
		const mapped = SCHEMA_PAGE_TYPES[name.toLowerCase()];
		if (mapped) return mapped;
	}
	for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
		const found = findSchemaType(obj[key], depth + 1);
		if (found) return found;
	}
	return null;
}

function fromOgType(doc: Document): Classification<PageType> | null {
	const content = doc
		.querySelector('meta[property="og:type"]')
		?.getAttribute('content')
		?.trim()
		.toLowerCase();
	if (!content) return null;
	// og:type namespaces its values: "video.movie", "music.song".
	const value = OG_PAGE_TYPES[content] ?? OG_PAGE_TYPES[content.split('.')[0]];
	return value ? { value, confidence: CONFIDENCE_OG, source: 'og-type' } : null;
}

function fromUrlShape(path: string, search: string): Classification<PageType> | null {
	if (SEARCH_QUERY.test(search) || SEARCH_PATH.test(path)) {
		return { value: 'search_results', confidence: CONFIDENCE_URL, source: 'url-shape' };
	}
	return null;
}

function fromDomShape(doc: Document): Classification<PageType> | null {
	const article = doc.querySelector('article');
	if (article && (article.textContent || '').trim().length >= MIN_ARTICLE_CHARS) {
		return { value: 'article', confidence: CONFIDENCE_DOM, source: 'dom-shape' };
	}
	return null;
}

/**
 * The page's type, with the classifier that decided it. Never throws: a page we cannot
 * read is `unknown`, not an error.
 */
export function classifyPageType(doc: Document, url: string): Classification<PageType> {
	if (!doc) return UNKNOWN_PAGE_TYPE;
	let path = '';
	let search = '';
	try {
		const parsed = new URL(url);
		path = parsed.pathname.toLowerCase();
		search = parsed.search.toLowerCase();
	} catch {
		// A chunk of a saved page can arrive with no usable URL; the DOM signals still work.
	}

	try {
		return (
			hardSignal(doc, path) ??
			fromJsonLd(doc) ??
			fromOgType(doc) ??
			fromUrlShape(path, search) ??
			fromDomShape(doc) ??
			UNKNOWN_PAGE_TYPE
		);
	} catch {
		return UNKNOWN_PAGE_TYPE;
	}
}

/**
 * Every confidence this module can emit, so a test can hold them above the routing gate
 * (MIN_CLASSIFICATION_CONFIDENCE) — a classifier whose answers are always discarded is
 * worse than no classifier, because it looks like it works.
 */
export const CLASSIFIER_CONFIDENCES: Record<string, number> = {
	jsonld: CONFIDENCE_JSONLD,
	'hard-signal': CONFIDENCE_HARD_SIGNAL,
	'og-type': CONFIDENCE_OG,
	'url-shape': CONFIDENCE_URL,
	'dom-shape': CONFIDENCE_DOM,
};
