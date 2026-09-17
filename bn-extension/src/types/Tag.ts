/**
 * Chunk role / modifier tags on `chunk.tags[]`.
 * Roles use key:value `chunk-type:…` (terminology.md Content Classifier); the vocabulary
 * itself lives in `types/Classification.ts`, which is also what routing reads.
 * Ad Blocker tags `advert` / `sponsored` are binary modifiers on the same array
 * (they drive hide/routing; there is no separate ModuleAnalysis for Ad Blocker yet).
 * Issue tags from analyzers live on ModuleAnalysis.tags — see terminology.md.
 */

import { CHUNK_MODIFIERS, CHUNK_ROLES, PAGE_TYPES, chunkRoleTag, pageTypeTag } from './Classification.js';
import type { ChunkModifier, ChunkRole } from './Classification.js';

export type ChunkRoleTag = `chunk-type:${ChunkRole}`;

/** TODO standardise `advert` / `sponsored` to `chunk-type:`-style keys. */
export type ChunkTag = ChunkRoleTag | ChunkModifier;

/** Exactly one of these per chunk. */
export const CHUNK_ROLE_TAGS: ChunkRoleTag[] = CHUNK_ROLES.map(chunkRoleTag);

/** Zero or more per chunk, orthogonal to the role. */
export const CHUNK_MODIFIER_TAGS: ChunkModifier[] = [...CHUNK_MODIFIERS];

export const CHUNK_TYPE_TAGS: ChunkTag[] = [...CHUNK_MODIFIER_TAGS, ...CHUNK_ROLE_TAGS];

/** @deprecated Use ChunkTag — kept as alias while call sites migrate. */
export type Tag = ChunkTag;

/**
 * One tag a user can add or remove in the Content Analysis modal. The label is what the
 * "+" select shows; the id is what gets stored. See specs/feedback.md.
 */
export interface TagSpec {
	id: string;
	label: string;
}

/** The chunk's own tags, offered on the "This chunk" section. */
export const CHUNK_TAG_SPECS: TagSpec[] = [
	{ id: 'chunk-type:article', label: 'Article' },
	{ id: 'chunk-type:post', label: 'Post' },
	{ id: 'chunk-type:search_result', label: 'Search result' },
	{ id: 'chunk-type:comment', label: 'Comment' },
	{ id: 'chunk-type:sidebar', label: 'Sidebar' },
	{ id: 'chunk-type:form', label: 'Form' },
	{ id: 'chunk-type:other', label: 'Other' },
	{ id: 'advert', label: 'Advert' },
	{ id: 'sponsored', label: 'Sponsored / advertorial' },
	{ id: 'product', label: 'Product offer' },
];

/**
 * Page type, as the `page-type:…` key:value tag the modal shows and the user can correct.
 * One value per page, so this is a choice rather than a set — the modal renders it as a
 * select, not as chips (specs/content-classification.md).
 *
 * `unknown` is not offered: "we could not tell" is our answer, not a statement a user
 * would make about their own page.
 */
export const PAGE_TYPE_LABELS: Record<string, string> = {
	article: 'Article',
	listing: 'Listing — feed or index',
	search_results: 'Search results',
	thread: 'Thread — post plus replies',
	product: 'Product',
	checkout: 'Checkout / cart',
	form: 'Form',
	login: 'Sign-in',
	profile: 'Profile',
	media: 'Video / audio',
	reference: 'Reference — docs, wiki, policy',
	app: 'App UI',
	error: 'Error / blocked',
	unknown: 'Unknown',
};

export const PAGE_TYPE_TAG_SPECS: TagSpec[] = PAGE_TYPES.filter((v) => v !== 'unknown').map(
	(value) => ({ id: pageTypeTag(value), label: PAGE_TYPE_LABELS[value] ?? value })
);

/** Human label for a tag id, falling back to the id itself for tags we do not know. */
export function tagLabel(specs: TagSpec[], id: string): string {
	return specs.find((s) => s.id === id)?.label ?? id;
}
