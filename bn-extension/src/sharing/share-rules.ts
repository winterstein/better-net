/**
 * Which pages and chunks may be shared with bn-server, and which are private
 * (bn-server/specs/shared-analysis/spec.md "Suitable websites").
 *
 * Pure rules, no chrome and no network: the content script, the background worker and
 * bn-server (via its bn-extension-src symlink) all read this file. Fetching the
 * server-managed list is sharing/shared-analysis-client.ts.
 *
 * Order: private, then the site list (block, allow), then the type rules. The type rules
 * are exclusions, so an unknown type passes.
 */

import { chunkRole, classified } from '../types/Classification.js';
import type { ChunkRole, Classification, PageType, SiteType } from '../types/Classification.js';

export const SHARE_SKIP_SITE_TYPES: SiteType[] = ['adult'];

export const SHARE_SKIP_PAGE_TYPES: PageType[] = [
	'listing', 'search_results', 'checkout', 'form', 'login', 'profile', 'media', 'app', 'error',
];

export const SHARE_SKIP_CHUNK_ROLES: ChunkRole[] = [
	'sidebar', 'form', 'paywall', 'modal', 'cookie_banner', 'chrome', 'boilerplate',
];

/**
 * - allow: definitely good for shared analysis. Overrides the site-type rule only: a login
 *   page on a good site is still not shared.
 * - block: definitely unsuitable. Nothing is looked up or uploaded.
 * - private: block, and also no AIQA trace and no feedback. See `isPrivatePage`.
 */
export type SiteListKind = 'allow' | 'block' | 'private';

export interface SiteListEntry {
	/** A domain, with an optional path prefix: `x.com`, `x.com/messages`. Covers subdomains. */
	pattern: string;
	kind: SiteListKind;
}

/**
 * The seed list, used until the server's copy is fetched and whenever it cannot be.
 * bn-server serves this merged with its own `siteList` table, which is where the list is
 * meant to grow — keep this short.
 */
export const DEFAULT_SITE_LIST: SiteListEntry[] = [
	{ pattern: 'x.com', kind: 'allow' },
	{ pattern: 'twitter.com', kind: 'allow' },
	{ pattern: 'x.com/messages', kind: 'private' },
	{ pattern: 'twitter.com/messages', kind: 'private' },
	{ pattern: 'x.com/i/chat', kind: 'private' },
	{ pattern: 'facebook.com', kind: 'block' },
	{ pattern: 'facebook.com/messages', kind: 'private' },
	{ pattern: 'messenger.com', kind: 'private' },
	{ pattern: 'web.whatsapp.com', kind: 'private' },
	{ pattern: 'web.telegram.org', kind: 'private' },
	{ pattern: 'instagram.com/direct', kind: 'private' },
	{ pattern: 'linkedin.com/messaging', kind: 'private' },
	{ pattern: 'mail.google.com', kind: 'private' },
	{ pattern: 'outlook.live.com', kind: 'private' },
	{ pattern: 'outlook.office.com', kind: 'private' },
	{ pattern: 'mail.yahoo.com', kind: 'private' },
	{ pattern: 'mail.proton.me', kind: 'private' },
	{ pattern: 'docs.google.com', kind: 'private' },
	{ pattern: 'drive.google.com', kind: 'private' },
];

/** When two entries are equally specific, the more cautious one wins. */
const KIND_CAUTION: Record<SiteListKind, number> = { allow: 0, block: 1, private: 2 };

/** The chunk modifier tag for private content (types/Classification.ts CHUNK_MODIFIERS). */
export const PRIVATE_TAG = 'private';

function parseUrl(url: string): URL | null {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
	} catch {
		return null;
	}
}

