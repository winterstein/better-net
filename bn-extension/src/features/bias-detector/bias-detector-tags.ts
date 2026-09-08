/** Bias Detector's tags (terminology.md). Offered in the Content Analysis modal's "+" select. */
import type { TagSpec } from '../../types/Tag.js';

export const BIAS_DETECTOR_TAGS: TagSpec[] = [
	{ id: 'biased', label: 'Significant bias' },
	{ id: 'bias:neutral', label: 'Neutral' },
	{ id: 'bias:left', label: 'Left bias' },
	{ id: 'bias:right', label: 'Right bias' },
	{ id: 'bias:self', label: 'Self-interested bias' },
];
