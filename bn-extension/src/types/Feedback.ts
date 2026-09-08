/** What the user rated in the Content Analysis modal. See specs/feedback.md */
export type FeedbackTarget = 'summary' | 'module' | 'chunker' | 'chunk';

export const FEEDBACK_TARGETS: FeedbackTarget[] = ['summary', 'module', 'chunker', 'chunk'];

/**
 * A field a later submission may need to wipe. The POST merges onto what is already
 * stored, so `undefined` leaves a field as it was and `null` clears it — which is how a
 * new thumb drops the complaint the previous one collected (bn-server routes/feedback.ts).
 */
type Clearable<T> = T | null;

/** Payload for POST /api/feedback */
export interface FeedbackSubmission {
	/**
	 * Derived from what is being rated and who is rating it, which makes the POST an
	 * upsert: the thumb creates the record, the preset issue that follows updates it, and
	 * re-rating the same thing after a reload updates it again instead of adding a second
	 * row. See `feedbackLocalId()` in feedback/feedback-client.ts.
	 */
	localId: string;
	target: FeedbackTarget;
	/** The click itself: true = 👍, false = 👎. Uninterpreted, so it always means one thing. */
	thumbsUp: boolean;
	/** Same thumb clicked twice: rating withdrawn, record kept. */
	retracted?: boolean;
	/**
	 * The thumb read as ground truth: tag `tag` is / is not on this chunk.
	 *
	 * A thumb on its own only says "you got this right" or "you got this wrong", which is
	 * useless without knowing what we claimed. So this pairs the thumb with the verdict it
	 * was given on: 👍 on "this is clickbait" and 👎 on "this is not clickbait" both record
	 * clickbait as on. Set for target 'module', where exactly one product tag is being judged;
	 * absent for the others, where a thumb rates our whole output rather than a tag.
	 * See specs/feedback.md.
	 */
	tag?: string;
	tagOn?: Clearable<boolean>;
	/** Preset issue picked after a thumbs down, e.g. 'not-a-chunk'. feedback/feedback-issues.ts */
	issueId?: Clearable<string>;
	issueLabel?: Clearable<string>;
	/** Free text from the "Other" box only. */
	message?: Clearable<string>;
	/** Chunk context. Absent for target 'chunker', which is about the whole page. */
	chunkFingerprint?: string;
	chunkUrl?: string;
	chunkTitle?: string;
	/** The page the feedback was given on. Sent for every target. */
	pageUrl?: string;
	/** target 'chunker' only */
	chunkCount?: number;
	/** target 'module' only */
	moduleId?: string;
	/** Legacy pre-Module rename; accepted by server normalize only */
	aspectType?: string;
	analysisId?: string;
	problemScore?: number;
	confidence?: number;
	/** AIQA trace for the page analysis. Absent when tracing was off or unsampled. */
	traceId?: string;
	/** The exact step: the feature span for a module, the chunk span otherwise. */
	spanId?: string;
	userId?: string;
}