/** The kind of the most specific entry covering this url (longest host, then longest path), or null. */
export function matchSiteList(url: string, list: SiteListEntry[] = DEFAULT_SITE_LIST): SiteListKind | null {
	const parsed = parseUrl(url);
	if (!parsed) return null;
	const host = parsed.hostname.toLowerCase();
	const path = parsed.pathname.toLowerCase();
	let best: { kind: SiteListKind; score: number } | null = null;
	for (const entry of list) {
		const pattern = String(entry.pattern ?? '').toLowerCase().replace(/^www\./, '');
		const slash = pattern.indexOf('/');
		const entryHost = slash < 0 ? pattern : pattern.slice(0, slash);
		const entryPath = slash < 0 ? '' : pattern.slice(slash);
		if (!entryHost || !(entry.kind in KIND_CAUTION)) continue;
		if (host !== entryHost && !host.endsWith(`.${entryHost}`)) continue;
		// A path prefix ends at a segment: /messages covers /messages/123, not /messagesboard.
		if (entryPath && path !== entryPath && !path.startsWith(`${entryPath}/`)) continue;
		// Host length dominates; a path only separates entries for the same host.
		const score = entryHost.length * 10000 + entryPath.length * 10 + KIND_CAUTION[entry.kind];
		if (!best || score > best.score) best = { kind: entry.kind, score };
	}
	return best?.kind ?? null;
}

/** localhost, an IP address, or an intranet-style name: never a public page. */
function isLocalHost(host: string): boolean {
	return (
		!host.includes('.') ||
		host.includes(':') ||
		/^\d+\.\d+\.\d+\.\d+$/.test(host) ||
		/\.(local|localhost|internal|lan|home|test)$/.test(host)
	);
}

/** Query parameters that pick the article on sites that do not use paths. Everything else is dropped. */
const KEEP_QUERY_PARAMS = ['id', 'p', 'story', 'article'];

/**
 * The form of a url that is sent to the server: no fragment, and no query string beyond
 * the few parameters that identify a page. Tracking and session parameters stay here.
 * Null for anything that is not a public http(s) page.
 */
export function normalizeShareUrl(url: string): string | null {
	const parsed = parseUrl(url);
	if (!parsed) return null;
	const host = parsed.hostname.toLowerCase();
	if (isLocalHost(host)) return null;
	const kept = new URLSearchParams();
	for (const name of KEEP_QUERY_PARAMS) {
		const value = parsed.searchParams.get(name);
		if (value) kept.set(name, value);
	}
	const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : '/';
	const query = kept.toString();
	return `${parsed.protocol}//${host}${path}${query ? `?${query}` : ''}`;
}

export interface SharePage {
	url?: string;
	pageType?: Classification<PageType>;
	siteType?: Classification<SiteType>;
	private?: boolean;
}

/** Private content never leaves the browser: no sharing, no AIQA trace, no feedback. */
export function isPrivatePage(page: SharePage, list: SiteListEntry[] = DEFAULT_SITE_LIST): boolean {
	return !!page.private || matchSiteList(page.url ?? '', list) === 'private';
}

export function isPrivateChunk(chunk: { tags?: string[] } | null | undefined): boolean {
	return !!chunk?.tags?.includes(PRIVATE_TAG);
}

/**
 * Why this page must not be looked up or uploaded, or null when it may be.
 * The string is for traces and tests, like module-routing's skip reasons.
 */
export function sharePageBlockReason(page: SharePage, list: SiteListEntry[] = DEFAULT_SITE_LIST): string | null {
	if (!normalizeShareUrl(page.url ?? '')) return 'url';
	if (page.private) return 'private';
	const listed = matchSiteList(page.url, list);
	if (listed === 'private' || listed === 'block') return `list:${listed}`;
	const pageType = classified(page.pageType);
	if (pageType && SHARE_SKIP_PAGE_TYPES.includes(pageType)) return `page:${pageType}`;
	const siteType = classified(page.siteType);
	if (listed !== 'allow' && siteType && SHARE_SKIP_SITE_TYPES.includes(siteType)) return `site:${siteType}`;
	return null;
}

/** Why this chunk must not be shared, or null. An unknown role (`other`) passes. */
export function shareChunkBlockReason(chunk: { tags?: string[] } | null | undefined): string | null {
	if (isPrivateChunk(chunk)) return 'private';
	const role = chunkRole(chunk);
	return SHARE_SKIP_CHUNK_ROLES.includes(role) ? `role:${role}` : null;
}
