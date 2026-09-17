/**
 * Content Classifier vocabularies — site, page, and chunk type
 * (specs/content-classification.md, terminology.md).
 *
 * Three levels, one primary value each. Type is kept apart from the other two axes:
 * topic (`ChunkAnalysis.primaryTopic`, IAB Tier 1) is what a thing is about, and issue
 * tags (`ModuleAnalysis.tags`) are what is wrong with it. Conflating them is the trap the
 * spec calls out: "health" is a topic, "form" is a type, "government" is an actor.
 *
 * Type drives routing — which analyzers run on a chunk at all (features/module-routing.ts).
 */

/** Per registrable domain. Stored as `site-type:<value>`. Stable for weeks. */
export const SITE_TYPES = [
	'news',
	'magazine',
	'social',
	'forum',
	'video',
	'ecommerce',
	'finance',
	'government',
	'health',
	'education',
	'reference',
	'search',
	'app',
	'corporate',
	'gambling',
	'adult',
	'unknown',
] as const;

export type SiteType = (typeof SITE_TYPES)[number];

/**
 * Per URL. Aligned to schema.org (`article` = NewsArticle/BlogPosting, `thread` =
 * DiscussionForumPosting/QAPage, …) so a page's own JSON-LD can answer directly.
 * `checkout` and `login` are separate from `form`: they carry the hard privacy skip below.
 */
export const PAGE_TYPES = [
	'article',
	'listing',
	'search_results',
	'thread',
	'product',
	'checkout',
	'form',
	'login',
	'profile',
	'media',
	'reference',
	'app',
	'error',
	'unknown',
] as const;

export type PageType = (typeof PAGE_TYPES)[number];

/**
 * Chunk role — exactly one per chunk, stored as `chunk-type:<role>` on `chunk.tags[]`.
 *
 * `other` is the honest fallback and means "we could not tell", not "unremarkable", so
 * routing treats it as unknown and analyzes it (module-routing.ts).
 */
export const CHUNK_ROLES = [
	'article',
	'post',
	'comment',
	'search_result',
	'headline_link',
	'review',
	'product_card',
	'sidebar',
	'form',
	'cta',
	'paywall',
	'modal',
	'cookie_banner',
	'media',
	'chrome',
	'boilerplate',
	'page',
	'other',
] as const;

export type ChunkRole = (typeof CHUNK_ROLES)[number];

/**
 * Roles in use today: assigned by the chunkers (chunking/chunk-tags.ts and the platform
 * extractors) or offered to the user in the Content Analysis modal (Tag.ts
 * CHUNK_TAG_SPECS). The rest of CHUNK_ROLES await classifiers — routing declares them now
 * so adding a classifier does not also mean revisiting five feature definitions.
 * `test/module-routing.test.ts` asserts each of these is routed somewhere.
 */
export const ASSIGNED_CHUNK_ROLES: ChunkRole[] = [
	'article',
	'post',
	'comment',
	'search_result',
	'sidebar',
	'form',
	'other',
];

/**
 * Orthogonal to role; may stack. `advert` / `sponsored` come from the Ad Blocker.
 *
 * `product` is commercial intent, not structure: the chunk offers something for sale — a
 * shop listing, or the main chunk of a commercial landing page. A modifier rather than a
 * role because a role is exactly-one, and a landing page's pitch is still an `article` (or
 * `other`) that we want fact-checked; the `product_card` role is the narrower thing, an
 * item tile in a grid. It is the chunk-level counterpart of the `product` page type, and
 * routes the same way: anti-manipulation's home ground, no bias or toxicity check.
 */
export const CHUNK_MODIFIERS = [
	'advert',
	'sponsored',
	'product',
	'ugc',
	'paywalled',
	'countdown',
] as const;

export type ChunkModifier = (typeof CHUNK_MODIFIERS)[number];

export const CHUNK_ROLE_PREFIX = 'chunk-type:';
export const PAGE_TYPE_PREFIX = 'page-type:';

/** `article` → `chunk-type:article`, the form stored on `chunk.tags[]`. */
export function chunkRoleTag<R extends ChunkRole>(role: R): `chunk-type:${R}` {
	return `${CHUNK_ROLE_PREFIX}${role}`;
}

/** `article` → `page-type:article`, the key:value tag form (terminology.md). */
export function pageTypeTag<P extends PageType>(value: P): `page-type:${P}` {
	return `${PAGE_TYPE_PREFIX}${value}`;
}

/** `page-type:article` → `article`, or undefined for anything else. */
export function pageTypeFromTag(tag: string): PageType | undefined {
	if (!tag?.startsWith(PAGE_TYPE_PREFIX)) return undefined;
	const value = tag.slice(PAGE_TYPE_PREFIX.length);
	return (PAGE_TYPES as readonly string[]).includes(value) ? (value as PageType) : undefined;
}

const ROLE_SET: ReadonlySet<string> = new Set(CHUNK_ROLES);
const MODIFIER_SET: ReadonlySet<string> = new Set(CHUNK_MODIFIERS);

/**
 * The chunk's role. `other` when it carries no role tag or an unrecognised one — both
 * mean "unknown" to routing. First role tag wins; chunks are meant to carry exactly one.
 */
export function chunkRole(chunk: { tags?: string[] } | null | undefined): ChunkRole {
	for (const tag of chunk?.tags ?? []) {
		if (!tag?.startsWith(CHUNK_ROLE_PREFIX)) continue;
		const role = tag.slice(CHUNK_ROLE_PREFIX.length);
		if (ROLE_SET.has(role)) return role as ChunkRole;
	}
	return 'other';
}

export function chunkModifiers(chunk: { tags?: string[] } | null | undefined): ChunkModifier[] {
	return (chunk?.tags ?? []).filter((t) => MODIFIER_SET.has(t)) as ChunkModifier[];
}

/**
 * One classification answer. `source` is the classifier that produced it, so a bad label
 * is traceable to one chain entry rather than to "the classifier" (spec: Evaluation).
 */
export interface Classification<T> {
	value: T;
	/** [0,1]. Below MIN_CLASSIFICATION_CONFIDENCE the value is treated as unknown. */
	confidence: number;
	source: string;
}

/** Spec: "Anything below ~0.5 is treated as unknown." */
export const MIN_CLASSIFICATION_CONFIDENCE = 0.5;

/** The value if we believe it, else undefined. Routing must not act on a guess. */
export function classified<T>(c: Classification<T> | undefined): T | undefined {
	if (!c || c.confidence < MIN_CLASSIFICATION_CONFIDENCE) return undefined;
	return c.value;
}
