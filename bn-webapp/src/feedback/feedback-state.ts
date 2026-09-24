/**
 * Which of the feedback view's states to show. A pure function, because the distinction
 * that matters is easy to get wrong: "you have no devices linked" is not the same as "you
 * have given no feedback", and showing the second for the first reads as
 * "you never gave any" when the real answer is "open this from the extension".
 * See bn-webapp/specs/feedback/feedback-viewer/spec.md.
 */

export type FeedbackView =
	| { kind: 'signin' }
	| { kind: 'loading' }
	| { kind: 'linking' }
	| { kind: 'link-expired' }
	| { kind: 'error'; message: string }
	| { kind: 'no-devices' }
	| { kind: 'empty' }
	| { kind: 'rows' };

export interface FeedbackStateInput {
	isAuthenticated: boolean;
	isLoading: boolean;
	linking?: boolean;
	linkExpired?: boolean;
	error?: string | null;
	linkedDevices?: number;
	rowCount?: number;
}

export function feedbackView(input: FeedbackStateInput): FeedbackView {
	if (input.isLoading) return { kind: 'loading' };
	if (!input.isAuthenticated) return { kind: 'signin' };
	if (input.linking) return { kind: 'linking' };
	if (input.error) return { kind: 'error', message: input.error };
	if ((input.rowCount ?? 0) > 0) return { kind: 'rows' };
	// Stale link with nothing to show: tell them to open the extension again.
	if (input.linkExpired) return { kind: 'link-expired' };
	if ((input.linkedDevices ?? 0) === 0) return { kind: 'no-devices' };
	return { kind: 'empty' };
}

/** One line describing a correction, for the list and the staff table. */
export function describeFeedback(row: {
	tag?: string;
	tagOn?: boolean | null;
	thumbsUp?: boolean;
	retracted?: boolean;
	issueLabel?: string | null;
}): string {
	if (row.retracted) return 'Rating withdrawn';
	// A tag edit says which way round the verdict should have gone; terminology.md writes
	// "off" as !tag, which reads badly in a UI, so spell it out.
	if (row.tag) return row.tagOn ? `Should be tagged "${row.tag}"` : `Not "${row.tag}"`;
	if (typeof row.thumbsUp === 'boolean') {
		const thumb = row.thumbsUp ? 'Marked right' : 'Marked wrong';
		return row.issueLabel ? `${thumb} — ${row.issueLabel}` : thumb;
	}
	return 'Feedback';
}
