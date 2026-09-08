/**
 * One module's analysis of a chunk. Analyzers emit product Tags (see terminology.md)
 * with strength + confidence; remedies and the nutrient label read those tags.
 */

import {
	fractionFromProblemScore,
	normalizeIssueTags,
	pickPrimaryIssueTag,
	problemScoreFromFraction,
	tagStrengthFromFraction,
	type IssueTag,
	type ProblemScore,
} from './Score.js';

export type { IssueTag, ProblemScore, TagStrength } from './Score.js';
export {
	fractionFromProblemScore,
	problemScoreFromFraction,
	pickPrimaryIssueTag,
	hasIssueTag,
	issueTagIds,
} from './Score.js';

/**
 * Analysis result for a specific module (e.g. factChecker, clickUnbait).
 * Always has Statement or a ChunkAnalysis as a parent.
 */
export interface ModuleAnalysis {
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
	/** Problem score: high | medium | low (terminology.md) */
	problemScore: ProblemScore;
	/** Overall confidence in the analysis: 0-1 */
	confidence: number;
	/** Product tags from terminology.md */
	tags: IssueTag[];
	/** Human-readable explanation of the analysis */
	explanation?: string;
	/** Error message if analysis failed */
	error?: string;
	/** AIQA span for this analysis, so feedback can point at the exact call. specs/feedback.md */
	spanId?: string;
	/** Additional metadata (moduleId, diagnostics, non-product signals) */
	metadata?: Record<string, unknown>;
}

type ModuleAnalysisPartial = Omit<Partial<ModuleAnalysis>, 'tags' | 'problemScore'> & {
	/** Accept enum, or legacy [0,1] fraction from heuristics / demos */
	problemScore?: ProblemScore | number;
	tags?: Array<string | IssueTag>;
};

/** Fill defaults for a feature analyzer partial result */
export function completeModuleAnalysis(
	moduleId: string,
	partial: ModuleAnalysisPartial
): ModuleAnalysis {
	const confidence = partial.confidence ?? 0;
	const problemScore =
		typeof partial.problemScore === 'number'
			? problemScoreFromFraction(partial.problemScore)
			: (partial.problemScore ?? 'low');
	const strength = tagStrengthFromFraction(fractionFromProblemScore(problemScore));
	const tags = normalizeIssueTags(partial.tags, strength, confidence);
	const { tags: _t, problemScore: _p, confidence: _c, metadata: partialMeta, ...rest } =
		partial;
	return {
		...rest,
		id: partial.id ?? `${moduleId}-${Date.now()}`,
		methodName: partial.methodName ?? moduleId,
		model: partial.model ?? 'heuristic',
		problemScore,
		confidence,
		tags,
		metadata: { moduleId, ...(partialMeta ?? {}) },
	};
}

export function findAnalysisByModule(
	analyses: ModuleAnalysis[],
	moduleId: string
): ModuleAnalysis | undefined {
	return analyses.find(
		(a) => a.metadata?.moduleId === moduleId || a.methodName === moduleId
	);
}

