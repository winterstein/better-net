/** Background service worker for BetterNet extension
Coordinates page analysis and manages state
*/ 

import { analyzeChunksParallel, enabledFeaturesFromSettings } from '../analysis/engine.js';
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

function noteLocalAiDiagnostics(state, chunkAnalysis) {
  if (!state.diagnostics) state.diagnostics = [];
  const seen = new Set(state.diagnostics);
  for (const a of chunkAnalysis?.analyses || []) {
    const err = a.metadata?.localModelError;
    if (typeof err !== 'string' || !err) continue;
    const msg = friendlyLocalAiDiagnostic(err);
    if (seen.has(msg)) continue;
    seen.add(msg);
    state.diagnostics.push(msg);
  }
}

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
        case 'ANALYZE_CHUNKS':
          this.startAnalysis(
            tabId,
            message.url,
            message.chunks,
            message.pageMetadata,
            message.adsHidden ?? 0,
            message.traceSteps
          );
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

  async startAnalysis(tabId, url, chunks, pageMetadata, adsHidden = 0, traceSteps = undefined) {
    setTabId(tabId);
    logit('log', '[BetterNet] [ANALYZE_CHUNKS] Starting analysis for tab', tabId, 'URL:', url, 'Chunks:', chunks.length);
    
    // Check if site is excluded
    const isExcluded = await this.isSiteExcluded(url);
    if (isExcluded) {
      logit('log', '[BetterNet] [ANALYZE_CHUNKS] Site is excluded:', url);
      this.broadcastUpdate(tabId, {
        status: 'excluded',
        message: 'This site is excluded from analysis',
        siteEnabled: false,
      });
      return;
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
      return;
    }

    // Initialize analysis state
    const analysisId = `${tabId}-${Date.now()}`;
    const state = {
      id: analysisId,
      tabId,
      url,
      chunks, // Store chunks for analysis
      pageMetadata,
      adsHidden,
      neutralisedCount: 0,
      status: 'analyzing',
      progress: 0,
      stages: Object.fromEntries(
        ['contentExtraction', ...ANALYSIS_MODULE_IDS].map((id) => [
          id,
          id === 'contentExtraction' ? 'completed' : 'pending',
        ])
      ),
      results: [],
      /** Chunking steps timed in the content script; replayed as spans in performAnalysis. */
      traceSteps,
      startTime: Date.now()
    };

    this.activeAnalyses.set(tabId, state);
    logit('log', '[BetterNet] [ANALYZE_CHUNKS] Analysis state initialized:', {
      id: analysisId,
      url,
      chunksCount: chunks.length
    });

    // Send initial status update
    this.broadcastUpdate(tabId, {
      status: 'analyzing',
      progress: 0,
      currentStage: 'Starting analysis...'
    });

    // Start async analysis
    this.performAnalysis(state);
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

  async performAnalysis(state) {
    try {
      setTabId(state.tabId);
      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Starting analysis for tab', state.tabId);
      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analyzing', state.chunks.length, 'chunks');
      
      // Prepare page metadata
      const pageMetadata = {
        url: state.url,
        title: state.pageMetadata?.title || '',
        domain: state.pageMetadata?.domain || new URL(state.url).hostname,
        author: state.pageMetadata?.author || '',
        description: state.pageMetadata?.description || ''
      };
      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Page metadata:', pageMetadata);

      // Ensure chrome storage is initialized
      await initializeChromeStorage();
      
      const stored = await chrome.storage.sync.get(null);
      const settings = mergeSettings(stored);
      setDeveloperMode(developerModeFromSettings(settings));
      const enabledFeatures = enabledFeaturesFromSettings(
        settings,
        pageMetadata.domain
      );

      // AIQA tracing: settings can change between analyses, so reconfigure each time.
      await configureAiqaTracing(settings);
      state.trace = startSpan('betternet.analyze_page', {
        startTime: earliestStart(state),
        attributes: {
          input: traceInput(pageMetadata),
          'betternet.url': state.url,
          'betternet.domain': pageMetadata.domain,
          'betternet.chunk_count': state.chunks.length,
          'betternet.analysis_mode': settings.analysisMode,
          'betternet.enabled_features': enabledFeatures.join(','),
        },
      });
      recordRelayedSteps(state.traceSteps, state.trace);
      
      // Get API keys from env-utils (checks env vars, env.js, chrome.storage)
      const googleFactCheckKey = getGoogleFactCheckKey();
      const openaiKey = getOpenAIKey();
      const anthropicKey = getAnthropicKey();
      
      const { localModels = {} } = await chrome.storage.local.get({ localModels: {} });
      const localModelId = settings.localModelId || 'flan-t5-small';
      const localModelReady =
        settings.analysisMode !== 'local' ||
        isInstalled(localModels[localModelId]);

      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analysis settings:', {
        mode: settings.analysisMode,
        localModelId,
        localModelReady,
        hasOpenAIKey: !!openaiKey,
        hasAnthropicKey: !!anthropicKey,
        hasGoogleFactCheckKey: !!googleFactCheckKey
      });

      // Keep the on-device pipeline in RAM across pages: warm (or load) before the batch.
      // Trace only a real load — a cache hit is silent so AIQA stays about work that mattered.
      if (settings.analysisMode === 'local' && localModelReady) {
        this.broadcastUpdate(state.tabId, {
          status: 'analyzing',
          progress: 5,
          currentStage: 'Loading local AI model…',
          stages: { ...state.stages },
        });
        // Started before the load so a failure span reports how long it burned. Created in
        // the catch it was always ~0ms, which hid the difference between an instant error
        // and a 90s timeout. Only ended on failure — a success is traced by recordSteps.
        const loadSpan = startSpan('local.load_model', {
          parent: state.trace,
          attributes: {
            'gen_ai.system': 'local',
            'gen_ai.request.model': localModelId,
            'betternet.model.cached': false,
          },
        });
        try {
          const warm = await warmLocalModel(localModelId);
          if (warm?.cached === false) {
            recordSteps(warm.traceSteps, state.trace);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logit('warn', '[BetterNet] [PERFORM_ANALYSIS] warmLocalModel failed:', message);
          endSpan(loadSpan, {}, err);
          state.diagnostics = [friendlyLocalAiDiagnostic(message)];
          this.broadcastUpdate(state.tabId, {
            status: 'analyzing',
            progress: 5,
            currentStage: 'Local AI unavailable — using heuristics…',
            stages: { ...state.stages },
          });
        }
      }

      // Perform analysis with parallel processing
      this.broadcastUpdate(state.tabId, {
        status: 'analyzing',
        progress: 10,
        currentStage: 'Analyzing content chunks in parallel...',
        stages: { ...state.stages },
      });

	  // send per-chunk updates to the page
	  const onAnalysis = (chunk, combinedResults) => {
		logit('log', '[BetterNet] [ON_ANALYSIS] Chunk analysis complete:', {
			chunkId: chunk.id,
			xpath: chunk.xpath,
			problemScore: chunkProblemScore(combinedResults),
			analysesCount: combinedResults.analyses?.length ?? 0
		});
		if (isNeutralisedScore(chunkProblemScore(combinedResults))) {
		  state.neutralisedCount += 1;
		}
		noteLocalAiDiagnostics(state, combinedResults);
		this.broadcastUpdate(state.tabId, {
			type: "analysisUpdate",
			xpath: chunk.xpath,
			combinedResults,
			neutralisedCount: state.neutralisedCount,
		});
	  };
      
      const demoPage = settings.demoMode ? findDemoPage(state.url) : undefined;
      const demoResults = demoPage ? demoResultsForChunks(state.url, state.chunks) : [];
      if (demoPage) {
        // Say which of the two happened. The fallback also returns results, so a plain
        // count read as a match and hid the fact that nothing could be labelled.
        const canned = demoResults.some((r) => r.canned);
        logit(
          'log',
          '[BetterNet] [PERFORM_ANALYSIS] Demo mode:',
          demoPage.title,
          canned
            ? `— no page chunk matched, falling back to ${demoResults.length} canned chunk(s); the page cannot be labelled`
            : `— matched ${demoResults.length} of ${state.chunks.length} page chunks`
        );
      }

      // A canned headline can turn up as a link on a page we have no demo entry for — which
      // is the whole of the click-unbait example. Serve those chunks from the dataset and let
      // the pipeline handle the rest of the page as normal.
      const demoLinks =
        settings.demoMode && !demoPage ? demoLinkResultsForChunks(state.url, state.chunks) : [];
      if (demoLinks.length) {
        logit(
          'log',
          '[BetterNet] [PERFORM_ANALYSIS] Demo mode: matched',
          demoLinks.length,
          'demo headline link(s) on this page'
        );
      }
      const demoLinkChunks = new Set(demoLinks.map(({ chunk }) => chunk));
      const serveDemo = ({ chunk, analysis }) => {
        onAnalysis(chunk, analysis);
        return analysis;
      };

      // Click Unbait fetches destination pages. Reset the per-page allowance here, so a
      // feed of clickbait costs a bounded number of outbound requests rather than one per
      // flagged chunk.
      beginDestinationBudget(state.url);

      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analyzing chunks in parallel...');
      const chunkResults = demoPage
        ? demoResults.map(serveDemo)
        : [
            ...demoLinks.map(serveDemo),
            ...(await analyzeChunksParallel(
              state.chunks.filter((chunk) => !demoLinkChunks.has(chunk)),
              pageMetadata,
              {
                mode: settings.analysisMode,
                config: {
                  apiKey: openaiKey,
                  openaiKey: openaiKey,
                  anthropicKey: anthropicKey,
                  googleFactCheckKey: googleFactCheckKey,
                  localModelId,
                },
                maxConcurrency: 5,
                enabledFeatures,
                trace: state.trace,
              },
              onAnalysis
            )),
          ];
      
      // Catch any local-model fallbacks that did not fire through onAnalysis mid-flight.
      for (const cr of chunkResults) noteLocalAiDiagnostics(state, cr);

      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analysis complete:', {
        chunksAnalyzed: chunkResults.length
      });

      // Convert results to expected format
      if (chunkResults && chunkResults.length > 0) {
        logit('log', '[BetterNet] [PERFORM_ANALYSIS] Processing results, chunks:', chunkResults.length);
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

          if (scores.length > 0) {
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
          }
        });

        state.results = aggregated;
        state.progress = 100;
        logit('log', '[BetterNet] [PERFORM_ANALYSIS] Final aggregated results:', aggregated);
      } else {
        logit('warn', '[BetterNet] [PERFORM_ANALYSIS] No analysis results');
        state.results = [];
        state.progress = 100;
      }

      this.broadcastUpdate(state.tabId, {
        status: 'analyzing',
        progress: 100,
        currentStage: 'Analysis complete',
        stages: { ...state.stages },
        partialResults: state.results,
      });

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

    } catch (error) {
      logit('error', '[BetterNet] [PERFORM_ANALYSIS] Error:', error);
      logit('error', '[BetterNet] [PERFORM_ANALYSIS] Error stack:', error.stack);
      endSpan(state.trace, {}, error);
      state.trace = null;
      this.broadcastUpdate(state.tabId, {
        status: 'error',
        error: error.message
      });
    } finally {
      endSpan(state.trace, {
        'betternet.neutralised_count': state.neutralisedCount ?? 0,
        'betternet.duration_ms': Date.now() - state.startTime,
      });
      state.trace = null;
      await flushAiqaSpans();
    }
  } // ./performAnalysis

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
    // Diagnostics are sticky for the whole analysis. Every update replaces the stored
    // record and the popup rebuilds its banner from it, so an update that omitted them
    // blanked a warning raised by an earlier chunk.
    data = { diagnostics: [...(state?.diagnostics ?? [])], ...data };
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

  completeAnalysis(tabId, result) {
    setTabId(tabId);
    logit('log', '[BetterNet] [COMPLETE_ANALYSIS] Tab:', tabId, 'Result:', {
      url: result.url,
      chunks: result.chunks?.length || 0,
      summary: result.summary?.overall,
      duration: result.duration
    });
    
    const state = this.activeAnalyses.get(tabId);
    if (state) {
      state.status = 'completed';
      state.progress = 100;
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
        diagnostics: result.diagnostics ?? state?.diagnostics ?? [],
        result,
        timestamp: Date.now()
      }
    });

    // Clean up after a delay
    setTimeout(() => {
      this.activeAnalyses.delete(tabId);
      setTabId(tabId);
      logit('log', '[BetterNet] [COMPLETE_ANALYSIS] Cleaned up analysis state for tab', tabId);
    }, 60000); // Keep for 1 minute
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
