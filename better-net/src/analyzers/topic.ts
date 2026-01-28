import type { Chunk } from '../types/Chunk.js';
import type { AnalysisOptions } from '../types/AnalysisOptions.js';

export async function topicAnalyzer(chunk: Partial<Chunk>, options: AnalysisOptions) : Promise<string[]> {
	const { mode = this.mode, config = this.config } = options;
	const text = chunk.text || '';
	if (!text || text.length < 100) {
		return [];
	}

	return ['news']; // TODO: implement topic analyzer
}