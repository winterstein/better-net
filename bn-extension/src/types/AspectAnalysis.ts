/** an aspect is e.g. accuracy or manipulation. analyzers are per-aspect, and produce per-chunk AspectAnalysis results. */

export enum AspectType {
	/** aka Fake News */
	ACCURACY = 'accuracy',
	/** bias and manipulation */
	BIAS = 'bias',
	SCAMS = 'scams',
	TOXICITY = 'toxicity',
	CLICKBAIT = 'clickbait',
}

/** [0-1] fraction	 */
type Fraction = number;

/**
 * Analysis result for a specific aspect/type of analysis.
 * Always has Statement or a ChunkAnalysis as a parent.
 */
export interface AspectAnalysis {
	type: AspectType;
	/** unique id for this analysis result if it is sent to server */
	id: string;
	methodName: string;
	/** If an AI model was used, the name of the model e.g. gpt-4o */
	model: string;
	/** Optional user id for feedback sent to server */
	user?: string;
	/**
	 * optional url to the source for this analysis - eg to a page on a fact-check website or a news article.
	 */
	url?: string;
	/** Problem score: 0-1, where higher = more problematic e.g. more misleading, more biased */
	problemScore: Fraction;
	/** Confidence in the analysis: 0-1 */
	confidence: Fraction;
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

/** Settings module id → aspect type */
export const MODULE_ASPECT_TYPE: Record<string, AspectType> = {
	factChecker: AspectType.ACCURACY,
	biasDetector: AspectType.BIAS,
	antiManipulation: AspectType.SCAMS,
	defuseRagebait: AspectType.TOXICITY,
};

export function aspectTypeForModule(moduleId: string): AspectType {
	return MODULE_ASPECT_TYPE[moduleId] ?? AspectType.ACCURACY;
}

/** Fill defaults for a feature analyzer partial result */
export function completeAspectAnalysis(
	moduleId: string,
	partial: Partial<AspectAnalysis>
): AspectAnalysis {
	const type = partial.type ?? aspectTypeForModule(moduleId);
	return {
		type,
		id: partial.id ?? `${moduleId}-${Date.now()}`,
		methodName: partial.methodName ?? moduleId,
		model: partial.model ?? 'heuristic',
		problemScore: partial.problemScore ?? 0,
		confidence: partial.confidence ?? 0,
		flags: partial.flags ?? [],
		...partial,
		metadata: { moduleId, ...(partial.metadata ?? {}) },
	};
}

export function findAnalysisByModule(
	analyses: AspectAnalysis[],
	moduleId: string
): AspectAnalysis | undefined {
	return analyses.find(
		(a) => a.metadata?.moduleId === moduleId || a.methodName === moduleId
	);
}
