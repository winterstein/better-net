/**
 * Chunk role / modifier tags on `chunk.tags[]`.
 * Roles use key:value `chunk-type:…` (terminology.md Content Classifier).
 * Ad Blocker tags `advert` / `sponsored` are binary modifiers on the same array
 * (they drive hide/routing; there is no separate ModuleAnalysis for Ad Blocker yet).
 * Issue tags from analyzers live on ModuleAnalysis.tags — see terminology.md.
 */
export const CHUNK_TYPE_TAGS = [
	'advert',
	'sponsored',
	'chunk-type:article',
	'chunk-type:post',
	'chunk-type:search_result',
	'chunk-type:comment',
	'chunk-type:sidebar',
	'chunk-type:other',
] as const;

export type ChunkTag = (typeof CHUNK_TYPE_TAGS)[number];

/** @deprecated Use ChunkTag — kept as alias while call sites migrate. */
export type Tag = ChunkTag;
