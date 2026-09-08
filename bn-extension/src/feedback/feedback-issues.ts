/**
 * Preset issues offered after a thumbs down, one list per feedback target. The modal
 * passes a list into the widget, so each target keeps its own vocabulary without the
 * widget knowing anything about them. See specs/feedback.md.
 *
 * Ids are stable and get counted server-side; labels can be reworded freely.
 */

import type { FeedbackTarget } from '../types/Feedback.js';

export interface FeedbackIssue {
	id: string;
	label: string;
}

/** Not a preset: reveals the free-text box instead. */
export const OTHER_ISSUE_ID = 'other';

const OTHER: FeedbackIssue = { id: OTHER_ISSUE_ID, label: 'Other…' };

const SUMMARY_ISSUES: FeedbackIssue[] = [
	{ id: 'score-too-high', label: 'Score too high' },
	{ id: 'score-too-low', label: 'Score too low' },
	{ id: 'summary-inaccurate', label: 'Summary is inaccurate' },
	{ id: 'missed-main-problem', label: 'Missed the main problem' },
	{ id: 'wrong-topic', label: 'Wrong topic' },
	OTHER,
];

const MODULE_ISSUES: FeedbackIssue[] = [
	{ id: 'not-applicable', label: 'Does not apply' },
	{ id: 'overstated', label: 'Overstated' },
	{ id: 'understated', label: 'Understated' },
	{ id: 'wrong-explanation', label: 'Explanation is wrong' },
	{ id: 'wrong-quote', label: 'Quoted the wrong bit' },
	OTHER,
];

const CHUNKER_ISSUES: FeedbackIssue[] = [
	{ id: 'missed-content', label: 'Missed content on the page' },
	{ id: 'split-one-item', label: 'Split one article into pieces' },
	{ id: 'merged-items', label: 'Merged separate items' },
	{ id: 'picked-up-furniture', label: 'Picked up nav/ads/comments as content' },
	OTHER,
];

const CHUNK_ISSUES: FeedbackIssue[] = [
	{ id: 'not-a-chunk', label: "This shouldn't be a chunk" },
	{ id: 'wrong-boundaries', label: 'Boundaries are wrong' },
	{ id: 'wrong-tag', label: 'Wrong tag' },
	{ id: 'wrong-title', label: 'Wrong title' },
	OTHER,
];

const ISSUES_BY_TARGET: Record<FeedbackTarget, FeedbackIssue[]> = {
	summary: SUMMARY_ISSUES,
	module: MODULE_ISSUES,
	chunker: CHUNKER_ISSUES,
	chunk: CHUNK_ISSUES,
};

/**
 * "Does not apply" in the user's words, per module — the complaint people actually
 * make is "this wasn't clickbait", not "module clickbait does not apply".
 */
const NOT_APPLICABLE_LABELS: Record<string, string> = {
	factChecker: 'The claims are accurate',
	biasDetector: "This isn't biased",
	antiManipulation: "This isn't manipulative",
	defuseRagebait: "This isn't ragebait",
	clickUnbait: "This isn't clickbait",
};

/** @param moduleId for target 'module', to phrase the "does not apply" preset. */
export function issuesForTarget(target: FeedbackTarget, moduleId?: string): FeedbackIssue[] {
	const issues = ISSUES_BY_TARGET[target] ?? [];
	const notApplicable = moduleId ? NOT_APPLICABLE_LABELS[moduleId] : undefined;
	if (!notApplicable) return issues;
	return issues.map((issue) =>
		issue.id === 'not-applicable' ? { ...issue, label: notApplicable } : issue
	);
}

export function issueLabel(target: FeedbackTarget, issueId: string, moduleId?: string): string {
	return issuesForTarget(target, moduleId).find((i) => i.id === issueId)?.label ?? issueId;
}
