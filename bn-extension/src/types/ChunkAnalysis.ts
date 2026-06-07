import type { Statement } from './Statement.js';
import type { ChunkAnalysisSummary, Flag, RiskRating } from './ChunkAnalysisSummary.js';
import type { TopLevelItem } from './TopLevelItem.js';
import type { AspectAnalysis } from './AspectAnalysis.js';
import type { Tag } from './Tag.js';

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

	/** chunk-level analyses, e.g. toxicity */
	analyses: AspectAnalysis[];

	summary?: ChunkAnalysisSummary;

	/** Chunk context for on-page labelling and feedback */
	xpath?: string;
	title?: string;
	tags?: Tag[];
	url?: string;
	fingerprint?: string;
	feedbackEnabled?: boolean;
}

export function riskFromScore(score: number): RiskRating {
	if (score >= 0.8) return 'very-high';
	if (score >= 0.6) return 'high';
	if (score >= 0.4) return 'medium';
	if (score >= 0.2) return 'low';
	if (score > 0) return 'very-low';
	return 'unknown';
}

export function chunkProblemScore(analysis: Partial<ChunkAnalysis>): number {
	if (typeof analysis.summary?.problemScore === 'number') {
		return analysis.summary.problemScore;
	}
	const scores = (analysis.analyses ?? [])
		.filter((a) => !a.error && typeof a.problemScore === 'number')
		.map((a) => a.problemScore);
	return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

export function buildChunkSummary(analyses: AspectAnalysis[]): ChunkAnalysisSummary {
	const valid = analyses.filter((a) => !a.error);
	const problemScore = valid.length
		? valid.reduce((s, a) => s + a.problemScore, 0) / valid.length
		: 0;
	const confidence = valid.length
		? valid.reduce((s, a) => s + a.confidence, 0) / valid.length
		: 0;
	const flags: Flag[] = valid.map((a) => ({
		type: a.type,
		riskRating: riskFromScore(a.problemScore),
		label: a.flags[0] ?? a.type,
	}));
	const overallRisk = riskFromScore(problemScore);
	const summaryText =
		overallRisk === 'very-high' || overallRisk === 'high'
			? 'Content shows significant concern signals.'
			: overallRisk === 'medium'
				? 'Content shows some concern signals.'
				: 'Content appears relatively safe.';
	return { summaryText, overallRisk, problemScore, confidence, flags };
}
