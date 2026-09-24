/**
 * Fetch the destination page's *article* for click-unbait (quiet fail).
 *
 * Regex extraction — safe in an MV3 service worker, which has no DOMParser.
 *
 * Taking the first N characters of the stripped page does not work. Measured on a real
 * Upworthy article: nav, topic list and the newsletter form fill the first ~5,200
 * characters and the story starts at 5,271, so a 4,000-character head slice contained no
 * article text at all — the summariser was being asked to summarise a menu. So we look for
 * the article first (JSON-LD, `<article>`, `<main>`), drop page furniture, and only then
 * apply the cap.
 *
 * Traced as `click-unbait.fetch_destination` — usually the slowest step of an unravel, and
 * the one that quietly returns null (paywall, bot block, PDF). Spans carry the status code
 * and status message, content type and character counts; never the response body.
 */

import { traceStep, setAttributes } from '../../tracing/tracer-hook.js';
import type { TraceHandle } from '../../tracing/tracer-hook.js';

export interface DestinationContent {
	title: string;
	text: string;
	url: string;
	/** Which extraction path produced the text — useful when a summary looks wrong. */
	source: 'json-ld' | 'article' | 'main' | 'body';
	/** The page's own one-line summary, when it publishes one. */
	description: string;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_BODY_CHARS = 4_000;

/** Repeated headlines and shared destinations should cost one fetch, not one per chunk. */
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 100;

/** A feed of clickbait must not turn into a hundred outbound requests. */
const MAX_FETCHES_PER_PAGE = 12;

const cache = new Map<string, { at: number; value: DestinationContent | null }>();
const inFlight = new Map<string, Promise<DestinationContent | null>>();

/**
 * One allowance per page, not one globally: the background analyses several tabs from the
 * same service worker, and a single shared counter meant the second page could start
 * already spent. Created on demand, so a caller that forgets `beginDestinationBudget` is
 * still capped rather than unlimited.
 */
const budgets = new Map<string, { used: number; max: number }>();

/** Pages tracked at once. Beyond this the oldest is dropped; it only costs a fresh cap. */
const MAX_TRACKED_PAGES = 8;

function budgetFor(pageUrl: string) {
	let budget = budgets.get(pageUrl);
	if (!budget) {
		budget = { used: 0, max: MAX_FETCHES_PER_PAGE };
		budgets.set(pageUrl, budget);
		evictOldest(budgets, MAX_TRACKED_PAGES);
	}
	return budget;
}

/** Start a fresh fetch allowance for this page. Called once per page analysis. */
export function beginDestinationBudget(pageUrl: string, max = MAX_FETCHES_PER_PAGE) {
	budgets.set(pageUrl, { used: 0, max });
	evictOldest(budgets, MAX_TRACKED_PAGES);
}

/** Test seam: forget cached destinations and every page's allowance. */
export function resetDestinationCache() {
	cache.clear();
	inFlight.clear();
	budgets.clear();
}

function evictOldest(map: Map<string, unknown>, max: number) {
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) return;
		map.delete(oldest);
	}
}

export interface FetchDestinationOptions {
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	/** Page being analysed — picks which fetch allowance this request draws on. */
	pageUrl?: string;
	/** Parent AIQA span; the fetch becomes a child of it. */
	trace?: TraceHandle | null;
}

export function isPublicHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
		const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
		if (
			host === 'localhost' ||
			host.endsWith('.localhost') ||
			host.endsWith('.local') ||
			host.endsWith('.internal') ||
			host.endsWith('.arpa')
		) {
			return false;
		}
		const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
		if (ipv4) {
			const [a, b] = ipv4.slice(1).map(Number);
			if (a === 10 || a === 127 || a === 0) return false;
			if (a === 192 && b === 168) return false;
			if (a === 172 && b >= 16 && b <= 31) return false;
			if (a === 169 && b === 254) return false;
			if (a === 100 && b >= 64 && b <= 127) return false;
		}
		if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

