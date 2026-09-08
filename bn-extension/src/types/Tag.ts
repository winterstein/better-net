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
	{ id: 'chunk-type:other', label: 'Other' },
	{ id: 'advert', label: 'Advert' },
	{ id: 'sponsored', label: 'Sponsored / advertorial' },
];

/** Human label for a tag id, falling back to the id itself for tags we do not know. */
export function tagLabel(specs: TagSpec[], id: string): string {
	return specs.find((s) => s.id === id)?.label ?? id;
}
