import type { Statement } from './Statement.js';
import type { ChunkAnalysisSummary, Flag, RiskRating } from './ChunkAnalysisSummary.js';
import type { TopLevelItem } from './TopLevelItem.js';
import type { ModuleAnalysis } from './ModuleAnalysis.js';
import {
	fractionFromProblemScore,
	issueTagIds,
	worstProblemScore,
	type ProblemScore,
} from './Score.js';
import type { ChunkTag } from './Tag.js';

/**
 * The top-level quality analysis result for a chunk. 
 * Acts as a container for the statements extracted from the chunk 
 * and the analysis results for those statements.
 */
export interface ChunkAnalysis extends TopLevelItem {
	chunkId: string;
	/** The main topic of the chunk. Use the IAB Content Taxonomy https://iabtechlab.com/standards/content-taxonomy/ Tier 1 categories */
	primaryTopic: string;
	
	/** 1 to max 3 most important statements extracted from the chunk (and the analyses of those statements, e.g. fact-check, bias, etc.) */
	statements: Statement[];

	/** chunk-level analyses per module */
	analyses: ModuleAnalysis[];

	summary?: ChunkAnalysisSummary;

	/** Chunk context for on-page labelling and feedback */
	xpath?: string;
	title?: string;
	tags?: ChunkTag[];
	url?: string;
	fingerprint?: string;
	feedbackEnabled?: boolean;
	/** AIQA trace and chunk span for this analysis, for feedback links. specs/feedback.md */
	traceId?: string;
	spanId?: string;
}

export function riskFromScore(score: number): RiskRating {
	if (score >= 0.8) return 'very-high';
	if (score >= 0.6) return 'high';
	if (score >= 0.4) return 'medium';
	if (score >= 0.2) return 'low';
	if (score > 0) return 'very-low';
	return 'unknown';
}

export function riskFromProblemScore(score: ProblemScore): RiskRating {
	return riskFromScore(fractionFromProblemScore(score));
}

/**
 * Worst module problemScore as a band. Prefer this over chunkProblemScore() when the value
 * is stored or sent: the band is the source of truth and survives new bands being added,
 * where a [0,1] fraction has to be re-bucketed and loses anything finer than the mapping.
 */
export function chunkProblemBand(analysis: Partial<ChunkAnalysis>): ProblemScore {
	if (analysis.summary?.problemScore) {
		return analysis.summary.problemScore;
	}
	const scores = (analysis.analyses ?? [])
		.filter((a) => !a.error && a.problemScore)
		.map((a) => a.problemScore);
	return worstProblemScore(scores);
}

/** Worst module problemScore as a [0,1] fraction for Nutrient Label / RiskLevel. */
export function chunkProblemScore(analysis: Partial<ChunkAnalysis>): number {
	return fractionFromProblemScore(chunkProblemBand(analysis));
}

export function buildChunkSummary(analyses: ModuleAnalysis[]): ChunkAnalysisSummary {
	const valid = analyses.filter((a) => !a.error);
	const problemScore = worstProblemScore(valid.map((a) => a.problemScore));
	const confidence = valid.length
		? valid.reduce((s, a) => s + a.confidence, 0) / valid.length
		: 0;
	const flags: Flag[] = valid.map((a) => {
		const moduleId = String(a.metadata?.moduleId ?? a.methodName ?? '');
		const ids = issueTagIds(a.tags);
		return {
			moduleId,
			riskRating: riskFromProblemScore(a.problemScore),
			label: ids[0] ?? moduleId,
		};
	});
	const overallRisk = riskFromProblemScore(problemScore);
	const summaryText =
		overallRisk === 'very-high' || overallRisk === 'high'
			? 'Content shows significant concern signals.'
			: overallRisk === 'medium'
				? 'Content shows some concern signals.'
				: 'Content appears relatively safe.';
	return { summaryText, overallRisk, problemScore, confidence, flags };
}
