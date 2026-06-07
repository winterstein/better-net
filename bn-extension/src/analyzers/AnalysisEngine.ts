/**
 * Typed wrapper around analysis engine for server and extension callers.
 */

import { analyzeChunksParallel } from '../analysis/engine.js';
import type { Chunk } from '../types/Chunk.js';
import type { ChunkAnalysis } from '../types/ChunkAnalysis.js';
import type { PageMetadata } from '../types/Page.js';
import type { AnalysisOptions } from '../types/AnalysisOptions.js';

export { analyzeChunksParallel };

export class AnalysisEngine {
	async analyzeChunk(
		chunk: Chunk,
		pageMetadata: Partial<PageMetadata> = {},
		options: Partial<AnalysisOptions> = {}
	): Promise<ChunkAnalysis> {
		const [result] = await analyzeChunksParallel([chunk], pageMetadata, options);
		return result;
	}

	async analyzeChunksParallel(
		chunks: Chunk[],
		pageMetadata: Partial<PageMetadata> = {},
		options: Partial<AnalysisOptions> = {},
		onAnalysis?: (chunk: Chunk, result: ChunkAnalysis) => void
	): Promise<ChunkAnalysis[]> {
		return analyzeChunksParallel(chunks, pageMetadata, options, onAnalysis);
	}
}

let defaultInstance: AnalysisEngine | null = null;

export function getDefaultAnalysisEngine(): AnalysisEngine {
	if (!defaultInstance) {
		defaultInstance = new AnalysisEngine();
	}
	return defaultInstance;
}
