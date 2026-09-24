/**
 * Which link does a headline actually point at?
 *
 * Click Unbait fetches a chunk's destination and prepends a summary of it, so picking the
 * wrong link is worse than picking none: the reader gets a confident, plausible sentence
 * describing a different article. Taking the chunk's first link is not good enough. On a
 * card grid the story anchor wraps the image, sits *before* the heading in document order,
 * and carries the headline in `aria-label` rather than in text — so the generic chunker
 * files it under the previous card, and every rewrite on the page is off by one.
 *
 * Two halves, kept in one module because they answer the same question:
 * - `findHeadlineLink` (DOM, content script): climb out of the heading to the card and find
 *   the anchor that leads to *this* headline's story.
 * - `pickBestLink` (pure, background): score an already-collected list of links against the
 *   headline, as a fallback for chunkers that do not resolve one.
 *
 * Both refuse to guess. No link is a supported outcome; the wrong link is not.
 */

export interface LinkCandidate {
	url: string;
	text?: string;
	/** Accessible name from `aria-label` / `title` / image `alt` — a card link has no text. */
	label?: string;
}

export interface HeadlineLink {
	url: string;
	text: string;
	label: string;
}

/** How far out of the heading to look for the card's link. Beyond this we are in the grid. */
const MAX_CLIMB = 4;

/** Below this, the best candidate is a guess rather than a match. */
const MIN_SCORE = 0.5;

/** Words that carry no identity, so they neither help nor hurt a slug/headline match. */
const STOPWORDS = new Set([
	'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
	'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this',
	'that', 'these', 'those', 'you', 'your', 'i', 'we', 'they', 'he', 'she', 'his', 'her',
	'their', 'our', 'has', 'have', 'had', 'do', 'does', 'did', 'not', 'can', 'will',
	'just', 'about', 'after', 'before', 'over', 'into', 'than', 'then', 'so', 'if',
]);

/** Site furniture: real links, never the story a headline is promising. */
const FURNITURE_PATH = new RegExp(
	'/(category|categories|tag|tags|topic|topics|section|sections|author|authors|profile|' +
		'about|contact|privacy|privacy-policy|terms|terms-of-use|cookie|cookies|subscribe|' +
		'newsletter|login|log-in|signin|sign-in|signup|sign-up|register|account|search|' +
		'advertise|jobs|rss|feed|sitemap|archive)(/|$)',
	'i'
);

/** One-word homepages that are section hubs, not stories. `/sport` is the example; `/breakfast` is not. */
const SECTION_HUB = new Set([
	'sport', 'sports', 'news', 'world', 'politics', 'business', 'opinion', 'culture',
	'tech', 'technology', 'health', 'science', 'entertainment', 'lifestyle', 'travel',
	'video', 'videos', 'live', 'home', 'weather', 'uk', 'us', 'europe', 'africa', 'asia',
	'americas', 'money', 'markets', 'market', 'football', 'soccer',
]);

/** Share / social endpoints, which carry the story URL as a parameter rather than being it. */
const SOCIAL_HOST =
	/(^|\.)(facebook|twitter|x|linkedin|pinterest|reddit|whatsapp|telegram|t|threads|instagram|tiktok|bsky|mastodon)\.[a-z.]+$/i;

const SHARE_PATH = /\b(share|sharer|intent|submit|dialog)\b/i;

/** Anchor text that is a control, not a headline. */
const CONTROL_TEXT =
	/^(read more|read the full story|continue reading|more|click here|here|link|share|comments?|\d+ comments?|next|previous|home|menu|skip to \w+)$/i;

export function normaliseHeadline(text: string): string {
	return String(text || '')
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[“”„‟]/g, '"')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** Identity-carrying words, for comparing a headline with a URL slug. */
export function contentTokens(text: string): Set<string> {
	const tokens = normaliseHeadline(text)
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
	return new Set(tokens);
}

/** The words a URL's own path spells out. Opaque ids (`/news/c3v9d5x0`) yield nothing. */
export function slugTokens(url: string): Set<string> {
	let path = url;
	try {
		path = new URL(url).pathname;
	} catch {
		// Relative or malformed: treat the whole string as a path.
	}
	return contentTokens(path.replace(/\.[a-z]{2,5}$/i, '').replace(/[/_-]+/g, ' '));
}

