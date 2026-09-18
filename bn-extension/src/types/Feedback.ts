import type { ProblemScore } from './Score.js';

/** What the user rated in the Content Analysis modal. See specs/feedback.md */
export type FeedbackTarget = 'summary' | 'module' | 'chunker' | 'chunk' | 'page';

export const FEEDBACK_TARGETS: FeedbackTarget[] = [
	'summary',
	'module',
	'chunker',
	'chunk',
	'page',
];

/**
 * Targets that rate the page rather than one chunk, so they carry `pageUrl` and no chunk
 * context: `chunker` (how the page was split) and `page` (its `page-type:…` tag).
 */
export const PAGE_LEVEL_TARGETS: FeedbackTarget[] = ['chunker', 'page'];

/**
 * Targets whose feedback is a tag edit, never a thumb. A thumb on a tagged verdict cannot
 * be read without knowing which way the verdict went; the tag says it directly.
 */
export const TAG_EDIT_ONLY_TARGETS: FeedbackTarget[] = ['module', 'page'];

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
	/**
	 * A thumb: true = 👍, false = 👎. Rates our output as a whole, so it is what `summary`
	 * and `chunker` send. Absent on a tag edit, which says something more specific.
	 */
	thumbsUp?: boolean;
	/** Same thumb clicked twice: rating withdrawn, record kept. Thumbs only. */
	retracted?: boolean;
	/**
	 * A tag edit — the user's own correction, and the ground truth we actually want:
	 * **tag `tag` is / is not on this chunk**. `tagOn: false` is the "!tag" of
	 * terminology.md; the two are the same statement in different shapes, and this one is
	 * queryable without parsing strings.
	 *
	 * No inference is involved: removing a tag we applied says it does not belong, adding
	 * one says we missed it. That is why the `module` and `chunk` targets send these
	 * instead of a thumb — a thumb on a tagged verdict cannot be read without knowing
	 * which way round the verdict went. See specs/feedback.md.
	 */
	tag?: string;
	tagOn?: Clearable<boolean>;
	/**
	 * Preset issue picked after a thumbs down, e.g. 'not-a-chunk'. Thumbs only —
	 * feedback/feedback-issues.ts no longer carries a list for `module`.
	 */
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
	/** Whose tag was edited, for target 'module'. */
	moduleId?: string;
	/** Legacy pre-Module rename; accepted by server normalize only */
	aspectType?: string;
	analysisId?: string;
	/**
	 * The band we claimed, so a correction can be weighed against what we said. Stored as
	 * the `ProblemScore` enum rather than a [0,1] fraction: the bands are the vocabulary,
	 * and adding a finer one later must not require re-bucketing stored feedback. Legacy
	 * extensions send a fraction; the server normalizes it (bn-server routes/feedback.ts).
	 */
	problemScore?: ProblemScore;
	confidence?: number;
	/** AIQA trace for the page analysis. Absent when tracing was off or unsampled. */
	traceId?: string;
	/** The exact step: the feature span for a module, the chunk span otherwise. */
	spanId?: string;
	userId?: string;
}
