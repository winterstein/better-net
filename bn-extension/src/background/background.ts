/** Background service worker for BetterNet extension
Coordinates page analysis and manages state
*/ 

import { createChunkQueue, enabledFeaturesFromSettings } from '../analysis/engine.js';
import { beginDestinationBudget } from '../features/click-unbait/fetch-destination.js';
import {
  demoChunks,
  demoLinkResultsForChunks,
  demoResultsForChunks,
  findDemoPage,
} from '../analysis/demo-analysis.js';
import { ANALYSIS_MODULE_IDS } from '../features/registry.js';
import {
	completeModuleAnalysis,
	findAnalysisByModule,
} from '../types/ModuleAnalysis.js';
import type { ModuleAnalysis } from '../types/ModuleAnalysis.js';
import { fractionFromProblemScore, issueTagIds, worstProblemScore } from '../types/Score.js';
import { chunkProblemScore } from '../types/ChunkAnalysis.js';
import { hardSkipPageReason } from '../features/module-routing.js';
import { chunkKey } from '../types/Chunk.js';
import { mergeSettings } from '../settings/modules-esm.js';
import { getGoogleFactCheckKey, getOpenAIKey, getAnthropicKey, initializeChromeStorage } from '../utils/env-utils.js';
import { logit, setTabId, setDeveloperMode, developerModeFromSettings } from '../utils/logger.js';
import { setupModelManager } from './model-manager.js';
import { setupUpdateManager } from './update-manager.js';
import { setupFeedbackManager, handleSubmitFeedback } from './feedback-manager.js';
import { migrateDeveloperMode } from '../settings/migrate-settings.js';
import { clearToolbarBadge, forgetToolbarBadge, updateToolbarBadge } from './toolbar-badge.js';
import { shouldBlockPageAds } from '../ad-blocker/run.js';
import {
	configureAiqaTracing,
	flushAiqaSpans,
	recordRelayedSteps,
} from '../tracing/aiqa-tracer.js';
import { startSpan, endSpan, setAttributes, recordSteps } from '../tracing/tracer-hook.js';
import { warmLocalModel } from '../ai/local-inference-client.js';
import { isInstalled } from '../ai/model-status.js';

/** Chunks labelled below safe (caution / high-risk). */
function isNeutralisedScore(score) {
  return score != null && score >= 0.4;
}

/** Short Popup-facing copy for local-model failures (full error stays in traces). */
function friendlyLocalAiDiagnostic(raw: string): string {
  if (/Offscreen request timed out/i.test(raw)) {
    return 'Local AI timed out — some checks used heuristics instead.';
  }
  if (/Offscreen port disconnected|did not connect/i.test(raw)) {
    return 'Local AI worker unavailable — some checks used heuristics instead.';
  }
  if (/Not enough memory/i.test(raw)) {
    return 'Local AI ran out of memory — some checks used heuristics instead.';
  }
  return 'Local AI unavailable — some checks used heuristics instead.';
}

/** One line in the popup's diagnostics banner, once per pass however often it is hit. */
function noteDiagnostic(state, message) {
  if (!state.diagnostics) state.diagnostics = [];
  if (!state.diagnostics.includes(message)) state.diagnostics.push(message);
}

function noteLocalAiDiagnostics(state, chunkAnalysis) {
  for (const a of chunkAnalysis?.analyses || []) {
    const err = a.metadata?.localModelError;
    if (typeof err !== 'string' || !err) continue;
    noteDiagnostic(state, friendlyLocalAiDiagnostic(err));
  }
}

/**
 * Why a sign-in or payment page comes back with nothing. The skip itself is enforced in
 * the engine (features/module-routing.ts HARD_SKIP_PAGE_TYPES); this is so the popup can
 * say so rather than looking broken.
 */
const CONTENT_ANALYSIS_OFF_MESSAGE =
  'Content analysis is off on sign-in and payment pages.';

/**
 * AIQA shows a trace's `input` / `output` attributes as its headline pair (aiqa-client
 * sets them from a wrapped function's arguments and return value). For a page analysis
 * that is the page we were given, and the verdict we reached.
 */
function traceInput(pageMetadata): string {
  return [pageMetadata.domain, pageMetadata.title].filter(Boolean).join(': ');
}

function traceOutput(summary, state): string {
  return JSON.stringify({
    overall: summary.overall,
    score: Math.round((summary.score ?? 0) * 100) / 100,
    chunks: state.chunks.length,
    neutralised: state.neutralisedCount ?? 0,
  });
}

/**
 * Earliest timestamp the page analysis touched, so its trace covers chunking too:
 * the content script chunks the page before it messages the background.
 */
function earliestStart(state): number {
  const starts = (state.traceSteps ?? [])
    .map((step) => step?.start)
    .filter((start) => Number.isFinite(start));
  return Math.min(state.startTime, ...starts);
}

// Test that service worker loaded
try {
  logit('log', '[BetterNet] Background service worker loaded');
  logit('log', '[BetterNet] Service worker initialization complete');
} catch (error) {
  console.error('[BetterNet] Service worker initialization error:', error);
  console.error('[BetterNet] Error stack:', error.stack);
}

/** Demo mode is a recording aid: on for now, so the URLs in analysis/demo-analysis.ts
 *  serve canned results. Turn it off with `chrome.storage.sync.set({ demoMode: false })`,
 *  and change the default before production. */
