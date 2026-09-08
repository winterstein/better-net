/** Fact Checker's tags (terminology.md). Offered in the Content Analysis modal's "+" select. */
import type { TagSpec } from '../../types/Tag.js';

export const FACT_CHECKER_TAGS: TagSpec[] = [
	{ id: 'no-claims', label: 'No claims to check' },
	{ id: 'verified-claims', label: 'Claims checked and correct' },
	{ id: 'false-claim', label: 'False or highly misleading claim' },
	{ id: 'suspect-claim', label: 'Suspect claim (unverified)' },
	{ id: 'fringe-view', label: 'Fringe view / conspiracy' },
];
