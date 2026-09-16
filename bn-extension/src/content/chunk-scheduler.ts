/**
 * What to analyse now, in what order, and what can wait.
 *
 * Analysis is the slow part of a page view, so on a long page most of the work is spent on
 * content the reader may never reach. Two rules fix that:
 *  - Priority: biggest-and-highest first, so the main article, or the top of a feed, is
 *    labelled while the rest is still queued.
 *  - Viewport gating: chunks below the fold wait until they scroll into view.
 *
 * This module only decides and observes; the content script sends and the background
 * analyses (content/content.ts, background/background.ts).
 */

import { findElementByXPath } from '../utils/utils.js';
import { logit } from '../utils/logger.js';
import type { Chunk } from '../types/Chunk.js';

/**
 * How far outside the viewport still counts as "on screen", in CSS pixels. A chunk just
 * below the fold is one flick of a scroll wheel away, and analysis takes longer than that,
 * so start it before it is visible.
 */
export const VIEWPORT_MARGIN_PX = 600;

/** One message per burst of scrolling rather than one per chunk crossing the margin. */
const RELEASE_DEBOUNCE_MS = 120;

/** Where a chunk is and how much text it holds. `null` when it has no element on the page. */
export interface ChunkMetrics {
  element: Element | null;
  /** Distance from the top of the viewport, in CSS pixels (negative when scrolled past). */
  top: number;
  height: number;
  textLength: number;
}

export interface ChunkPlan {
  /** Every chunk, in the order it should be analysed. */
  ordered: Chunk[];
  /** How many leading chunks of `ordered` to analyse now; the rest wait for a scroll. */
  analyseNow: number;
  /** The deferred chunks, ready for scheduleDeferredChunks(). */
  deferred: Chunk[];
}

export interface DeferredSchedule {
  /** Chunks still waiting for a scroll. Reported to the Popup as "waiting". */
  pending(): number;
  /** Give up on gating and hand everything over now. */
  releaseAll(): void;
  /** Navigation or re-analysis: drop the observer and forget the chunks. */
  stop(): void;
}

/** Measure a chunk against the live DOM. Layout read only — no writes, so no reflow cost. */
export function measureChunk(chunk: Partial<Chunk>): ChunkMetrics {
  const found = chunk?.xpath ? findElementByXPath(chunk.xpath) : null;
  const element = found && (found as Node).nodeType === 1 ? (found as Element) : null;
  const rect = element?.getBoundingClientRect();
  return {
    element,
    top: rect?.top ?? 0,
    height: rect?.height ?? 0,
    textLength: chunk?.text?.length ?? 0,
  };
}

/**
 * Bigger and higher up the page wins.
 *
 * Length is used in logs: a 4000-character article should outrank a 400-character teaser,
 * but not by ten times. Depth is measured in viewports rather than pixels, so between two
 * posts of the same size the higher one goes first — which on a feed is the top of the feed.
 */
export function chunkPriority(textLength: number, docTop: number, viewportHeight: number): number {
  const size = Math.log1p(Math.max(0, textLength));
  const depth = 1 + Math.max(0, docTop) / Math.max(1, viewportHeight);
  return size / depth;
}

/** Does this chunk's box reach the viewport, allowing for VIEWPORT_MARGIN_PX? */
function isOnScreen(metrics: ChunkMetrics, viewportHeight: number, margin: number): boolean {
  // No element (a headline teaser whose xpath no longer resolves, or a canned demo chunk)
  // cannot be observed or placed, so it is never held back.
  if (!metrics.element) return true;
  if (metrics.height < 1) return true;
  return metrics.top - margin < viewportHeight && metrics.top + metrics.height + margin > 0;
}

/**
 * @param options.gate false analyses the whole page at once (Settings -> Advanced), and
 *        still applies the priority order — ordering is free, gating is the trade-off.
 */
