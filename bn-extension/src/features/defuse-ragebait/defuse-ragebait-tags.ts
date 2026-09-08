/**
 * Defuse Ragebait's tags (terminology.md). Offered in the Content Analysis modal's "+"
 * select. trigger:X marks content that will anger someone who cares about that cause;
 * more trigger tags are expected, and trigger:country has sub-tags (trigger:country:usa).
 */
import type { TagSpec } from '../../types/Tag.js';

export const DEFUSE_RAGEBAIT_TAGS: TagSpec[] = [
	{ id: 'ragebait', label: 'Ragebait' },
	{ id: 'hate-speech', label: 'Hate speech' },
	{ id: 'threat', label: 'Threat' },
	{ id: 'personal-attack', label: 'Personal attack' },
	{ id: 'trigger:racism', label: 'Trigger: racism' },
	{ id: 'trigger:sexism', label: 'Trigger: sexism' },
	{ id: 'trigger:lgbt', label: 'Trigger: LGBT' },
	{ id: 'trigger:country', label: 'Trigger: country / nationalism' },
	{ id: 'trigger:family-values', label: 'Trigger: family values' },
];
