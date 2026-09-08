/**
 * Chunk analysis orchestration (background worker entrypoint).
 */

import { ANALYSIS_MODULES, ANALYSIS_MODULE_IDS } from '../features/registry.js';
import { traceStep, setAttributes, traceIds } from '../tracing/tracer-hook.js';
import { logit } from '../utils/logger.js';
import { completeModuleAnalysis } from '../types/ModuleAnalysis.js';
import type { ModuleAnalysis } from '../types/ModuleAnalysis.js';
import { fractionFromProblemScore, issueTagIds } from '../types/Score.js';
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
  return ANALYSIS_MODULE_IDS.filter((id) => {
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
    ANALYSIS_MODULE_IDS;
  const { enabledFeatures: _ef, enabledAnalyzers: _ea, ...analysisOptions } = options;
  const analyses: ModuleAnalysis[] = [];
  const tasks = [];

  for (const feature of ANALYSIS_MODULES) {
    if (!enabledFeatures.includes(feature.id)) continue;
    tasks.push(
      traceStep(
        `betternet.feature.${feature.id}`,
        {
          parent: analysisOptions.trace,
          attributes: { 'betternet.feature': feature.id, input: chunkInput(chunk) },
        },
        (span) =>
          feature
            .analyze(chunk, pageMetadata, { ...analysisOptions, trace: span })
            .then((result: Partial<ModuleAnalysis>) => {
              const scoreFraction =
                typeof result.problemScore === 'number'
                  ? result.problemScore
                  : result.problemScore
                    ? fractionFromProblemScore(result.problemScore)
                    : 0;
              setAttributes(span, {
                'betternet.problem_score': scoreFraction,
                'betternet.confidence': result.confidence ?? 0,
                'betternet.tag_count': result.tags?.length ?? 0,
                output: featureOutput(result),
              });
              // Carried to the modal so a thumbs down links to this feature call.
              return { ...result, spanId: traceIds(span)?.spanId };
            })
      )
        .then((result: Partial<ModuleAnalysis>) => {
          analyses.push(completeModuleAnalysis(feature.id, result));
        })
        .catch((error) => {
          logit('warn', `[ANALYSIS] ${feature.id} failed:`, error.message);
          analyses.push(
            completeModuleAnalysis(feature.id, {
              error: error.message,
              problemScore: 0,
              confidence: 0,
              tags: [],
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
        const result = await traceStep(
          'betternet.analyze_chunk',
          { parent: analysisOptions.trace, attributes: chunkAttributes(chunk) },
          async (span) => {
            const analysis = await analyzeChunk(chunk, pageMetadata, {
              ...analysisOptions,
              trace: span,
            });
            setAttributes(span, { output: chunkOutput(analysis) });
            // The modal links feedback on this chunk (and on the chunker) to this trace.
            const ids = traceIds(span);
            analysis.traceId = ids?.traceId;
            analysis.spanId = ids?.spanId;
            return analysis;
          }
        );
        if (onAnalysis) onAnalysis(chunk, result);
        return result;
      })
    );
    results.push(...batchResults);
  }

  return results;
}

/** Span attributes identifying a chunk. Text length only, never the text itself. */
function chunkAttributes(chunk: Chunk) {
  return {
    input: chunkInput(chunk),
    'betternet.chunk.id': String(chunk.id ?? chunk.fingerprint ?? ''),
    'betternet.chunk.xpath': chunk.xpath ?? '',
    'betternet.chunk.text_length': chunk.text?.length ?? 0,
    'betternet.chunk.tags': (chunk.tags ?? []).join(','),
  };
}

/**
 * AIQA's `input` for a chunk: its headline, and blank when it has none. A plain
 * paragraph's own text is page content, which stays in the browser — so it is never
 * used as a stand-in for a missing headline.
 */
function chunkInput(chunk: Chunk): string {
  return chunk.title ?? '';
}

/** Two decimals: scores are averages, and a trace does not need 17 digits of one. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** AIQA's `output` for a chunk: the verdict the whole chunk ended up with. */
function chunkOutput(analysis: ChunkAnalysis): string {
  return JSON.stringify({
    risk: analysis.summary.overallRisk,
    score: round2(fractionFromProblemScore(analysis.summary.problemScore)),
    flags: analysis.summary.flags.map((flag) => flag.label),
  });
}

/**
 * AIQA's `output` for one feature. The explanation is the model's own words about the
 * chunk — the thing an AI QA run is there to judge — so it is included, capped.
 */
const MAX_EXPLANATION_CHARS = 240;

function featureOutput(result: Partial<ModuleAnalysis>): string {
  const score =
    typeof result.problemScore === 'number'
      ? result.problemScore
      : result.problemScore
        ? fractionFromProblemScore(result.problemScore)
        : 0;
  return JSON.stringify({
    score: round2(score),
    confidence: round2(result.confidence ?? 0),
    tags: result.tags ? issueTagIds(result.tags as any) : [],
    explanation: (result.explanation ?? '').slice(0, MAX_EXPLANATION_CHARS),
  });
}