export function planChunks(
  chunks: Chunk[] = [],
  options: {
    gate?: boolean;
    margin?: number;
    viewportHeight?: number;
    measure?: (chunk: Chunk) => ChunkMetrics;
  } = {}
): ChunkPlan {
  const {
    gate = true,
    margin = VIEWPORT_MARGIN_PX,
    viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight || 800,
    measure = measureChunk,
  } = options;

  const scored = chunks.map((chunk, index) => {
    const metrics = measure(chunk);
    const docTop = metrics.top + (typeof window === 'undefined' ? 0 : window.scrollY || 0);
    return {
      chunk,
      index,
      onScreen: isOnScreen(metrics, viewportHeight, margin),
      /** Has a box we could compare against the viewport — see isOnScreen(). */
      measurable: !!metrics.element && metrics.height >= 1,
      priority: chunkPriority(metrics.textLength, docTop, viewportHeight),
    };
  });

  // On-screen first so that "analyse now" is a prefix of `ordered` — the background is then
  // given one list and a count, and the deferred chunks are what follows.
  scored.sort((a, b) => {
    if (gate && a.onScreen !== b.onScreen) return a.onScreen ? -1 : 1;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.index - b.index;
  });

  const ordered = scored.map((s) => s.chunk);
  // At least one chunk, even when nothing is on screen (a page scrolled past its content,
  // or a DOM the xpaths no longer match): a page analysis that starts empty looks broken.
  const onScreenCount = scored.filter((s) => s.onScreen).length;
  const analyseNow = gate ? Math.min(ordered.length, Math.max(1, onScreenCount)) : ordered.length;

  // The first question about a missing label is "was that chunk even analysed?", so say
  // how the page was split, and why anything unmeasurable went through immediately.
  const noBox = scored.filter((s) => s.onScreen && !s.measurable).length;
  logit(
    'log',
    `[BetterNet] [CONTENT] Chunk schedule: ${ordered.length} chunk(s) — ${analyseNow} now` +
      (noBox ? ` (${noBox} with no box on the page)` : '') +
      `, ${ordered.length - analyseNow} waiting for a scroll` +
      (gate ? '' : ' (gating off)')
  );

  return { ordered, analyseNow, deferred: ordered.slice(analyseNow) };
}

/**
 * Watch deferred chunks and hand them over as they come into view.
 *
 * Lifecycle: created per analysis in content.ts, stopped on the next analysis or on SPA
 * navigation. A chunk is released once — it is unobserved as it goes.
 */
export function scheduleDeferredChunks(
  deferred: Chunk[] = [],
  onRelease: (chunks: Chunk[]) => void,
  options: { margin?: number } = {}
): DeferredSchedule {
  const { margin = VIEWPORT_MARGIN_PX } = options;
  const byElement = new Map<Element, Chunk>();
  let queued: Chunk[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let observer: IntersectionObserver | null = null;

  const flush = () => {
    timer = null;
    if (!queued.length) return;
    const batch = queued;
    queued = [];
    onRelease(batch);
  };

  const release = (chunk: Chunk) => {
    queued.push(chunk);
    if (!timer) timer = setTimeout(flush, RELEASE_DEBOUNCE_MS);
  };

  const schedule: DeferredSchedule = {
    pending: () => byElement.size + queued.length,
    releaseAll() {
      const rest = [...byElement.values()];
      byElement.clear();
      observer?.disconnect();
      observer = null;
      for (const chunk of rest) queued.push(chunk);
      if (timer) clearTimeout(timer);
      timer = null;
      flush();
    },
    stop() {
      observer?.disconnect();
      observer = null;
      byElement.clear();
      queued = [];
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };

  for (const chunk of deferred) {
    const found = chunk?.xpath ? findElementByXPath(chunk.xpath) : null;
    const element = found && (found as Node).nodeType === 1 ? (found as Element) : null;
    // Nothing to observe: analyse it now rather than lose it.
    if (!element) release(chunk);
    else byElement.set(element, chunk);
  }

  if (typeof IntersectionObserver === 'undefined') {
    logit('log', '[BetterNet] [CONTENT] No IntersectionObserver — analysing every chunk now');
    schedule.releaseAll();
    return schedule;
  }

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const chunk = byElement.get(entry.target);
        if (!chunk) continue;
        byElement.delete(entry.target);
        observer?.unobserve(entry.target);
        release(chunk);
      }
    },
    { rootMargin: `${margin}px 0px` }
  );
  for (const element of byElement.keys()) observer.observe(element);

  logit('log', '[BetterNet] [CONTENT] Waiting for', schedule.pending(), 'chunk(s) to scroll into view');
  return schedule;
}
