/**
 * Fact-check analysis result container (used by factcheck-google.js).
 */
export class FactCheckResults {
  /**
   * @param {number} score - Fake-news risk score 0–1 (higher = more problematic)
   * @param {number} confidence
   * @param {string[]} flags
   * @param {string} explanation
   * @param {Array} factChecks
   * @param {Record<string, unknown>} metadata
   */
  constructor(score, confidence, flags, explanation, factChecks, metadata = {}) {
    this.score = score;
    this.confidence = confidence;
    this.flags = flags;
    this.explanation = explanation;
    this.factChecks = factChecks;
    this.metadata = metadata;
  }
}
