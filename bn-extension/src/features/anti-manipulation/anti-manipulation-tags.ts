/** Anti-manipulation's tags (terminology.md). Offered in the Content Analysis modal's "+" select. */
import type { TagSpec } from '../../types/Tag.js';

export const ANTI_MANIPULATION_TAGS: TagSpec[] = [
	{ id: 'urgency', label: 'Urgency pressure' },
	{ id: 'scarcity', label: 'Scarcity claim' },
	{ id: 'sneaky', label: 'Sneaky (hidden costs, pre-ticked extras)' },
	{ id: 'fear', label: 'Fear tactics' },
	{ id: 'too-good-to-be-true', label: 'Too good to be true' },
	{ id: 'phishing', label: 'Phishing' },
];
