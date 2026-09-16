/**
 * Chunk role / modifier tags on `chunk.tags[]`.
 * Roles use key:value `chunk-type:…` (terminology.md Content Classifier); the vocabulary
 * itself lives in `types/Classification.ts`, which is also what routing reads.
 * Ad Blocker tags `advert` / `sponsored` are binary modifiers on the same array
 * (they drive hide/routing; there is no separate ModuleAnalysis for Ad Blocker yet).
 * Issue tags from analyzers live on ModuleAnalysis.tags — see terminology.md.
 */

import { CHUNK_MODIFIERS, CHUNK_ROLES, chunkRoleTag } from './Classification.js';
import type { ChunkModifier, ChunkRole } from './Classification.js';

export type ChunkRoleTag = `chunk-type:${ChunkRole}`;

/**
 * `chunk-type:video` predates the `media` role and is still read (Classification.ts
 * LEGACY_ROLES) for chunks tagged before the rename.
 * TODO standardise `advert` / `sponsored` to `chunk-type:`-style keys.
 */
export type LegacyChunkTag = 'chunk-type:video';

export type ChunkTag = ChunkRoleTag | ChunkModifier | LegacyChunkTag;

/** Exactly one of these per chunk. */
export const CHUNK_ROLE_TAGS: ChunkRoleTag[] = CHUNK_ROLES.map(chunkRoleTag);

/** Zero or more per chunk, orthogonal to the role. */
export const CHUNK_MODIFIER_TAGS: ChunkModifier[] = [...CHUNK_MODIFIERS];

export const CHUNK_TYPE_TAGS: ChunkTag[] = [
	...CHUNK_MODIFIER_TAGS,
	...CHUNK_ROLE_TAGS,
	'chunk-type:video',
];

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
];

/** Human label for a tag id, falling back to the id itself for tags we do not know. */
export function tagLabel(specs: TagSpec[], id: string): string {
	return specs.find((s) => s.id === id)?.label ?? id;
}
