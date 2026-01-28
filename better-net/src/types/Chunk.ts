/**
 * Chunk type definition
 * This file exports the Chunk type and a helper function to create Chunk objects as plain JSON objects
 */

import { hash } from '../utils/utils.js';
import type { TopLevelItem } from './TopLevelItem.js';
import type { PageMetadata } from './Page.js';

/**
 * The main content type - a web-page can have several chunks, which could be articles, search-results, etc.
 * This describes the content but makes no judgements about it's quality.
 */
export interface Chunk extends TopLevelItem, PageMetadata {
	fingerprint: string;
	html?: string;
	text: string;
	images?: string[];
	links?: string[];
	metadata?: Record<string, unknown>;
	xpath?: string;
	isPrimary?: boolean;
}

/**
 * Helper function to create a Chunk object (plain JSON object, not a class instance)
 * @param data - Partial chunk data with required url and text
 * @returns A Chunk object (plain JSON, not a class instance)
 */
export function createChunk(data: Partial<Chunk> & { url: string; text: string }): Chunk {
	return {...data,
		fingerprint: fingerprint(data as Chunk),
	} as Chunk;
}

export function fingerprint(chunk: Chunk): string {
	const ftext = chunk.url + (chunk.title || "");
	return hash(ftext);
}