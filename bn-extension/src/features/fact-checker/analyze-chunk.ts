/**
 * Fact Checker — Google Fact Check Tools API, then LLM general knowledge if that
 * finds no published rating (factcheck-llm.ts).
 */

import { factCheckContent } from './factcheck-google.js';
import { checkWithGeneralKnowledge, mergeGeneralKnowledge } from './factcheck-llm.js';
import { logit } from '../../utils/logger.js';
import type { ModuleAnalysis } from '../../types/ModuleAnalysis.js';
import { extractClaims } from './extract-claims.js';
import { problemScoreFromFraction } from '../../types/Score.js';

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
	// TODO server to hold digest of Google Factcheck, Snopes, FullFact, etc
    const result = await factCheckContent(chunk, claims, pageMetadata, {
      apiKey: config.googleFactCheckKey,
      languageCode: 'en',
    });
    // No published rating (no key, or nothing matched). A heuristic/mock is not a verdict.
    const found = result.metadata?.factChecksFound;
    if (claims.length > 0 && !(typeof found === 'number' && found > 0)) {
      logit('log', '[factChecker] no published fact-check; trying LLM general knowledge');
      const llm = await checkWithGeneralKnowledge(chunk, claims, pageMetadata, options);
      if (llm.metadata?.diagnostic === 'llm_general_knowledge') {
        return mergeGeneralKnowledge(result, llm);
      }
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
