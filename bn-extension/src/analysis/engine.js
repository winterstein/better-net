/**
 * Chunk analysis orchestration (background worker entrypoint).
 */

import { ANALYSIS_FEATURES, ANALYSIS_FEATURE_IDS } from '../features/registry.js';
import { logit } from '../utils/logger.js';

/**
 * @param {Object} settings - merged BetterNet settings
 * @param {string} [domain]
 * @returns {string[]}
 */
export function enabledFeaturesFromSettings(settings, domain) {
  const host = domain?.replace(/^www\./, '');
  if (host && settings.excludedSites?.includes(host)) return [];
  const overrides = settings.domainOverrides?.[host];
  return ANALYSIS_FEATURE_IDS.filter((id) => {
    const mod = settings.modules?.[id];
    if (mod && mod.enabled === false) return false;
    if (overrides && overrides[id] === false) return false;
    return mod?.enabled !== false;
  });
}

/**
 * @param {Object} chunk
 * @param {Object} pageMetadata
 * @param {Object} options
 * @returns {Promise<Object>}
 */
async function analyzeChunk(chunk, pageMetadata, options = {}) {
  const { enabledFeatures = ANALYSIS_FEATURE_IDS } = options;
  const analyses = {};
  const tasks = [];

  for (const feature of ANALYSIS_FEATURES) {
    if (!enabledFeatures.includes(feature.id)) continue;
    tasks.push(
      feature
        .analyze(chunk, pageMetadata, options)
        .then((result) => {
          analyses[feature.id] = result;
        })
        .catch((error) => {
          logit('warn', `[ANALYSIS] ${feature.id} failed:`, error.message);
          analyses[feature.id] = {
            error: error.message,
            score: 0,
            confidence: 0,
            flags: [],
          };
        })
    );
  }

  await Promise.all(tasks);

  const scores = Object.values(analyses)
    .filter((a) => a && !a.error && typeof a.score === 'number')
    .map((a) => a.score);

  return {
    chunkId: chunk.id ?? chunk.fingerprint ?? chunk.xpath ?? '',
    xpath: chunk.xpath,
    analyses,
    overallScore: scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0,
  };
}

/**
 * Analyze chunks in parallel batches.
 * @param {Array} chunks
 * @param {Object} pageMetadata
 * @param {Object} options
 * @param {(chunk: Object, result: Object) => void} [onAnalysis]
 * @returns {Promise<Array>}
 */
export async function analyzeChunksParallel(
  chunks,
  pageMetadata = {},
  options = {},
  onAnalysis
) {
  const { maxConcurrency = 5, ...analysisOptions } = options;
  const results = [];

  for (let i = 0; i < chunks.length; i += maxConcurrency) {
    const batch = chunks.slice(i, i + maxConcurrency);
    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        const result = await analyzeChunk(chunk, pageMetadata, analysisOptions);
        if (onAnalysis) onAnalysis(chunk, result);
        return result;
      })
    );
    results.push(...batchResults);
  }

  return results;
}
