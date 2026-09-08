import type { AspectType } from './AspectAnalysis.js';

/** What the user rated in the Content Analysis modal. See specs/feedback.md */
export type FeedbackTarget = 'summary' | 'aspect' | 'chunker' | 'chunk';

export const FEEDBACK_TARGETS: FeedbackTarget[] = ['summary', 'aspect', 'chunker', 'chunk'];

/** Payload for POST /api/feedback */
export interface FeedbackSubmission {
	/**
	 * Client-generated, which makes the POST an upsert: the thumb creates the record and
	 * the preset issue or note that follows updates it, so one thumbs down is one row.
	 */
	localId: string;
	target: FeedbackTarget;
	/** true = the analysis is right. For target 'aspect', true = the aspect applies. */
	applies: boolean;
	/** Same thumb clicked twice: rating withdrawn, record kept. */
	retracted?: boolean;
	/** Preset issue picked after a thumbs down, e.g. 'not-a-chunk'. feedback/feedback-issues.ts */
	issueId?: string;
	issueLabel?: string;
	/** Free text from the "Other" box only. */
	message?: string;
	/** Chunk context. Absent for target 'chunker', which is about the whole page. */
	chunkFingerprint?: string;
	chunkUrl?: string;
	chunkTitle?: string;
	/** Page context, for target 'chunker'. */
	pageUrl?: string;
	chunkCount?: number;
	/** target 'aspect' only */
	aspectType?: AspectType;
	moduleId?: string;
	analysisId?: string;
	problemScore?: number;
	confidence?: number;
	/** AIQA trace for the page analysis. Absent when tracing was off or unsampled. */
	traceId?: string;
	/** The exact step: the feature span for an aspect, the chunk span otherwise. */
	spanId?: string;
	userId?: string;
}
