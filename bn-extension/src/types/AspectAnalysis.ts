
export enum AspectType {
	/** aka Fake News */
	ACCURACY = 'accuracy',
	/** bias and manipulation */
	BIAS = 'bias',
	SCAMS = 'scams',
	TOXICITY = 'toxicity',
	CLICKBAIT = 'clickbait',
}

/**
 * Analysis result for a specific aspect/type of analysis.
 * Replaces AnalysisResult from common.ts
 * Always has Statement or a ChunkAnalysis as a parent.
 */
export interface AspectAnalysis {
	type: AspectType;
	methodName: string;
	/** If an AI model was used, the name of the model e.g. gpt-4o */
	model: string;
	/**
	 * optional url to the source for this analysis - eg to a page on a fact-check website or a news article.
	 */
	url?: string;
	/** Problem score: 0-1, where higher = more problematic */
	problemScore: number;
	/** Confidence in the analysis: 0-1 */
	confidence: number;
	/** Array of flag strings (e.g., 'fake_news', 'scam', etc.) */
	flags: string[];
	/** Human-readable explanation of the analysis */
	explanation?: string;
	/** Error message if analysis failed */
	error?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Fact-check specific analysis (extends AspectAnalysis with fact-check details)
 */
export interface FactCheckAnalysis extends AspectAnalysis {
	type: AspectType.ACCURACY;
}
