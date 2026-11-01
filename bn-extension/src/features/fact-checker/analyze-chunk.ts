/**
 * Fact Checker — chunk analysis via Google Fact Check Tools API.
 */

import { factCheckContent } from './factcheck-google.js';
import { logit } from '../../utils/logger.js';
import type { ModuleAnalysis } from '../../types/ModuleAnalysis.js';
import { extractClaims } from './extract-claims.js';
import { getGoogleFactCheckKey } from '../../utils/env-utils.js';
import { normalizeIssueTags, problemScoreFromFraction } from '../../types/Score.js';

const MIN_CLAIM_LENGTH = 10; // Minimum length for a claim to be worth checking

/**
 * @param {Object} chunk
 * @param {Object} pageMetadata
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function analyzeChunk(
  chunk,
  pageMetadata: any = {},
  options: any = {}
): Promise<Partial<ModuleAnalysis>> {
  const { config = {} } = options;
  try {
     // Extract claims from content
       const text = chunk.text || '';
       if (text.length < MIN_CLAIM_LENGTH) {
         return {
           problemScore: problemScoreFromFraction(0),
           confidence: 0.0,
           tags: [],
           explanation: 'Content too short to fact-check',
           metadata: { factChecks: [], diagnostic: 'insufficient_content' },
         } satisfies Partial<ModuleAnalysis>;
       }
    const claims = extractClaims(text);
    const result = await factCheckContent(chunk, claims, pageMetadata, {
      apiKey: config.googleFactCheckKey,
      languageCode: 'en',
    });
    if (claims.length && result.metadata?.factChecks?.length===0) {
      logit("log", "TODO try LLM general knowledge");
      // TODO use runFeatureAnalysis();
    }
    return result;
  } catch (error) {
    logit('warn', '[factChecker] analysis failed:', error.message);
    return {
      error: error.message,
      problemScore: 'low',
      confidence: 0,
      tags: [],
      explanation: `Fact check unavailable: ${error.message}`,
    };
  }
}
