/**
 * Semantic category for a page chunk (content role, not quality).
 */
export const CHUNK_TYPE_TAGS = [
	'advert',
	'article',
	'post',
	'search_result',
	'comment',
	'sidebar',
	'other',
] as const;

export type Tag = (typeof CHUNK_TYPE_TAGS)[number];
