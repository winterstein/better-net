import type { AspectAnalysis } from './AspectAnalysis.js';

/**
 * A claim or opinion extracted from a chunk. These provide a summary of
 * what the chunk says.
 */
export interface Statement {
	/** claim: presented as fact; opinion: presented as opinion */
	type: 'claim' | 'opinion';
	/** Summary text of the statement. */
	summaryText: string;
	/** One or more analyses of the statement */
	analyses: AspectAnalysis[];
}