/**
 * Analysis features — ids align with settings modules (specs/settings.md).
 */

import { analyzeChunk as analyzeFactChecker } from './fact-checker/analyze-chunk.js';
import { analyzeChunk as analyzeBiasDetector } from './bias-detector/analyze-chunk.js';
import { analyzeChunk as analyzeAntiManipulation } from './anti-manipulation/analyze-chunk.js';
import { analyzeChunk as analyzeDefuseRagebait } from './defuse-ragebait/analyze-chunk.js';

/** @type {Array<{ id: string, name: string, description: string, analyze: Function }>} */
export const ANALYSIS_FEATURES = [
  {
    id: 'factChecker',
    name: 'Fact Checker',
    description: 'Extract claims and check them against fact-check sources.',
    analyze: analyzeFactChecker,
  },
  {
    id: 'biasDetector',
    name: 'Bias Detector',
    description: 'Detect political or ideological bias at the chunk level.',
    analyze: analyzeBiasDetector,
  },
  {
    id: 'antiManipulation',
    name: 'Anti-manipulation',
    description: 'Label dark patterns, urgency tricks, and manipulative UX.',
    analyze: analyzeAntiManipulation,
  },
  {
    id: 'defuseRagebait',
    name: 'Defuse Ragebait',
    description: 'Label outrage-bait and harmful or abusive language.',
    analyze: analyzeDefuseRagebait,
  },
];

export const ANALYSIS_FEATURE_IDS = ANALYSIS_FEATURES.map((f) => f.id);

const byId = Object.fromEntries(ANALYSIS_FEATURES.map((f) => [f.id, f]));

export function getAnalysisFeature(id) {
  return byId[id];
}

export function getFeatureDisplayName(id) {
  return byId[id]?.name ?? id;
}