/** A link that exists to run the site, not to tell a story. */
export function isFurnitureUrl(url: string, pageUrl?: string): boolean {
	if (!url) return true;
	if (/^(javascript:|mailto:|tel:|#)/i.test(url)) return true;

	let parsed: URL;
	try {
		parsed = new URL(url, pageUrl || undefined);
	} catch {
		return true;
	}
	if (!/^https?:$/i.test(parsed.protocol)) return true;
	if (SOCIAL_HOST.test(parsed.hostname) && SHARE_PATH.test(parsed.pathname + parsed.search)) {
		return true;
	}
	if (SHARE_PATH.test(parsed.search)) return true;
	// The site root and one-word landing pages are sections, not stories.
	if (parsed.pathname === '/' || parsed.pathname === '') return true;
	if (FURNITURE_PATH.test(parsed.pathname)) return true;
	const segments = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
	if (segments.length === 1 && SECTION_HUB.has(segments[0].toLowerCase())) return true;

	if (pageUrl) {
		try {
			const page = new URL(pageUrl);
			if (page.origin === parsed.origin && page.pathname === parsed.pathname) return true;
		} catch {
			// Unparseable page URL: nothing to compare against.
		}
	}
	return false;
}

/**
 * How strongly this link claims to be the headline's story: 1 when its accessible name is
 * the headline, otherwise how much of the headline its URL slug spells out.
 */
export function scoreLink(link: LinkCandidate, headline: string, pageUrl?: string): number {
	if (isFurnitureUrl(link.url, pageUrl)) return 0;

	const target = normaliseHeadline(headline);
	if (!target) return 0;

	const name = normaliseHeadline(link.label || link.text || '');
	if (name && !CONTROL_TEXT.test(name)) {
		if (name === target) return 1;
		// A card link's name is often the headline plus a kicker, or the headline trimmed
		// for width. Containment counts only when the shorter is most of the longer.
		const [short, long] = name.length < target.length ? [name, target] : [target, name];
		if (long.includes(short) && short.length >= long.length * 0.6) return 0.95;
	}

	const wanted = contentTokens(target);
	if (!wanted.size) return 0;
	const slug = slugTokens(link.url);
	if (!slug.size) return 0;

	let shared = 0;
	for (const token of slug) if (wanted.has(token)) shared += 1;
	// Against the smaller set, so neither a terse slug nor a long headline is penalised.
	return 0.9 * (shared / Math.min(wanted.size, slug.size));
}

/**
 * Best-scoring link for this headline, or null when nothing scores well enough to be
 * anything but a guess.
 */
export function pickBestLink(
	links: LinkCandidate[] | undefined,
	headline: string,
	pageUrl?: string
): HeadlineLink | null {
	let best: HeadlineLink | null = null;
	let bestScore = 0;

	for (const link of links || []) {
		if (!link?.url) continue;
		const score = scoreLink(link, headline, pageUrl);
		if (score <= bestScore) continue;
		bestScore = score;
		best = {
			url: resolveUrl(link.url, pageUrl) || link.url,
			text: link.text || '',
			label: link.label || '',
		};
	}

	return bestScore >= MIN_SCORE ? best : null;
}

function resolveUrl(href: string, base?: string): string | null {
	try {
		return new URL(href, base || undefined).href;
	} catch {
		return null;
	}
}

/** What a screen reader would announce for this link. A card link has no text of its own. */
export function accessibleLinkName(anchor: Element): string {
	const aria = anchor.getAttribute('aria-label');
	if (aria?.trim()) return aria.trim();
	const title = anchor.getAttribute('title');
	if (title?.trim()) return title.trim();
	const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
	if (text) return text;
	const img = anchor.querySelector('img[alt]');
	const alt = img?.getAttribute('alt');
	return alt?.trim() || '';
}

/**
 * The link this headline leads to, found by climbing out of the heading into its card.
 *
 * Document order is not a reliable guide (the story anchor usually precedes the heading it
 * belongs to), so we go outward instead: each level up, score every anchor beneath it and
 * keep the best. Stop as soon as a level produces a confident match, before the climb
 * reaches the grid and starts seeing the neighbours' stories.
 */
export function findHeadlineLink(
	element: Element,
	headline: string,
	pageUrl?: string
): HeadlineLink | null {
	if (!element || !headline) return null;

	const own = element.closest?.('a[href]');
	if (own) {
		const candidate = describeAnchor(own, pageUrl);
		if (candidate && scoreLink(candidate, headline, pageUrl) >= MIN_SCORE) return candidate;
	}

	let scope: Element | null = element;
	for (let depth = 0; scope && depth <= MAX_CLIMB; depth += 1) {
		const anchors = Array.from(scope.querySelectorAll?.('a[href]') || []);
		const candidates = anchors
			.map((a) => describeAnchor(a, pageUrl))
			.filter(Boolean) as HeadlineLink[];
		const best = pickBestLink(candidates, headline, pageUrl);
		if (best) return best;
		scope = scope.parentElement;
	}

	return null;
}

function describeAnchor(anchor: Element, pageUrl?: string): HeadlineLink | null {
	const href = anchor.getAttribute('href') || '';
	if (!href) return null;
	const url = resolveUrl(href, pageUrl) || href;
	return {
		url,
		text: (anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
		label: accessibleLinkName(anchor).slice(0, 200),
	};
}