export async function fetchDestinationText(
	url: string,
	opts: FetchDestinationOptions = {}
): Promise<DestinationContent | null> {
	if (!url || !isPublicHttpUrl(url)) return null;

	// Every unravel attempt gets a span, including the ones that never reach the network:
	// a cache hit or a spent budget is why a feed of clickbait shows few fetches.
	return traceStep(
		'click-unbait.fetch_destination',
		{ parent: opts.trace, attributes: { 'betternet.destination.url': url } },
		async (span) => {
			const cached = cache.get(url);
			if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
				setAttributes(span, {
					'betternet.destination.outcome': cached.value ? 'cache_hit' : 'cache_hit_empty',
				});
				return cached.value;
			}

			const pending = inFlight.get(url);
			if (pending) {
				setAttributes(span, { 'betternet.destination.outcome': 'in_flight' });
				return pending;
			}

			const budget = budgetFor(opts.pageUrl || '');
			if (budget.used >= budget.max) {
				setAttributes(span, {
					'betternet.destination.outcome': 'budget_exceeded',
					'betternet.destination.fetches_used': budget.used,
				});
				return null;
			}
			budget.used += 1;
			setAttributes(span, { 'betternet.destination.fetch_index': budget.used });

			const promise = doFetch(url, opts, span).then((value) => {
				inFlight.delete(url);
				if (!value) return value;
				if (cache.size >= MAX_CACHE_ENTRIES) {
					const oldest = cache.keys().next().value;
					if (oldest !== undefined) cache.delete(oldest);
				}
				cache.set(url, { at: Date.now(), value });
				return value;
			});
			inFlight.set(url, promise);
			return promise;
		}
	);
}

async function doFetch(
	url: string,
	opts: FetchDestinationOptions,
	span: TraceHandle | null = null
): Promise<DestinationContent | null> {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetchImpl(url, {
				signal: controller.signal,
				redirect: 'follow',
				credentials: 'omit',
			});
			if (res.url && res.url !== url && !isPublicHttpUrl(res.url)) {
				setAttributes(span, { 'betternet.destination.outcome': 'blocked_private' });
				return null;
			}
			setAttributes(span, {
				'http.response.status_code': res.status,
				'betternet.destination.status_text': res.statusText || '',
				'betternet.destination.redirected': res.url !== url,
			});
			if (!res.ok) {
				setAttributes(span, { 'betternet.destination.outcome': 'http_error' });
				return null;
			}

			const ct = (res.headers.get('content-type') || '').toLowerCase();
			setAttributes(span, { 'betternet.destination.content_type': ct });
			if (ct && !ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('xhtml')) {
				setAttributes(span, { 'betternet.destination.outcome': 'unsupported_content_type' });
				return null;
			}

			const html = await res.text();
			const extracted = extractTextFromHtml(html);
			setAttributes(span, {
				'betternet.destination.html_chars': html.length,
				'betternet.destination.text_chars': extracted.text.length,
				'betternet.destination.title_chars': extracted.title.length,
				'betternet.destination.source': extracted.source,
			});
			if (!extracted.title && !extracted.text) {
				setAttributes(span, { 'betternet.destination.outcome': 'empty_extraction' });
				return null;
			}
			setAttributes(span, { 'betternet.destination.outcome': 'ok' });
			return { ...extracted, url };
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		// Failing quietly is this module's contract — a paywall or bot block is normal — so
		// the span stays OK and carries the reason rather than reporting an error to AIQA.
		const aborted = (error as Error)?.name === 'AbortError';
		setAttributes(span, {
			'betternet.destination.outcome': aborted ? 'timeout' : 'error',
			'betternet.destination.error': (error as Error)?.message || String(error),
		});
		return null;
	}
}

