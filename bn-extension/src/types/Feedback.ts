import type { AspectType } from './AspectAnalysis.js';

/** Payload for POST /api/feedback */
export interface FeedbackSubmission {
	chunkFingerprint: string;
	chunkUrl: string;
	chunkTitle?: string;
	aspectType: AspectType;
	moduleId: string;
	analysisId?: string;
	/** true = aspect applies (thumbs up), false = does not apply */
	applies: boolean;
	/** Optional note when applies is false */
	message?: string;
	problemScore?: number;
	confidence?: number;
	userId?: string;
}
