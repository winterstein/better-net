/**
 * Every module's tag vocabulary, in one place ({module}-tags.ts, terminology.md).
 *
 * Deliberately separate from registry.ts: the registry imports each module's analyzer,
 * and so pulls in LLM clients and the local-model plumbing behind them. The content
 * script needs the tag names to render the feedback UI and nothing else, so it reads
 * them from here instead.
 */

import type { TagSpec } from '../types/Tag.js';
import { FACT_CHECKER_TAGS } from './fact-checker/fact-checker-tags.js';
import { BIAS_DETECTOR_TAGS } from './bias-detector/bias-detector-tags.js';
import { ANTI_MANIPULATION_TAGS } from './anti-manipulation/anti-manipulation-tags.js';
import { DEFUSE_RAGEBAIT_TAGS } from './defuse-ragebait/defuse-ragebait-tags.js';
import { CLICK_UNBAIT_TAGS } from './click-unbait/click-unbait-tags.js';

export const MODULE_TAGS: Record<string, TagSpec[]> = {
	factChecker: FACT_CHECKER_TAGS,
	biasDetector: BIAS_DETECTOR_TAGS,
	antiManipulation: ANTI_MANIPULATION_TAGS,
	defuseRagebait: DEFUSE_RAGEBAIT_TAGS,
	clickUnbait: CLICK_UNBAIT_TAGS,
};

/** The module's tag vocabulary, for the feedback "+" select. Empty for unknown modules. */
export function tagsForModule(moduleId: string): TagSpec[] {
	return MODULE_TAGS[moduleId] ?? [];
}
