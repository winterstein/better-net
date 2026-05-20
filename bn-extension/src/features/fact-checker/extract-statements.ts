/**
 * Extract key claims from text content
 * Simple heuristic-based extraction - could be enhanced with NLP
 */

import { logit } from '../utils/logger.js';
import type { Chunk } from '../types/Chunk.js';
import type { AnalysisOptions } from '../types/AnalysisOptions.js';
import type { Statement } from '../types/Statement.js';

const MAX_CLAIMS_TO_CHECK = 3; // Limit number of claims to check per chunk
const MIN_CLAIM_LENGTH = 20; // Minimum length for a claim to be worth checking

/**
 * Extract key claims from text content
 * Simple heuristic-based extraction - could be enhanced with NLP
 * @param {string} text - Text content to extract claims from
 * @returns {Array<string>} Array of potential claims
 */
export async function extractStatements(chunk: Partial<Chunk>, options: AnalysisOptions) : Promise<Statement[]> {
  const { mode = 'local', config = {} } = options;
  const text = chunk.text || '';
  if (!text || text.length < MIN_CLAIM_LENGTH) {
    return [];
  }

  const claims : Statement[] = [];
  
  // Split by sentences (periods, exclamation marks, question marks)
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length >= MIN_CLAIM_LENGTH);
  
  // Filter for sentences that look like factual claims
  // Look for patterns like "X is Y", "X does Y", "According to", "Studies show", etc.
  const claimPatterns = [
    /^(?:According to|Studies show|Research indicates|Scientists say|Experts claim|It is|This is|That is)/i,
    /(?:is|are|was|were|does|did|has|have|will|would|can|could|should|must)\s+(?:a|an|the|not|never|always|all|no|some|many|most)/i,
    /(?:proven|fact|true|false|real|fake|hoax|scam|fraud)/i
  ];

  for (const sentence of sentences) {
    // Check if sentence matches claim patterns
    const isClaim = claimPatterns.some(pattern => pattern.test(sentence));
    
    if (isClaim && sentence.length >= MIN_CLAIM_LENGTH && sentence.length < 500) {
		let statement = {
			type: 'claim',
			summaryText: sentence,
			analyses: []
		} as Statement;
      claims.push(statement);
    }
  }

  // If no pattern matches, take the first few substantial sentences
  if (claims.length === 0 && sentences.length > 0) {
	for (const sentence of sentences.slice(0, MAX_CLAIMS_TO_CHECK)) {
		let statement = {
			type: 'claim',
			summaryText: sentence,
			analyses: []
		} as Statement;
		claims.push(statement);
	}
  }

  // Limit to MAX_CLAIMS_TO_CHECK
  logit('log', '[EXTRACT_CLAIMS for FACT CHECK] Extracted claims:', claims);
  return claims.slice(0, MAX_CLAIMS_TO_CHECK);
}

