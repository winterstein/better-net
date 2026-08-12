import { AspectType } from '../types/AspectAnalysis.js';

/** Settings module id → AspectType (spec: extension-server-feedback.md) */
export const MODULE_ASPECT_MAP: Record<string, AspectType> = {
	factChecker: AspectType.ACCURACY,
	biasDetector: AspectType.BIAS,
	antiManipulation: AspectType.BIAS,
	defuseRagebait: AspectType.TOXICITY,
	clickUnbait: AspectType.CLICKBAIT,
};

export function moduleToAspect(moduleId: string): AspectType | undefined {
	return MODULE_ASPECT_MAP[moduleId];
}
