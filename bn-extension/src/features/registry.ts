/**
 * Analysis features — ids align with settings modules (specs/settings.md).
 */

import { analyzeChunk as analyzeFactChecker } from './fact-checker/analyze-chunk.js';
import { analyzeChunk as analyzeBiasDetector } from './bias-detector/analyze-chunk.js';
import { analyzeChunk as analyzeAntiManipulation } from './anti-manipulation/analyze-chunk.js';
import { analyzeChunk as analyzeDefuseRagebait } from './defuse-ragebait/analyze-chunk.js';
import { analyzeChunk as analyzeClickUnbait } from './click-unbait/analyze-chunk.js';
import { MODULE_TAGS, tagsForModule } from './module-tags.js';
import { MODULE_ROUTING } from './module-routing.js';

/**
 * `tags` is the module's tag vocabulary ({module}-tags.ts, terminology.md). It is what
 * the Content Analysis modal's "+" select offers, so a module that grows a tag needs no
 * feedback-side change.
 *
 * `appliesTo` is which chunks the module may run on (module-routing.ts). The engine
 * enforces it, so an analyzer never has to decide whether it was the right one to call.
 * @type {Array<{ id: string, name: string, description: string, analyze: Function, tags: import('../types/Tag.js').TagSpec[], appliesTo: import('./module-routing.js').AppliesTo }>}
 */
export const ANALYSIS_MODULES = [
  {
    id: 'factChecker',
    name: 'Fact Checker',
    description: 'Extract claims and check them against fact-check sources.',
    analyze: analyzeFactChecker,
    tags: MODULE_TAGS.factChecker,
    appliesTo: MODULE_ROUTING.factChecker,
  },
  {
    id: 'biasDetector',
    name: 'Bias Detector',
    description: 'Detect political or ideological bias at the chunk level.',
    analyze: analyzeBiasDetector,
    tags: MODULE_TAGS.biasDetector,
    appliesTo: MODULE_ROUTING.biasDetector,
  },
  {
    id: 'antiManipulation',
    name: 'Anti-manipulation',
    description: 'Label dark patterns, urgency tricks, and manipulative UX.',
    analyze: analyzeAntiManipulation,
    tags: MODULE_TAGS.antiManipulation,
    appliesTo: MODULE_ROUTING.antiManipulation,
  },
  {
    id: 'defuseRagebait',
    name: 'Defuse Ragebait',
    description: 'Label outrage-bait and harmful or abusive language.',
    analyze: analyzeDefuseRagebait,
    tags: MODULE_TAGS.defuseRagebait,
    appliesTo: MODULE_ROUTING.defuseRagebait,
  },
  {
    id: 'clickUnbait',
    name: 'Click Unbait',
    description: 'Rewrite clickbait link text with an honest summary prefix.',
    analyze: analyzeClickUnbait,
    tags: MODULE_TAGS.clickUnbait,
    appliesTo: MODULE_ROUTING.clickUnbait,
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

export { tagsForModule };
