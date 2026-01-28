import type { Statement } from './Statement.js';
import type { ChunkAnalysisSummary } from './ChunkAnalysisSummary.js';
import type { TopLevelItem } from './TopLevelItem.js';
import type { AspectAnalysis } from './AspectAnalysis.js';
/**
 * The top-level quality analysis result for a chunk. Acts as a container for the statements extracted from the chunk and the analysis results for those statements.
 */
export interface ChunkAnalysis extends TopLevelItem {
	chunkId: string;
	/** The main topic of the chunk. Use the IAB Content Taxonomy https://iabtechlab.com/standards/content-taxonomy/ Tier 1 categories */
	primaryTopic: string;
	
	/** 1 to max 3 most important statements extracted from the chunk (and the analyses of those statements, e.g. fact-check, bias, etc.) */
	statements: Statement[];

	/** chunk-level analyses, e.g. toxicity */
	analyses: AspectAnalysis[];

	summary?: ChunkAnalysisSummary;
}
