/**
 * Chunk analysis orchestration (background worker entrypoint).
 */

import { ANALYSIS_MODULES, ANALYSIS_MODULE_IDS } from '../features/registry.js';
import { hostListed, normalizeHost } from '../utils/host.js';
import { hardSkipPageReason, routeChunk } from '../features/module-routing.js';
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
  const host = normalizeHost(domain || '');
  if (host && hostListed(host, settings.excludedSites)) return [];
  const overrides =
    settings.domainOverrides?.[host] ||
    settings.domainOverrides?.[`www.${host}`];
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

  // Classify before analyzing (specs/content-classification.md): settings say which
  // modules the user wants, routing says which of them this chunk is worth spending on.
  // Skips are traced, not silent — a missing analysis must be explainable in AIQA.
  const pageSkip = hardSkipPageReason(pageMetadata);
  const { run, skipped } = pageSkip
    ? { run: [], skipped: Object.fromEntries(enabledFeatures.map((id) => [id, pageSkip])) }
    : routeChunk(enabledFeatures, chunk, pageMetadata);
  if (Object.keys(skipped).length) {
    setAttributes(analysisOptions.trace, {
      'betternet.routing.skipped': Object.entries(skipped)
        .map(([id, reason]) => `${id}=${reason}`)
        .join(','),
    });
  }

  for (const feature of ANALYSIS_MODULES) {
    if (!run.includes(feature.id)) continue;
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

/** One chunk, traced, with the feedback trace ids the modal needs attached. */
async function analyzeTracedChunk(
  chunk: Chunk,
  pageMetadata: Partial<PageMetadata>,
  analysisOptions: Partial<AnalysisOptions> & { enabledFeatures?: string[] }
): Promise<ChunkAnalysis> {
  return traceStep(
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
}

/** Live counts for the Popup's chunk progress line (popup/popup.ts). */
export interface ChunkQueueCounts {
  /** Waiting for a free worker. */
  queued: number;
  /** Being analysed right now. */
  active: number;
  /** Finished, successfully or not. */
  done: number;
}

export interface ChunkQueue {
  /** Queue more chunks — allowed while the queue is running. */
  add(chunks: Chunk[]): void;
  /** Resolves when nothing is queued or in flight. Re-await it after another add(). */
  idle(): Promise<void>;
  counts(): ChunkQueueCounts;
  /** Finished analyses, in the order the chunks were added. */
  results(): ChunkAnalysis[];
}

/**
 * A worker pool over a queue the caller can push to while it is running.
 *
 * Chunks now arrive in batches rather than all at once: the content script holds back
 * chunks that are off screen and releases them as they scroll into view
 * (content/chunk-scheduler.ts). A fixed batch loop could not take work mid-flight, so a
 * chunk released by a scroll waited for the whole batch — and on a long feed that is the
 * one chunk the reader is looking at.
 */
export function createChunkQueue(
  pageMetadata: Partial<PageMetadata> = {},
  options: Partial<AnalysisOptions> & { enabledFeatures?: string[]; maxConcurrency?: number } = {},
  onAnalysis?: (chunk: Chunk, result: ChunkAnalysis) => void
): ChunkQueue {
  const { maxConcurrency = 5, ...analysisOptions } = options;
  /** Slot per submitted chunk, so results keep submission (= priority) order. */
  const slots: (ChunkAnalysis | undefined)[] = [];
  const waiting: { chunk: Chunk; slot: number }[] = [];
  let active = 0;
  let done = 0;
  let idleWaiters: (() => void)[] = [];

  function releaseIdle() {
    if (active || waiting.length) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function runJob(job: { chunk: Chunk; slot: number }) {
    try {
      const result = await analyzeTracedChunk(job.chunk, pageMetadata, analysisOptions);
      slots[job.slot] = result;
      if (onAnalysis) onAnalysis(job.chunk, result);
    } catch (error) {
      // analyzeChunk() already absorbs per-feature failures, so this is the chunk itself
      // failing. One bad chunk must not stall the rest of the page.
      logit('warn', '[ANALYSIS] chunk failed:', error?.message ?? error);
    }
  }

  function pump() {
    while (active < maxConcurrency && waiting.length) {
      const job = waiting.shift();
      active += 1;
      void runJob(job).then(() => {
        active -= 1;
        done += 1;
        pump();
        releaseIdle();
      });
    }
  }

  return {
    add(chunks: Chunk[] = []) {
      for (const chunk of chunks) {
        waiting.push({ chunk, slot: slots.length });
        slots.push(undefined);
      }
      pump();
    },
    idle() {
      if (!active && !waiting.length) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    counts() {
      return { queued: waiting.length, active, done };
    },
    results() {
      return slots.filter(Boolean) as ChunkAnalysis[];
    },
  };
}

/**
 * Analyze a fixed set of chunks, `maxConcurrency` at a time.
 * Thin wrapper over createChunkQueue() for callers with the whole page in hand.
 */
export async function analyzeChunksParallel(
  chunks: Chunk[],
  pageMetadata: Partial<PageMetadata> = {},
  options: Partial<AnalysisOptions> & { enabledFeatures?: string[]; maxConcurrency?: number } = {},
  onAnalysis?: (chunk: Chunk, result: ChunkAnalysis) => void
): Promise<ChunkAnalysis[]> {
  const queue = createChunkQueue(pageMetadata, options, onAnalysis);
  queue.add(chunks);
  await queue.idle();
  return queue.results();
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