async function isDemoModeEnabled(): Promise<boolean> {
  try {
    const { demoMode } = await chrome.storage.sync.get({ demoMode: true }); // TODO: set to false for production
    return !!demoMode;
  } catch {
    return true;
  }
}

class AnalysisManager {
  [key: string]: any;

  constructor() {
    try {
      this.activeAnalyses = new Map(); // tabId -> analysis state
      this.setupListeners();
      logit('log', '[BetterNet] AnalysisManager initialized successfully');
    } catch (error) {
      console.error('[BetterNet] AnalysisManager constructor error:', error);
      console.error('[BetterNet] Error stack:', error.stack);
      throw error; // Re-throw to prevent silent failures
    }
  }

  setupListeners() {
    try {
      // Listen for messages from content scripts
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const handledTypes = new Set([
          'ANALYZE_CHUNKS',
          'ANALYZE_MORE_CHUNKS',
          'ANALYSIS_UPDATE',
          'ANALYSIS_COMPLETE',
          'GET_ANALYSIS_STATUS',
          'GET_AD_BLOCK_STATUS',
          'SITE_EXCLUSION_CHANGED',
          'BN_SUBMIT_FEEDBACK',
          'POPUP_OPENED',
          'POPUP_ERROR',
        ]);
        if (!handledTypes.has(message?.type)) return false;

        void this.handleMessage(message, sender, sendResponse).catch((error) => {
          console.error('[BetterNet] Error in handleMessage:', error);
          console.error('[BetterNet] Error stack:', error.stack);
          logit('error', '[BetterNet] Error handling message:', error.message);
          try {
            sendResponse({ error: error.message });
          } catch {
            // Channel may already be closed
          }
        });
        return true; // Keep channel open for async responses
      });

      // Clean up when tabs are closed
      chrome.tabs.onRemoved.addListener((tabId) => {
        try {
          this.activeAnalyses.delete(tabId);
          forgetToolbarBadge(tabId);
        } catch (error) {
          console.error('[BetterNet] Error in onRemoved listener:', error);
        }
      });

