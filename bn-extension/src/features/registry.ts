/**
 * Analysis features — ids align with settings modules (specs/settings.md).
 */

import { analyzeChunk as analyzeFactChecker } from './fact-checker/analyze-chunk.js';
import { analyzeChunk as analyzeBiasDetector } from './bias-detector/analyze-chunk.js';
import { analyzeChunk as analyzeAntiManipulation } from './anti-manipulation/analyze-chunk.js';
import { analyzeChunk as analyzeDefuseRagebait } from './defuse-ragebait/analyze-chunk.js';
import { analyzeChunk as analyzeClickUnbait } from './click-unbait/analyze-chunk.js';
import { FACT_CHECKER_TAGS } from './fact-checker/fact-checker-tags.js';
import { BIAS_DETECTOR_TAGS } from './bias-detector/bias-detector-tags.js';
import { ANTI_MANIPULATION_TAGS } from './anti-manipulation/anti-manipulation-tags.js';
import { DEFUSE_RAGEBAIT_TAGS } from './defuse-ragebait/defuse-ragebait-tags.js';
import { CLICK_UNBAIT_TAGS } from './click-unbait/click-unbait-tags.js';

/**
 * `tags` is the module's tag vocabulary ({module}-tags.ts, terminology.md). It is what
 * the Content Analysis modal's "+" select offers, so a module that grows a tag needs no
 * feedback-side change.
 * @type {Array<{ id: string, name: string, description: string, analyze: Function, tags: import('../types/Tag.js').TagSpec[] }>}
 */
export const ANALYSIS_MODULES = [
  {
    id: 'factChecker',
    name: 'Fact Checker',
    description: 'Extract claims and check them against fact-check sources.',
    analyze: analyzeFactChecker,
    tags: FACT_CHECKER_TAGS,
  },
  {
    id: 'biasDetector',
    name: 'Bias Detector',
    description: 'Detect political or ideological bias at the chunk level.',
    analyze: analyzeBiasDetector,
    tags: BIAS_DETECTOR_TAGS,
  },
  {
    id: 'antiManipulation',
    name: 'Anti-manipulation',
    description: 'Label dark patterns, urgency tricks, and manipulative UX.',
    analyze: analyzeAntiManipulation,
    tags: ANTI_MANIPULATION_TAGS,
  },
  {
    id: 'defuseRagebait',
    name: 'Defuse Ragebait',
    description: 'Label outrage-bait and harmful or abusive language.',
    analyze: analyzeDefuseRagebait,
    tags: DEFUSE_RAGEBAIT_TAGS,
  },
  {
    id: 'clickUnbait',
    name: 'Click Unbait',
    description: 'Rewrite clickbait link text with an honest summary prefix.',
    analyze: analyzeClickUnbait,
    tags: CLICK_UNBAIT_TAGS,
  },
];

export const ANALYSIS_MODULE_IDS = ANALYSIS_MODULES.map((f) => f.id);

const byId = Object.fromEntries(ANALYSIS_MODULES.map((f) => [f.id, f]));

export function getAnalysisModule(id) {
  return byId[id];
}

export function getModuleDisplayName(id) {
  return byId[id]?.name ?? id;
}

/** The module's tag vocabulary, for the feedback "+" select. Empty for unknown modules. */
export function tagsForModule(id) {
  return byId[id]?.tags ?? [];
}
