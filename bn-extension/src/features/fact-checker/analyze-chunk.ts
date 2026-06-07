/**
 * Fact Checker — chunk analysis via Google Fact Check Tools API.
 */

import { factCheckContent } from './factcheck-google.js';
import { logit } from '../../utils/logger.js';

/**
 * @param {Object} chunk
 * @param {Object} pageMetadata
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function analyzeChunk(chunk, pageMetadata: any = {}, options: any = {}) {
  const { config = {} } = options;
  try {
    const result = await factCheckContent(chunk, pageMetadata, {
      apiKey: config.googleFactCheckKey,
      languageCode: 'en',
    });
    return result;
  } catch (error) {
    logit('warn', '[factChecker] analysis failed:', error.message);
    return {
      error: error.message,
      problemScore: 0,
      confidence: 0,
      flags: [],
      explanation: `Fact check unavailable: ${error.message}`,
    };
  }
}