      // Handle tab updates
      chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        try {
          if (changeInfo.status === 'loading') {
            // Reset analysis when page starts loading
            this.activeAnalyses.delete(tabId);
            clearToolbarBadge(tabId);
          }
        } catch (error) {
          console.error('[BetterNet] Error in onUpdated listener:', error);
        }
      });

      logit('log', '[BetterNet] Listeners setup complete');
    } catch (error) {
      console.error('[BetterNet] Error setting up listeners:', error);
      console.error('[BetterNet] Error stack:', error.stack);
      throw error;
    }
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      const tabId = sender.tab?.id;
      setTabId(tabId);
      logit('log', '[BetterNet] [HANDLE_MESSAGE] Received message:', message.type, message);

      switch (message.type) {
        // The content script sends the whole page in priority order, and says how many of
        // the leading chunks to analyse now; the rest follow as they scroll into view
        // (content/chunk-scheduler.ts). The reply tells it whether gating applies at all.
        case 'ANALYZE_CHUNKS':
          sendResponse(
            await this.startAnalysis(
              tabId,
              message.url,
              message.chunks,
              message.pageMetadata,
              message.adsHidden ?? 0,
              message.traceSteps,
              message.analyseNow
            )
          );
          break;

        case 'ANALYZE_MORE_CHUNKS':
          sendResponse(await this.addChunks(tabId, message));
          break;

      case 'ANALYSIS_UPDATE':
        this.broadcastUpdate(tabId, message.data);
        break;

      case 'ANALYSIS_COMPLETE':
        this.completeAnalysis(tabId, message.result);
        break;

      case 'GET_ANALYSIS_STATUS':
        sendResponse({
          status: this.getAnalysisStatus(message.tabId ?? tabId),
        });
        break;

      case 'GET_AD_BLOCK_STATUS':
        await this.getAdBlockStatus(message.tabId ?? tabId, sendResponse);
        break;

      case 'SITE_EXCLUSION_CHANGED': {
        const targetTab = message.tabId ?? tabId;
        if (message.excluded) {
          this.activeAnalyses.delete(targetTab);
          updateToolbarBadge(targetTab, { status: 'excluded', siteEnabled: false });
        } else {
          clearToolbarBadge(targetTab);
        }
        break;
      }

      // Popup lifecycle — logged here because the service worker console
      // survives the popup closing, unlike the popup's own console.
      case 'POPUP_OPENED': {
        const popupTab = message.tabId ?? tabId;
        logit(
          'log',
          `[BetterNet][popup] opened for tab ${popupTab} in ${message.openMs ?? '?'}ms`,
          message.url ?? ''
        );
        sendResponse({ ok: true });
        break;
      }

      case 'POPUP_ERROR': {
        console.error(
          `[BetterNet][popup] problem on tab ${message.tabId ?? tabId}:`,
          message.message
        );
        sendResponse({ ok: true });
        break;
      }

      case 'BN_SUBMIT_FEEDBACK': {
        const result = await handleSubmitFeedback(message);
        sendResponse(result);
        break;
      }

      default:
        logit('warn', '[BetterNet] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[BetterNet] Error in handleMessage:', error);
      console.error('[BetterNet] Error stack:', error.stack);
      logit('error', '[BetterNet] Error handling message:', error.message);
      // Try to send error response if sendResponse is available
      if (sendResponse && typeof sendResponse === 'function') {
        try {
          sendResponse({ error: error.message });
        } catch (e) {
          // Ignore errors sending response
        }
      }
    }
  }

  async getAdBlockStatus(tabId, sendResponse) {
    if (!tabId) {
      sendResponse({ enabled: false, blockedCount: 0, adsPreviewActive: false });
      return;
    }

    let hostname = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        sendResponse({ enabled: false, blockedCount: 0, adsPreviewActive: false });
        return;
      }
      hostname = new URL(tab.url).hostname;
    } catch {
      sendResponse({ enabled: false, blockedCount: 0, adsPreviewActive: false });
      return;
    }

    const settings = mergeSettings((await chrome.storage.sync.get(null)) as unknown as Record<string, unknown>);
    const enabled = shouldBlockPageAds(settings, hostname);
    let blockedCount = 0;
    let adsPreviewActive = false;

    if (enabled) {
      try {
        const tabStatus = await chrome.tabs.sendMessage(tabId, { type: 'GET_AD_BLOCK_STATUS' });
        if (tabStatus) {
          blockedCount = tabStatus.blockedCount ?? 0;
          adsPreviewActive = tabStatus.adsPreviewActive ?? false;
        }
      } catch {
        // Content script not ready yet
      }

      const stored = await chrome.storage.local.get(`analysis_${tabId}`);
      const analysis = stored[`analysis_${tabId}`];
      const fromAnalysis = analysis?.adsHidden ?? 0;
      blockedCount = Math.max(blockedCount, fromAnalysis);
    }

    sendResponse({ enabled, blockedCount, adsPreviewActive });
  }

  /**
   * Begin a page analysis.
   *
   * The content script sends every chunk it found, in priority order, and how many of the
   * leading ones to analyse now (content/chunk-scheduler.ts); the rest arrive through
   * addChunks() as they scroll into view. The reply tells the page whether that gating
   * applies — it does not on a demo page.
   */
  async startAnalysis(
    tabId,
    url,
    chunks,
    pageMetadata,
    adsHidden = 0,
    traceSteps = undefined,
    analyseNow = undefined
  ) {
    setTabId(tabId);
    logit('log', '[BetterNet] [ANALYZE_CHUNKS] Starting analysis for tab', tabId, 'URL:', url, 'Chunks:', chunks?.length ?? 0);

    // Check if site is excluded
    const isExcluded = await this.isSiteExcluded(url);
    if (isExcluded) {
      logit('log', '[BetterNet] [ANALYZE_CHUNKS] Site is excluded:', url);
      this.broadcastUpdate(tabId, {
        status: 'excluded',
        message: 'This site is excluded from analysis',
        siteEnabled: false,
      });
      return { releaseAll: false };
    }

    if (!chunks || chunks.length === 0) {
      // A demo URL that would not chunk (a feed behind a login, say) still has canned chunks.
      chunks = (await isDemoModeEnabled()) ? demoChunks(url) : [];
    }

    if (!chunks || chunks.length === 0) {
      logit('warn', '[BetterNet] [ANALYZE_CHUNKS] No chunks provided');
      this.broadcastUpdate(tabId, {
        status: 'no_chunks',
        message: 'No content chunks found',
        adsHidden,
      });
      return { releaseAll: false };
    }

    // A demo page is served from canned results matched against the page's whole chunk
    // list, so gating saves nothing there — and it would make a recording wait for a scroll.
    const releaseAll = (await isDemoModeEnabled()) && !!findDemoPage(url);
    // At least one chunk, even when the page says none are on screen: an analysis that
    // starts with nothing queued reads as a broken extension.
    const first =
      releaseAll || analyseNow == null
        ? chunks
        : chunks.slice(0, Math.min(chunks.length, Math.max(1, analyseNow)));

    // Initialize analysis state
    const analysisId = `${tabId}-${Date.now()}`;
    const state = {
      id: analysisId,
      tabId,
      url,
      /** Every chunk the page produced, in the order it wants them analysed. */
      chunks: [...chunks],
      /** Keys of the chunks in `chunks`, so a re-sent chunk is not stored twice. */
      knownKeys: new Set(chunks.map(chunkKey).filter(Boolean)),
      /** Queued or analysed, so a chunk released twice is still analysed once. */
      queuedKeys: new Set(),
      /** Every analysis so far, across passes — what the popup's results aggregate from. */
      chunkResults: [],
      /** Chunks the page is holding back until they scroll into view. */
      chunksWaiting: chunks.length - first.length,
      pageMetadata,
      adsHidden,
      neutralisedCount: 0,
      status: 'analyzing',
      progress: 0,
      /** Analysis passes run so far: one per batch of chunks the page hands over. */
      passes: 0,
      stages: Object.fromEntries(
        ['contentExtraction', ...ANALYSIS_MODULE_IDS].map((id) => [
          id,
          id === 'contentExtraction' ? 'completed' : 'pending',
        ])
      ),
      results: [],
      /** Chunking steps timed in the content script; replayed as spans by the first pass. */
      traceSteps,
      startTime: Date.now()
    };

    this.activeAnalyses.set(tabId, state);
    logit('log', '[BetterNet] [ANALYZE_CHUNKS] Analysis state initialized:', {
      id: analysisId,
      url,
      chunksCount: chunks.length,
      analysingNow: first.length,
      waiting: state.chunksWaiting,
    });

    this.broadcastProgress(state, { progress: 0, currentStage: 'Starting analysis...' });
    void this.runPass(state, this.freshChunks(state, first));
    return { releaseAll };
  }

  /**
   * More chunks, released because the reader scrolled to them. They join the pass already
   * running when there is one, so the chunk in front of the reader is not stuck behind the
   * rest of a batch.
   */
  async addChunks(tabId, message) {
    setTabId(tabId);
    const state = this.activeAnalyses.get(tabId);
    // No state means the service worker was recycled (or the tab moved on) while the page
    // was holding chunks back: take what the page just sent as a fresh analysis.
    if (!state || state.url !== message.url) {
      const plan = await this.startAnalysis(tabId, message.url, message.chunks, message.pageMetadata);
      // The page may still be holding chunks back; it says how many with every release.
      const rebuilt = this.activeAnalyses.get(tabId);
      if (rebuilt) rebuilt.chunksWaiting = message.chunksWaiting ?? 0;
      return plan;
    }

    // The page is still feeding us work, so the state has to outlive the last pass.
    clearTimeout(state.cleanupTimer);
    state.chunksWaiting = message.chunksWaiting ?? 0;
    const fresh = this.freshChunks(state, message.chunks || []);
    logit('log', '[BetterNet] [ANALYZE_MORE_CHUNKS]', fresh.length, 'chunk(s) scrolled into view,', state.chunksWaiting, 'still waiting');

    if (!fresh.length) {
      // Already analysed (a chunk can be released twice): the counts changed, the status
      // did not — claiming to be analysing here would put a finished page back on a
      // progress bar.
      this.broadcastProgress(state, { status: state.status });
      return { ok: true };
    }

    state.status = 'analyzing';
    if (state.running && state.queue) {
      state.queue.add(fresh);
      this.broadcastProgress(state);
    } else {
      void this.runPass(state, fresh);
    }
    return { ok: true };
  }

  /** The chunks of `chunks` not already queued, recorded against this analysis. */
  freshChunks(state, chunks) {
    const fresh = [];
    for (const chunk of chunks || []) {
      const key = chunkKey(chunk);
      if (key) {
        if (state.queuedKeys.has(key)) continue;
        state.queuedKeys.add(key);
        if (!state.knownKeys.has(key)) {
          state.knownKeys.add(key);
          state.chunks.push(chunk);
        }
      } else {
        // Nothing to key on (a canned chunk with its xpath stripped): take it at face value.
        state.chunks.push(chunk);
      }
      fresh.push(chunk);
    }
    return fresh;
  }

  async isSiteExcluded(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      const settings = await chrome.storage.sync.get({ excludedSites: [] });
      const excludedSites = settings.excludedSites || [];
      
      return excludedSites.includes(hostname);
    } catch {
      return false;
    }
  }

  /**
   * Settings, page metadata and API keys for a pass. Re-read per pass rather than cached:
   * settings can change between one batch of chunks and the next.
   */
  async analysisContext(state) {
    const pageMetadata = {
      url: state.url,
      title: state.pageMetadata?.title || '',
      domain: state.pageMetadata?.domain || new URL(state.url).hostname,
      author: state.pageMetadata?.author || '',
      description: state.pageMetadata?.description || '',
      // Classified in the content script, where the DOM is (classify/page-type.ts).
      // The engine routes on it; absent means unknown, which routes nothing out.
      pageType: state.pageMetadata?.pageType,
    };

    // Ensure chrome storage is initialized
    await initializeChromeStorage();

    const stored = await chrome.storage.sync.get(null);
    const settings = mergeSettings(stored);
    setDeveloperMode(developerModeFromSettings(settings));
    const enabledFeatures = enabledFeaturesFromSettings(settings, pageMetadata.domain);

    // AIQA tracing: settings can change between analyses, so reconfigure each time.
    await configureAiqaTracing(settings);

    const { localModels = {} } = await chrome.storage.local.get({ localModels: {} });
    const localModelId = settings.localModelId || 'flan-t5-small';
    const localModelReady =
      settings.analysisMode !== 'local' || isInstalled(localModels[localModelId]);

    logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analysis settings:', {
      mode: settings.analysisMode,
      localModelId,
      localModelReady,
      hasOpenAIKey: !!getOpenAIKey(),
      hasAnthropicKey: !!getAnthropicKey(),
      hasGoogleFactCheckKey: !!getGoogleFactCheckKey()
    });

    return {
      pageMetadata,
      settings,
      enabledFeatures,
      localModelId,
      localModelReady,
      // Get API keys from env-utils (checks env vars, env.js, chrome.storage)
      config: {
        apiKey: getOpenAIKey(),
        openaiKey: getOpenAIKey(),
        anthropicKey: getAnthropicKey(),
        googleFactCheckKey: getGoogleFactCheckKey(),
        localModelId,
      },
    };
  }

  /** One AIQA span per pass: an MV3 worker can be recycled between passes. */
  openPassTrace(state, ctx, chunks) {
    state.trace = startSpan('betternet.analyze_page', {
      // The first pass covers chunking too: the content script chunks before it messages us.
      startTime: state.passes > 1 ? state.passStart : earliestStart(state),
      attributes: {
        input: traceInput(ctx.pageMetadata),
        'betternet.url': state.url,
        'betternet.domain': ctx.pageMetadata.domain,
        'betternet.chunk_count': chunks.length,
        'betternet.chunk_total': state.chunks.length,
        'betternet.pass': state.passes,
        'betternet.analysis_mode': ctx.settings.analysisMode,
        'betternet.enabled_features': ctx.enabledFeatures.join(','),
      },
    });
    if (state.passes === 1) recordRelayedSteps(state.traceSteps, state.trace);
  }

  /**
   * Keep the on-device pipeline in RAM across pages: warm (or load) before the batch.
   * Trace only a real load — a cache hit is silent so AIQA stays about work that mattered.
   */
  async warmLocalModelForPass(state, ctx) {
    if (ctx.settings.analysisMode !== 'local' || !ctx.localModelReady) return;
    this.broadcastProgress(state, { progress: 5, currentStage: 'Loading local AI model…' });
    // Started before the load so a failure span reports how long it burned. Created in
    // the catch it was always ~0ms, which hid the difference between an instant error
    // and a 90s timeout. Only ended on failure — a success is traced by recordSteps.
    const loadSpan = startSpan('local.load_model', {
      parent: state.trace,
      attributes: {
        'gen_ai.system': 'local',
        'gen_ai.request.model': ctx.localModelId,
        'betternet.model.cached': false,
      },
    });
    try {
      const warm = await warmLocalModel(ctx.localModelId);
      if (warm?.cached === false) {
        recordSteps(warm.traceSteps, state.trace);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logit('warn', '[BetterNet] [PERFORM_ANALYSIS] warmLocalModel failed:', message);
      endSpan(loadSpan, {}, err);
      state.diagnostics = [friendlyLocalAiDiagnostic(message)];
      this.broadcastProgress(state, {
        progress: 5,
        currentStage: 'Local AI unavailable — using heuristics…',
      });
    }
  }

  /**
   * One analysis pass: the chunks given, plus anything the page releases while it runs.
   *
   * Lifecycle: a pass owns its own trace span and publishes a cumulative result when it
   * drains, so the popup and the page keep up with a page that hands over chunks over
   * time. Nothing is held open between passes — the worker may be recycled while the
   * reader scrolls, and addChunks() rebuilds what it needs.
   */
  async runPass(state, chunks) {
    if (!chunks?.length) return;
    state.running = true;
    state.passes += 1;
    state.passStart = Date.now();

    try {
      setTabId(state.tabId);
      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Pass', state.passes, 'over', chunks.length, 'chunk(s) for tab', state.tabId);

      const ctx = await this.analysisContext(state);
      if (hardSkipPageReason(ctx.pageMetadata)) noteDiagnostic(state, CONTENT_ANALYSIS_OFF_MESSAGE);
      this.openPassTrace(state, ctx, chunks);
      await this.warmLocalModelForPass(state, ctx);

      this.broadcastProgress(state, { currentStage: 'Analyzing content chunks in parallel...' });

      const queue = createChunkQueue(
        ctx.pageMetadata,
        {
          mode: ctx.settings.analysisMode,
          config: ctx.config,
          maxConcurrency: 5,
          enabledFeatures: ctx.enabledFeatures,
          trace: state.trace,
        },
        (chunk, combinedResults) => this.onChunkAnalysed(state, chunk, combinedResults)
      );
      state.queue = queue;

      // Click Unbait fetches destination pages. Reset the per-page allowance here, so a
      // feed of clickbait costs a bounded number of outbound requests rather than one per
      // flagged chunk.
      beginDestinationBudget(state.url);

      queue.add(this.demoServedChunks(state, ctx, chunks));
      // A scroll can release a chunk between the queue draining and this check; waiting
      // again is cheaper than publishing a pass that leaves it out.
      do {
        await queue.idle();
      } while (queue.counts().queued || queue.counts().active);

      this.publishPass(state, ctx);
    } catch (error) {
      logit('error', '[BetterNet] [PERFORM_ANALYSIS] Error:', error);
      logit('error', '[BetterNet] [PERFORM_ANALYSIS] Error stack:', error.stack);
      endSpan(state.trace, {}, error);
      state.trace = null;
      if (this.isCurrentAnalysis(state)) {
        this.broadcastUpdate(state.tabId, {
          status: 'error',
          error: error.message
        });
      }
    } finally {
      state.running = false;
      state.queue = null;
      endSpan(state.trace, {
        'betternet.neutralised_count': state.neutralisedCount ?? 0,
        'betternet.duration_ms': Date.now() - state.passStart,
      });
      state.trace = null;
      await flushAiqaSpans();
    }
  } // ./runPass

  /**
   * Canned demo results (analysis/demo-analysis.ts) for the chunks in this pass, served
   * straight through as if analysed. Returns the chunks that still need real analysis.
   */
  demoServedChunks(state, ctx, chunks) {
    if (!ctx.settings.demoMode) return chunks;

    const demoPage = findDemoPage(state.url);
    if (demoPage) {
      const demoResults = demoResultsForChunks(state.url, chunks);
      // Say which of the two happened. The fallback also returns results, so a plain
      // count read as a match and hid the fact that nothing could be labelled.
      const canned = demoResults.some((r) => r.canned);
      logit(
        'log',
        '[BetterNet] [PERFORM_ANALYSIS] Demo mode:',
        demoPage.title,
        canned
          ? `— no page chunk matched, falling back to ${demoResults.length} canned chunk(s); the page cannot be labelled`
          : `— matched ${demoResults.length} of ${chunks.length} page chunks`
      );
      for (const served of demoResults) {
        this.onChunkAnalysed(state, served.chunk, served.analysis);
      }
      return [];
    }

    // A canned headline can turn up as a link on a page we have no demo entry for — which
    // is the whole of the click-unbait example. Serve those chunks from the dataset and let
    // the pipeline handle the rest of the page as normal.
    const demoLinks = demoLinkResultsForChunks(state.url, chunks);
    if (!demoLinks.length) return chunks;

    logit(
      'log',
      '[BetterNet] [PERFORM_ANALYSIS] Demo mode: matched',
      demoLinks.length,
      'demo headline link(s) on this page'
    );
    const served = new Set(demoLinks.map(({ chunk }) => chunk));
    for (const link of demoLinks) this.onChunkAnalysed(state, link.chunk, link.analysis);
    return chunks.filter((chunk) => !served.has(chunk));
  }

  /** Per chunk: record it, label it on the page, and refresh the popup's live counts. */
  onChunkAnalysed(state, chunk, combinedResults) {
    logit('log', '[BetterNet] [ON_ANALYSIS] Chunk analysis complete:', {
      chunkId: chunk.id,
      xpath: chunk.xpath,
      problemScore: chunkProblemScore(combinedResults),
      analysesCount: combinedResults.analyses?.length ?? 0
    });
    state.chunkResults.push(combinedResults);
    if (isNeutralisedScore(chunkProblemScore(combinedResults))) {
      state.neutralisedCount += 1;
    }
    noteLocalAiDiagnostics(state, combinedResults);
    if (!this.isCurrentAnalysis(state)) return;
    // Carries the verdict to the page (the Nutrient Label) and the counts to the popup.
    this.broadcastProgress(state, {
      type: 'analysisUpdate',
      xpath: chunk.xpath,
      combinedResults,
      neutralisedCount: state.neutralisedCount,
    });
  }

  /** Worst score per module over every chunk analysed so far. */
  aggregateModules(state, chunkResults, enabledFeatures) {
    const aggregated: ModuleAnalysis[] = [];
    ANALYSIS_MODULE_IDS.forEach((moduleId) => {
      if (!enabledFeatures.includes(moduleId)) return;
      const scores = [];
      const tagIds = [];

      chunkResults.forEach((chunkResult) => {
        const analysis = findAnalysisByModule(chunkResult.analyses ?? [], moduleId);
        if (analysis && !analysis.error) {
          scores.push(analysis.problemScore);
          tagIds.push(...issueTagIds(analysis.tags || []));
        }
      });

      if (scores.length === 0) return;

      const firstAnalysis = chunkResults
        .map((cr) => findAnalysisByModule(cr.analyses ?? [], moduleId))
        .find((a) => a && !a.error);
      aggregated.push(
        completeModuleAnalysis(moduleId, {
          problemScore: worstProblemScore(scores),
          confidence: 0.8,
          tags: [...new Set(tagIds)],
          explanation: firstAnalysis?.explanation,
          metadata: firstAnalysis?.metadata,
        })
      );
      state.stages[moduleId] = 'completed';
      logit(
        'log',
        '[BetterNet] [PERFORM_ANALYSIS] Aggregated',
        moduleId,
        'problemScore:',
        aggregated[aggregated.length - 1].problemScore
      );
    });
    return aggregated;
  }

  /**
   * Publish everything analysed so far. Runs once per pass, so a page that hands over
   * chunks as they scroll into view shows a result now and a fuller one later.
   */
  publishPass(state, ctx) {
    if (!this.isCurrentAnalysis(state)) {
      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Superseded page — not publishing', state.url);
      return;
    }
    const chunkResults = state.chunkResults;
    logit('log', '[BetterNet] [PERFORM_ANALYSIS] Pass', state.passes, 'complete:', {
      chunksAnalyzed: chunkResults.length,
      waiting: state.chunksWaiting ?? 0,
    });

    // Catch any local-model fallbacks that did not fire through onChunkAnalysed.
    for (const cr of chunkResults) noteLocalAiDiagnostics(state, cr);

    state.results = chunkResults.length
      ? this.aggregateModules(state, chunkResults, ctx.enabledFeatures)
      : [];
    state.progress = 100;

    // Generate summary
    const summary = this.generateSummary(state.results);
    if (state.diagnostics?.length) {
      summary.warnings = [...(summary.warnings || []), ...state.diagnostics];
    }
    state.summaryOverall = summary.overall;
    state.neutralisedCount = chunkResults.filter((cr) =>
      isNeutralisedScore(chunkProblemScore(cr))
    ).length;
    setAttributes(state.trace, { output: traceOutput(summary, state) });

    const chunkByKey = new Map(
      state.chunks.map((c) => [c.id ?? c.fingerprint ?? c.xpath, c])
    );

    this.completeAnalysis(state.tabId, {
      url: state.url,
      analysisId: state.id,
      results: state.results,
      summary: summary,
      diagnostics: state.diagnostics ? [...state.diagnostics] : [],
      chunkResults: chunkResults.map((cr) => {
        const src = (chunkByKey.get(cr.chunkId) || {}) as Record<string, any>;
        const text = src.text || '';
        return {
          ...cr,
          textPreview: text.slice(0, 120) + (text.length > 120 ? '…' : ''),
        };
      }),
      aggregated: {},
      timestamp: Date.now(),
      duration: Date.now() - state.startTime
    });
  } // ./publishPass

  getStageName(stage) {
    const names = {
      contentExtraction: 'Extracting content',
      factChecker: 'Fact checking',
      biasDetector: 'Detecting bias',
      antiManipulation: 'Anti-manipulation scan',
      defuseRagebait: 'Defusing ragebait',
      clickUnbait: 'Unravelling clickbait',
    };
    return names[stage] || stage;
  }

  generateSummary(results: ModuleAnalysis[]) {
    const summary = {
      overall: 'safe',
      score: 0,
      warnings: [],
      recommendations: []
    };

    const scores = (results || []).map((r) =>
      typeof r.problemScore === 'number'
        ? r.problemScore
        : fractionFromProblemScore(r.problemScore || 'low')
    );
    summary.score = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    if (summary.score > 0.7) {
      summary.overall = 'high-risk';
    } else if (summary.score > 0.4) {
      summary.overall = 'caution';
    }

    return summary;
  }

  /**
   * Live chunk counts for the popup: what the page found, what we have analysed, and what
   * is still to come. `waiting` is chunks the page is holding back for a scroll
   * (content/chunk-scheduler.ts) — work that will not happen until the reader gets there.
   */
  chunkStats(state) {
    const counts = state.queue?.counts() ?? { queued: 0, active: 0, done: 0 };
    return {
      found: state.chunks.length,
      analysed: state.chunkResults.length,
      inFlight: counts.active,
      queued: counts.queued,
      waiting: state.chunksWaiting ?? 0,
    };
  }

  /** 10-95%: chunk analysis is the bulk of a page view, and 100% means a published pass. */
  chunkProgress(stats) {
    const total = stats.analysed + stats.inFlight + stats.queued + stats.waiting;
    if (!total) return 10;
    return Math.min(95, 10 + Math.round((85 * stats.analysed) / total));
  }

  /**
   * Is this state still the tab's analysis? A page view can be superseded mid-pass — an SPA
   * navigation, or a reload — and the losing pass must not publish its page's results over
   * the one the reader is now looking at.
   */
  isCurrentAnalysis(state) {
    return this.activeAnalyses.get(state.tabId) === state;
  }

  /** An analysing update with the counts attached, so every tick keeps the popup honest. */
  broadcastProgress(state, extra: Record<string, any> = {}) {
    const stats = this.chunkStats(state);
    state.chunkStats = stats;
    this.broadcastUpdate(state.tabId, {
      status: 'analyzing',
      progress: this.chunkProgress(stats),
      currentStage: `Analysing chunks (${stats.analysed} of ${stats.found})…`,
      chunkStats: stats,
      ...extra,
    });
  }

  syncToolbarBadge(tabId, data) {
    const state = this.activeAnalyses.get(tabId);
    updateToolbarBadge(tabId, {
      status: data.status,
      progress: data.progress ?? state?.progress ?? 0,
      neutralisedCount: data.neutralisedCount ?? state?.neutralisedCount ?? 0,
      adsHidden: data.adsHidden ?? state?.adsHidden ?? 0,
      summaryOverall: data.summaryOverall ?? state?.summaryOverall,
      siteEnabled: data.siteEnabled !== false,
    });
  }

  broadcastUpdate(tabId, data) {
	setTabId(tabId);
	logit('log', '[BetterNet] [BROADCAST_UPDATE] Tab:', tabId, data);
    
    // Update internal state
    const state = this.activeAnalyses.get(tabId);
    // These are sticky for the whole analysis. Every update replaces the stored record and
    // the popup rebuilds its view from it, so an update that omitted them blanked a warning
    // raised by an earlier chunk, or the chunk counts between two chunks finishing. The
    // analysis result is deliberately not sticky: it is big, and it would then be written
    // to storage once per chunk (the popup keeps the last one it saw, and can ask for it
    // with GET_ANALYSIS_STATUS).
    data = {
      diagnostics: [...(state?.diagnostics ?? [])],
      ...(state?.chunkStats ? { chunkStats: state.chunkStats } : {}),
      ...data,
    };
    if (state) {
      if (data.neutralisedCount != null) state.neutralisedCount = data.neutralisedCount;
      if (data.progress != null) state.progress = data.progress;
      if (data.status) state.status = data.status;
      Object.assign(state, data);
    }

    if (data.status && data.status !== 'analysisUpdate' && !data.type) {
      this.syncToolbarBadge(tabId, data);
    } else if (state?.status === 'analyzing' && data.neutralisedCount != null) {
      this.syncToolbarBadge(tabId, { status: 'analyzing', ...data });
    }

    // Send update to popup and content scripts
    chrome.tabs.sendMessage(tabId, {
      type: 'ANALYSIS_UPDATE',
      data
    }).then(() => {
      logit('log', '[BetterNet] [BROADCAST_UPDATE] Message sent successfully to tab', tabId);
    }).catch((error) => {
      logit('warn', '[BetterNet] [BROADCAST_UPDATE] Failed to send message to tab', tabId, ':', error.message);
      // Tab might not have content script loaded yet
    });

    // Also notify popup directly via storage (for when popup is open)
    chrome.storage.local.set({
      [`analysis_${tabId}`]: {
        tabId,
        ...data,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Publish a result for the tab. Called once per pass (publishPass), so this can run more
   * than once for a page: the analysis is only finished when the page has no chunks left
   * waiting for a scroll, and only then is the state scheduled for clean-up.
   */
  completeAnalysis(tabId, result) {
    setTabId(tabId);
    logit('log', '[BetterNet] [COMPLETE_ANALYSIS] Tab:', tabId, 'Result:', {
      url: result.url,
      chunks: result.chunks?.length || 0,
      summary: result.summary?.overall,
      duration: result.duration
    });
    
    const state = this.activeAnalyses.get(tabId);
    const waiting = state?.chunksWaiting ?? 0;
    if (state) {
      state.status = 'completed';
      state.progress = 100;
      // Kept in memory rather than re-sent with every progress update: the popup asks for
      // it with GET_ANALYSIS_STATUS when it opens mid-analysis.
      state.result = result;
      state.chunkStats = this.chunkStats(state);
    }

    updateToolbarBadge(tabId, {
      status: 'completed',
      progress: 100,
      neutralisedCount: state?.neutralisedCount ?? 0,
      adsHidden: state?.adsHidden ?? 0,
      summaryOverall: result.summary?.overall ?? state?.summaryOverall,
      siteEnabled: true,
    });

    // Broadcast completion
    chrome.tabs.sendMessage(tabId, {
      type: 'ANALYSIS_COMPLETE',
      result
    }).then(() => {
      logit('log', '[BetterNet] [COMPLETE_ANALYSIS] Completion message sent to tab', tabId);
    }).catch((error) => {
      logit('warn', '[BetterNet] [COMPLETE_ANALYSIS] Failed to send completion message:', error.message);
    });

    // Store final result
    chrome.storage.local.set({
      [`analysis_${tabId}`]: {
        tabId,
        status: 'completed',
        progress: 100,
        neutralisedCount: state?.neutralisedCount ?? 0,
        adsHidden: state?.adsHidden ?? 0,
        chunkStats: state?.chunkStats,
        diagnostics: result.diagnostics ?? state?.diagnostics ?? [],
        result,
        timestamp: Date.now()
      }
    });

    // Chunks still waiting on a scroll means the page can hand over more work at any time,
    // so keep the state: addChunks() would otherwise have to start the page over. The tab
    // closing or navigating clears it (setupListeners).
    if (waiting > 0) return;

    // Clean up after a delay
    if (state) clearTimeout(state.cleanupTimer);
    const cleanupTimer = setTimeout(() => {
      // Only if it is still this analysis: a reload or an SPA navigation puts a new state
      // in the map, and deleting by tab id alone threw away the live one.
      if (state && !this.isCurrentAnalysis(state)) return;
      this.activeAnalyses.delete(tabId);
      setTabId(tabId);
      logit('log', '[BetterNet] [COMPLETE_ANALYSIS] Cleaned up analysis state for tab', tabId);
    }, 60000); // Keep for 1 minute
    if (state) state.cleanupTimer = cleanupTimer;
  }

  getAnalysisStatus(tabId) {
    const state = this.activeAnalyses.get(tabId);
    if (!state) {
      return { status: 'not_started' };
    }
    return {
      status: state.status,
      progress: state.progress,
      stages: state.stages,
      currentStage: state.currentStage,
      results: state.results,
      diagnostics: state.diagnostics,
      // The popup opened mid-analysis: hand over the counts and the last published result,
      // which are not in the stored record between passes (broadcastUpdate).
      chunkStats: this.chunkStats(state),
      neutralisedCount: state.neutralisedCount,
      adsHidden: state.adsHidden,
      result: state.result,
    };
  }
} // .end AnalysisManager

void migrateDeveloperMode();
setupModelManager();
setupUpdateManager();
setupFeedbackManager();

// Initialize manager with error handling
let analysisManager;
try {
  analysisManager = new AnalysisManager();
  logit('log', '[BetterNet] AnalysisManager created successfully');
} catch (error) {
  console.error('[BetterNet] Failed to create AnalysisManager:', error);
  console.error('[BetterNet] Error stack:', error.stack);
  // Don't throw - allow service worker to continue even if manager fails
  // This prevents the entire service worker from crashing
}

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details.reason === 'install') {
      chrome.storage.local.set({ firstInstall: true });
    }
  } catch (error) {
    console.error('[BetterNet] Error in onInstalled listener:', error);
  }
});

// Handle service worker startup (for debugging)
chrome.runtime.onStartup?.addListener(() => {
  logit('log', '[BetterNet] Service worker started');
});

// Global error handler for unhandled promise rejections
self.addEventListener('error', (event) => {
  console.error('[BetterNet] Unhandled error:', event.error);
  console.error('[BetterNet] Error stack:', event.error?.stack);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[BetterNet] Unhandled promise rejection:', event.reason);
  console.error('[BetterNet] Rejection stack:', event.reason?.stack);
  event.preventDefault(); // Prevent default browser error handling
});
