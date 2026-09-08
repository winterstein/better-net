import type { ProblemScore } from './Score.js';

export type RiskRating =
	| 'very-high'
	| 'high'
	| 'medium'
	| 'low'
	| 'very-low'
	| 'unknown';

/**
 * Summary of analysis results for a chunk
 */
export interface ChunkAnalysisSummary {
	/** 1-2 short sentences summarizing the overall analysis */
	summaryText: string;
	/** Overall risk assessment */
	overallRisk: RiskRating;
	/** Overall problem score: high | medium | low */
	problemScore: ProblemScore;	
	confidence: number;
	flags: Flag[];
}

export interface Flag {
	/** Settings module id that produced this flag */
	moduleId: string;
	riskRating: RiskRating;
	/** A product tag label (see terminology.md) */
	label: string;
}
