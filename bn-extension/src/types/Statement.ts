import type { AspectAnalysis } from './AspectAnalysis.js';

/**
 * A claim or opinion extracted from a chunk
 */
export interface Statement {
	type: 'claim' | 'opinion';
	/** Summary text of the statement */
	summaryText: string;
	/** One or more analyses of the statement */
	analyses: AspectAnalysis[];
}