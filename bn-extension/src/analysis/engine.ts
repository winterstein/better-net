/**
 * Chunk analysis orchestration (background worker entrypoint).
 */

import { ANALYSIS_FEATURES, ANALYSIS_FEATURE_IDS } from '../features/registry.js';
import { logit } from '../utils/logger.js';
import { completeAspectAnalysis } from '../types/AspectAnalysis.js';
import type { AspectAnalysis } from '../types/AspectAnalysis.js';
import type { ChunkAnalysis } from '../types/ChunkAnalysis.js';
import { buildChunkSummary } from '../types/ChunkAnalysis.js';
import type { Chunk } from '../types/Chunk.js';
import type { PageMetadata } from '../types/Page.js';
import type { AnalysisOptions } from '../types/AnalysisOptions.js';

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

async function analyzeChunk(
  chunk: Chunk,
  pageMetadata: Partial<PageMetadata>,
  options: Partial<AnalysisOptions> & { enabledFeatures?: string[] } = {}
): Promise<ChunkAnalysis> {
  const enabledFeatures =
    options.enabledFeatures ??
    options.enabledAnalyzers ??
    ANALYSIS_FEATURE_IDS;
  const { enabledFeatures: _ef, enabledAnalyzers: _ea, ...analysisOptions } = options;
  const analyses: AspectAnalysis[] = [];
  const tasks = [];

  for (const feature of ANALYSIS_FEATURES) {
    if (!enabledFeatures.includes(feature.id)) continue;
    tasks.push(
      feature
        .analyze(chunk, pageMetadata, analysisOptions)
        .then((result: Partial<AspectAnalysis>) => {
          analyses.push(completeAspectAnalysis(feature.id, result));
        })
        .catch((error) => {
          logit('warn', `[ANALYSIS] ${feature.id} failed:`, error.message);
          analyses.push(
            completeAspectAnalysis(feature.id, {
              error: error.message,
              problemScore: 0,
              confidence: 0,
              flags: [],
              explanation: `Analysis failed: ${error.message}`,
            })
          );
        })
    );
  }

  await Promise.all(tasks);

  const chunkId = String(chunk.id ?? chunk.fingerprint ?? chunk.xpath ?? '');
  return {
    chunkId,
    primaryTopic: 'unknown',
    statements: [],
    analyses,
    summary: buildChunkSummary(analyses),
    fingerprint: chunk.fingerprint,
    url: chunk.url ?? pageMetadata.url,
    xpath: chunk.xpath,
    title: chunk.title,
    tags: chunk.tags ?? [],
  };
}

/**
 * Analyze chunks in parallel batches.
 */
export async function analyzeChunksParallel(
  chunks: Chunk[],
  pageMetadata: Partial<PageMetadata> = {},
  options: Partial<AnalysisOptions> & { enabledFeatures?: string[]; maxConcurrency?: number } = {},
  onAnalysis?: (chunk: Chunk, result: ChunkAnalysis) => void
): Promise<ChunkAnalysis[]> {
  const { maxConcurrency = 5, ...analysisOptions } = options;
  const results: ChunkAnalysis[] = [];

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
