import type { AspectType } from './AspectAnalysis.js';

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
	/** Overall score: 0-1, where higher = more problematic */
	problemScore: number;	
	confidence: number;
	flags: Flag[];
}

export interface Flag {
	type: AspectType;
	riskRating: RiskRating;
	/** A single word label. E.g.
	 * left/right/neutral for bias.
	 * true/false/misleading for accuracy.
	 * scam/not-scam for scams.
	 * hateful/angry/toxic/non-toxic/positive/feelgood for toxicity.
	 * clickbait for clickbait.
	 * etc
	 */
	label: string;
}

