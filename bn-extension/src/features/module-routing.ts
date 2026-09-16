/**
 * Which chunks each module may run on — the routing matrix from
 * specs/content-classification.md ("Routing"). Classify before analyzing: a checkout form
 * does not want a fact-check, and an advert slot is not worth the call.
 *
 * One place, per spec: a module may not opt itself out inside its own `analyze`, so what
 * runs where can be read and evaluated without reading five analyzers. Deliberately
 * separate from registry.ts for the same reason module-tags.ts is — the registry pulls in
 * the LLM clients behind each analyzer, and this table is pure data.
 *
 * Composes with, and is applied after, user settings (module toggles, Off-List,
 * domainOverrides — see engine.ts enabledFeaturesFromSettings).
 *
 * `roles` is an allow-list, so the spec's per-module skip lists are its complement and are
 * not repeated here: one list to read, one to keep honest.
 */

import {
	chunkModifiers,
	chunkRole,
	classified,
	type ChunkModifier,
	type ChunkRole,
	type Classification,
	type PageType,
	type SiteType,
} from '../types/Classification.js';

export interface AppliesTo {
	/** Roles the module is for. Absent/empty = any role, subject to the skips below. */
	roles?: ChunkRole[];
	/** Modifiers that veto the module (e.g. `advert` for the content analyzers). */
	skipModifiers?: ChunkModifier[];
	/** Page types it must never run on. Applied only once a page type is known. */
	skipPages?: PageType[];
	/** Site types it must never run on. Applied only once a site type is known. */
	skipSites?: SiteType[];
}

/** Transactional UI — anti-manipulation's home ground, and nobody else's. */
const TRANSACTIONAL: ChunkRole[] = ['form', 'cta', 'product_card'];

export const MODULE_ROUTING: Record<string, AppliesTo> = {
	factChecker: {
		roles: ['article', 'post', 'comment', 'search_result', 'headline_link', 'review'],
		// Adverts do carry false health and investment claims, but the text we can reach is
		// usually a brand name and a disclosure label — the claim lives in the image. Revisit
		// when ad chunks can capture the creative.
		skipModifiers: ['advert'],
		skipPages: ['checkout', 'login', 'app', 'form', 'profile', 'error'],
	},
	biasDetector: {
		roles: ['article', 'post', 'comment', 'search_result', 'headline_link'],
		skipModifiers: ['advert'],
		skipPages: ['checkout', 'login', 'app', 'product', 'form', 'error'],
	},
	antiManipulation: {
		// The inversion of the fact-check list: the one feature that wants the transactional
		// furniture, and the one that copes with unstructured UI.
		roles: [...TRANSACTIONAL, 'cookie_banner', 'paywall', 'modal', 'post', 'article'],
	},
	defuseRagebait: {
		roles: ['post', 'comment', 'article', 'headline_link'],
		skipPages: ['checkout', 'login', 'app', 'product', 'error'],
	},
	clickUnbait: {
		roles: ['headline_link', 'search_result', 'post', 'article'],
		skipModifiers: ['advert'],
		skipPages: ['checkout', 'login', 'app', 'form', 'error'],
	},
};

/**
 * No content analysis at all on these page types, whatever the user's settings say.
 * A privacy rule as much as a relevance one: a sign-in page or a payment page must not be
 * sent to a model. Ad Blocker, Cookie Cutter, and Privacy Shield are unaffected — they
 * never read page content off to one.
 *
 * It does cost us dark-pattern detection on checkout, which is where dark patterns bite
 * hardest; the spec's antiManipulation "priority pages" and this rule disagree, and
 * privacy wins until anti-manipulation can run locally.
 */
export const HARD_SKIP_PAGE_TYPES: PageType[] = ['login', 'checkout'];

/** What routing knows about the page. Populated by the classifiers (spec: still to come). */
export interface PageClassification {
	pageType?: Classification<PageType>;
	siteType?: Classification<SiteType>;
}

/**
 * Reason to run no content analysis on this page, or null. Only fires on a page type we
 * are confident about; an unknown page type is not a reason to stay silent.
 */
export function hardSkipPageReason(page: PageClassification = {}): string | null {
	const pageType = classified(page.pageType);
	return pageType && HARD_SKIP_PAGE_TYPES.includes(pageType) ? `page:${pageType}` : null;
}

/**
 * Why `moduleId` should not run on this chunk, or null to run it.
 *
 * The string is for traces and tests, not users: `role:sidebar`, `modifier:advert`,
 * `page:checkout`.
 *
 * Unknown beats silence, in both directions:
 * - A chunk with no role tag reads as `other`, which means "we could not tell" — so it is
 *   analyzed. Today's generic chunker tags plain prose `other`, and an allow-list that
 *   excluded it would quietly stop fact-checking ordinary articles.
 * - An unknown page or site type never skips anything.
 */
export function moduleSkipReason(
	moduleId: string,
	chunk: { tags?: string[] } | null | undefined,
	page: PageClassification = {}
): string | null {
	const rule = MODULE_ROUTING[moduleId];
	if (!rule) return null; // A module with no routing declared runs everywhere.

	const pageType = classified(page.pageType);
	if (pageType && rule.skipPages?.includes(pageType)) return `page:${pageType}`;

	const siteType = classified(page.siteType);
	if (siteType && rule.skipSites?.includes(siteType)) return `site:${siteType}`;

	const modifier = chunkModifiers(chunk).find((m) => rule.skipModifiers?.includes(m));
	if (modifier) return `modifier:${modifier}`;

	const role = chunkRole(chunk);
	if (role === 'other') return null;
	if (rule.roles?.length && !rule.roles.includes(role)) return `role:${role}`;
	return null;
}

/** Split `moduleIds` into the ones to run on this chunk and the ones skipped, with why. */
export function routeChunk(
	moduleIds: string[],
	chunk: { tags?: string[] } | null | undefined,
	page: PageClassification = {}
): { run: string[]; skipped: Record<string, string> } {
	const run: string[] = [];
	const skipped: Record<string, string> = {};
	for (const id of moduleIds) {
		const reason = moduleSkipReason(id, chunk, page);
		if (reason) skipped[id] = reason;
		else run.push(id);
	}
	return { run, skipped };
}
