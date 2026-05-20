/**
 * @deprecated Prefer `analysis.js` — kept for typed imports during migration.
 */

import { analyzeChunksParallel } from '../analysis/engine.js';
import type { Chunk } from '../types/Chunk.js';
import type { ChunkAnalysis } from '../types/ChunkAnalysis.js';
import type { PageMetadata } from '../types/Page.js';
import type { AnalysisOptions } from '../types/AnalysisOptions.js';

export { analyzeChunksParallel };

export class AnalysisEngine {
	async analyzeChunksParallel(
		chunks: Chunk[],
		pageMetadata: Partial<PageMetadata> = {},
		options: Partial<AnalysisOptions> = {},
		onAnalysis?: (chunk: Chunk, result: ChunkAnalysis) => void
	): Promise<ChunkAnalysis[]> {
		return analyzeChunksParallel(
			chunks,
			pageMetadata,
			options,
			onAnalysis as (chunk: object, result: object) => void
		) as Promise<ChunkAnalysis[]>;
	}
}

let defaultInstance: AnalysisEngine | null = null;

export function getDefaultAnalysisEngine(): AnalysisEngine {
	if (!defaultInstance) {
		defaultInstance = new AnalysisEngine();
	}
	return defaultInstance;
}
