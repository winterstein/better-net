/**
 * Extract verifiable claim strings from text (heuristic).
 */

const MAX_CLAIMS_TO_CHECK = 3;
const MIN_CLAIM_LENGTH = 20;

const claimPatterns = [
  /^(?:According to|Studies show|Research indicates|Scientists say|Experts claim|It is|This is|That is)/i,
  /(?:is|are|was|were|does|did|has|have|will|would|can|could|should|must)\s+(?:a|an|the|not|never|always|all|no|some|many|most)/i,
  /(?:proven|fact|true|false|real|fake|hoax|scam|fraud)/i
];

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractClaims(text) {
  if (!text || text.length < MIN_CLAIM_LENGTH) {
    return [];
  }

  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length >= MIN_CLAIM_LENGTH);

  const claims = [];

  for (const sentence of sentences) {
    const isClaim = claimPatterns.some(pattern => pattern.test(sentence));
    if (isClaim && sentence.length >= MIN_CLAIM_LENGTH && sentence.length < 500) {
      claims.push(sentence);
    }
  }

  if (claims.length === 0 && sentences.length > 0) {
    claims.push(...sentences.slice(0, MAX_CLAIMS_TO_CHECK));
  }

  return claims.slice(0, MAX_CLAIMS_TO_CHECK);
}
