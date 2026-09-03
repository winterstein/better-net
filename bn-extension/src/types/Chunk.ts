/**
 * Chunk type definition
 * This file exports the Chunk type and a helper function to create Chunk objects as plain JSON objects
 */

import { hash } from '../utils/hash.js';
import type { TopLevelItem } from './TopLevelItem.js';
import type { PageMetadata } from './Page.js';
import type { Tag } from './Tag.js';

/**
 * The main content type - a web-page can have several chunks, which could be articles, search-results, etc.
 * This describes the content but makes no judgements about it's quality.
 */
/** A link inside a chunk. `label` is the accessible name — a card's story anchor wraps the
 *  image and has no text of its own, so its headline lives in `aria-label`. */
export interface ChunkLink {
	url: string;
	text?: string;
	label?: string;
	isExternal?: boolean;
}

export interface Chunk extends TopLevelItem, PageMetadata {
	/** The headline for an article or post, or the title for a page. */
	title?: string;
	fingerprint: string;
	html?: string;
	text: string;
	images?: string[];
	/** Every link inside the chunk, in document order. */
	links?: ChunkLink[];
	metadata?: Record<string, unknown>;
	/**
	 * The link this chunk's headline actually leads to, resolved from the DOM at chunk time.
	 * `links` is everything in the chunk in document order, which on a card grid is the
	 * neighbour's story; this is the one a reader would land on by clicking the headline.
	 * Null when nothing matched confidently — no link beats the wrong link.
	 */
	primaryLink?: ChunkLink | null;
	/** Semantic categories, e.g. advert, article, post. */
	tags?: Tag[];
	xpath?: string;
	isPrimary?: boolean;
}

/**
 * Helper function to create a Chunk object (plain JSON object, not a class instance)
 * @param data - Partial chunk data with required url and text
 * @returns A Chunk object (plain JSON, not a class instance)
 */
export function createChunk(data: Partial<Chunk> & { url: string; text: string }): Chunk {
	return {
		...data,
		tags: data.tags ?? [],
		fingerprint: fingerprint(data as Chunk),
	} as Chunk;
}

export function fingerprint(chunk: Chunk): string {
	const ftext = chunk.url + (chunk.title || "");
	return hash(ftext);
}