export function extractTextFromHtml(html: string): Omit<DestinationContent, 'url'> {
	const title = stripSiteSuffix(
		clean(
			metaContent(html, 'og:title') ||
				firstTagText(html, 'title') ||
				firstTagText(html, 'h1')
		)
	);

	const description = clean(
		metaContent(html, 'og:description') || metaContent(html, 'description')
	);

	const body = extractBody(html);

	return {
		title,
		// The page's own description is usually an honest one-liner, which is exactly what
		// we are after — so lead with it and let the article text follow.
		text: clip(
			[description, body.text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
			MAX_BODY_CHARS
		),
		source: body.source,
		description,
	};
}

/** Article text, from the most trustworthy source the page offers. */
function extractBody(html: string): { text: string; source: DestinationContent['source'] } {
	const jsonLd = articleBodyFromJsonLd(html);
	if (jsonLd && jsonLd.length > 200) return { text: jsonLd, source: 'json-ld' };

	const stripped = removeNonContent(html);

	const article = largestTagContent(stripped, 'article');
	if (article && textLength(article) > 200) {
		return { text: clean(stripTags(article)), source: 'article' };
	}

	const main = largestTagContent(stripped, 'main');
	if (main && textLength(main) > 200) {
		return { text: clean(stripTags(main)), source: 'main' };
	}

	return { text: clean(stripTags(stripped)), source: 'body' };
}

/**
 * News sites publish the article as schema.org JSON-LD far more often than they mark it up
 * cleanly, and `articleBody` is the story with no furniture at all.
 */
function articleBodyFromJsonLd(html: string): string {
	const blocks = html.match(
		/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
	);
	if (!blocks) return '';

	for (const block of blocks) {
		const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
		let parsed: unknown;
		try {
			parsed = JSON.parse(body.trim());
		} catch {
			continue;
		}
		const found = findArticleBody(parsed);
		if (found) return clean(stripTags(found));
	}
	return '';
}

function findArticleBody(node: unknown, depth = 0): string {
	if (!node || depth > 6) return '';
	if (Array.isArray(node)) {
		for (const item of node) {
			const found = findArticleBody(item, depth + 1);
			if (found) return found;
		}
		return '';
	}
	if (typeof node !== 'object') return '';

	const obj = node as Record<string, unknown>;
	const direct = obj.articleBody;
	if (typeof direct === 'string' && direct.trim().length > 100) return direct;

	for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
		const found = findArticleBody(obj[key], depth + 1);
		if (found) return found;
	}
	return '';
}

/** Regions that exist to run the site. Dropping them is what makes the cap land on prose. */
const NON_CONTENT_TAGS = [
	'script', 'style', 'noscript', 'template', 'svg', 'iframe',
	'nav', 'header', 'footer', 'aside', 'form', 'button', 'select',
];

/** Built once: these patterns are constant, and a fetch used to compile two dozen of them. */
const NON_CONTENT_PATTERNS = NON_CONTENT_TAGS.flatMap((tag) => [
	new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'),
	// Self-closing / unclosed variants leave the opening tag behind; strip it too.
	new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'),
]);

function removeNonContent(html: string): string {
	let out = html;
	for (const pattern of NON_CONTENT_PATTERNS) out = out.replace(pattern, ' ');
	return out;
}

/** The biggest instance of a tag — a page can carry teaser `<article>` cards as well. */
function largestTagContent(html: string, tag: string): string {
	const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
	let best = '';
	let match: RegExpExecArray | null;
	while ((match = re.exec(html))) {
		if (match[1].length > best.length) best = match[1];
	}
	return best;
}

function firstTagText(html: string, tag: string): string {
	const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
	return match ? stripTags(match[1]) : '';
}

function metaContent(html: string, name: string): string {
	const attr = name.startsWith('og:') ? 'property' : 'name';
	const patterns = [
		new RegExp(`<meta[^>]+${attr}=(["'])${name}\\1[^>]*content=(["'])([\\s\\S]*?)\\2`, 'i'),
		new RegExp(`<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]*${attr}=(["'])${name}\\3`, 'i'),
	];
	for (const re of patterns) {
		const match = html.match(re);
		const value = match?.[3] ?? match?.[2];
		if (value?.trim()) return value;
	}
	return '';
}

/** `Headline - Upworthy` / `Headline | The Site` — the suffix is noise in a summary. */
function stripSiteSuffix(title: string): string {
	const match = title.match(/^(.{20,})\s+[|–—-]\s+([^|–—-]{2,40})$/);
	return match ? match[1].trim() : title;
}

function textLength(html: string): number {
	return stripTags(html).replace(/\s+/g, ' ').trim().length;
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : text.slice(0, max);
}

function clean(s: string): string {
	return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function stripTags(s: string): string {
	return s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
	mdash: '—', ndash: '–', hellip: '…', middot: '·',
	lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
	laquo: '«', raquo: '»', bull: '•', deg: '°',
	eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
	uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
	pound: '£', euro: '€', cent: '¢', copy: '©',
	reg: '®', trade: '™', times: '×', minus: '−',
};

/**
 * Numeric entities matter as much as named ones: WordPress writes every apostrophe as
 * `&#039;`, so leaving them undecoded put `it&#039;s` inside the brackets on the page.
 */
function decodeEntities(s: string): string {
	return String(s || '')
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
		.replace(/&([a-z][a-z0-9]*);/gi, (whole, name) => {
			const mapped = NAMED_ENTITIES[String(name).toLowerCase()];
			return mapped ?? whole;
		});
}

function safeCodePoint(code: number): string {
	if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return '';
	try {
		return String.fromCodePoint(code);
	} catch {
		return '';
	}
}
