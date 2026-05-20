/** Background service worker for BetterNet extension
Coordinates page analysis and manages state
*/ 

import { analyzeChunksParallel, enabledFeaturesFromSettings } from '../analysis/engine.js';
import { ANALYSIS_FEATURE_IDS } from '../features/registry.js';
import { mergeSettings } from '../settings/modules-esm.js';
import { getGoogleFactCheckKey, getOpenAIKey, getAnthropicKey, initializeChromeStorage } from '../utils/env-utils.js';
import { logit, setTabId } from '../utils/logger.js';
import { setupModelManager } from './model-manager.js';
import { clearToolbarBadge, updateToolbarBadge } from './toolbar-badge.js';
import { shouldBlockPageAds } from '../ad-blocker/run.js';

/** Chunks labelled below safe (caution / high-risk). */
function isNeutralisedScore(score) {
  return score != null && score >= 0.4;
}

// Test that service worker loaded
try {
  logit('log', '[BetterNet] Background service worker loaded');
  console.log('[BetterNet] Service worker initialization complete');
} catch (error) {
  console.error('[BetterNet] Service worker initialization error:', error);
  console.error('[BetterNet] Error stack:', error.stack);
}

class AnalysisManager {
  constructor() {
    try {
      this.activeAnalyses = new Map(); // tabId -> analysis state
      this.setupListeners();
      console.log('[BetterNet] AnalysisManager initialized successfully');
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
        ]);
        if (!handledTypes.has(message?.type)) return false;

        try {
          this.handleMessage(message, sender, sendResponse);
        } catch (error) {
          console.error('[BetterNet] Error in handleMessage:', error);
          console.error('[BetterNet] Error stack:', error.stack);
          logit('error', '[BetterNet] Error handling message:', error.message);
        }
        return true; // Keep channel open for async responses
      });

      // Clean up when tabs are closed
      chrome.tabs.onRemoved.addListener((tabId) => {
        try {
          this.activeAnalyses.delete(tabId);
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

      console.log('[BetterNet] Listeners setup complete');
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
            message.adsHidden ?? 0
          );
          break;

      case 'ANALYSIS_UPDATE':
        this.broadcastUpdate(tabId, message.data);
        break;

      case 'ANALYSIS_COMPLETE':
        this.completeAnalysis(tabId, message.result);
        break;

      case 'GET_ANALYSIS_STATUS':
        sendResponse({ status: this.getAnalysisStatus(tabId) });
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

    const settings = mergeSettings(await chrome.storage.sync.get(null));
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

  async startAnalysis(tabId, url, chunks, pageMetadata, adsHidden = 0) {
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
        ['contentExtraction', ...ANALYSIS_FEATURE_IDS].map((id) => [
          id,
          id === 'contentExtraction' ? 'completed' : 'pending',
        ])
      ),
      results: {},
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
      const enabledFeatures = enabledFeaturesFromSettings(
        settings,
        pageMetadata.domain
      );
      
      // Get API keys from env-utils (checks env vars, env.js, chrome.storage)
      const googleFactCheckKey = getGoogleFactCheckKey();
      const openaiKey = getOpenAIKey();
      const anthropicKey = getAnthropicKey();
      
      const { localModels = {} } = await chrome.storage.local.get({ localModels: {} });
      const localModelReady =
        settings.analysisMode !== 'local' ||
        localModels[settings.localModelId]?.status === 'ready';

      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analysis settings:', {
        mode: settings.analysisMode,
        localModelId: settings.localModelId,
        localModelReady,
        hasOpenAIKey: !!openaiKey,
        hasAnthropicKey: !!anthropicKey,
        hasGoogleFactCheckKey: !!googleFactCheckKey
      });

      // Perform analysis with parallel processing
      this.broadcastUpdate(state.tabId, {
        status: 'analyzing',
        progress: 10,
        currentStage: 'Analyzing content chunks in parallel...',
        stages: { ...state.stages }
      });

	  // send per-chunk updates to the page
	  const onAnalysis = (chunk, combinedResults) => {
		logit('log', '[BetterNet] [ON_ANALYSIS] Chunk analysis complete:', {
			chunkId: chunk.id,
			xpath: chunk.xpath,
			overallScore: combinedResults.overallScore,
			analysesCount: Object.keys(combinedResults.analyses || {}).length
		});
		if (isNeutralisedScore(combinedResults.overallScore)) {
		  state.neutralisedCount += 1;
		}
		this.broadcastUpdate(state.tabId, {
			type: "analysisUpdate",
			xpath: chunk.xpath,
			combinedResults,
			neutralisedCount: state.neutralisedCount,
		});
	  };
      
      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analyzing chunks in parallel...');
      const chunkResults = await analyzeChunksParallel(
        state.chunks,
        pageMetadata,
        {
          mode: settings.analysisMode,
          config: {
            apiKey: openaiKey,
            openaiKey: openaiKey,
            anthropicKey: anthropicKey,
            googleFactCheckKey: googleFactCheckKey,
            localModelId: settings.localModelId || 'mobilebert-mnli',
          },
          maxConcurrency: 5,
          enabledFeatures,
        },
        onAnalysis
      );
      
      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analysis complete:', {
        chunksAnalyzed: chunkResults.length
      });

      // Convert results to expected format
      if (chunkResults && chunkResults.length > 0) {
        logit('log', '[BetterNet] [PERFORM_ANALYSIS] Processing results, chunks:', chunkResults.length);
        // Aggregate results from all chunks
        const aggregated = {};
        ANALYSIS_FEATURE_IDS.forEach((type) => {
          if (!enabledFeatures.includes(type)) return;
          const scores = [];
          const flags = [];
          
          chunkResults.forEach(chunkResult => {
            const analysis = chunkResult.analyses?.[type];
            if (analysis && !analysis.error) {
              scores.push(analysis.score);
              flags.push(...(analysis.flags || []));
            }
          });
          
          if (scores.length > 0) {
            // Get the first non-error analysis to preserve additional properties (like factChecks)
            const firstAnalysis = chunkResults.find(cr => cr.analyses?.[type] && !cr.analyses[type].error)?.analyses?.[type];
            
            aggregated[type] = {
              score: scores.reduce((a, b) => a + b, 0) / scores.length,
              confidence: 0.8,
              flags: [...new Set(flags)],
              // Preserve fact-check results and other metadata if available
              ...(firstAnalysis?.factChecks && { factChecks: firstAnalysis.factChecks }),
              ...(firstAnalysis?.explanation && { explanation: firstAnalysis.explanation }),
              ...(firstAnalysis?.metadata && { metadata: firstAnalysis.metadata })
            };
            state.stages[type] = 'completed';
            logit('log', '[BetterNet] [PERFORM_ANALYSIS] Aggregated', type, 'score:', aggregated[type].score);
          }
        });

        state.results = aggregated;
        state.progress = 100;
        logit('log', '[BetterNet] [PERFORM_ANALYSIS] Final aggregated results:', aggregated);
      } else {
        // Fallback if no results
        logit('warn', '[BetterNet] [PERFORM_ANALYSIS] No analysis results');
        state.results = {};
        state.progress = 100;
      }

      // Broadcast completion
      this.broadcastUpdate(state.tabId, {
        status: 'analyzing',
        progress: 100,
        currentStage: 'Analysis complete',
        stages: { ...state.stages },
        partialResults: { ...state.results }
      });

      // Generate summary
      const summary = this.generateSummary(state.results);
      state.summaryOverall = summary.overall;
      state.neutralisedCount = chunkResults.filter((cr) =>
        isNeutralisedScore(cr.overallScore)
      ).length;
      
      const chunkByKey = new Map(
        state.chunks.map((c) => [c.id ?? c.fingerprint ?? c.xpath, c])
      );

      this.completeAnalysis(state.tabId, {
        url: state.url,
        analysisId: state.id,
        results: state.results,
        summary: summary,
        chunkResults: chunkResults.map((cr) => {
          const src = chunkByKey.get(cr.chunkId) || {};
          const text = src.text || '';
          return {
            id: cr.chunkId,
            xpath: cr.xpath,
            overallScore: cr.overallScore,
            analyses: cr.analyses,
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
      this.broadcastUpdate(state.tabId, {
        status: 'error',
        error: error.message
      });
    }
  } // ./performAnalysis

  getStageName(stage) {
    const names = {
      contentExtraction: 'Extracting content',
      factChecker: 'Fact checking',
      biasDetector: 'Detecting bias',
      antiManipulation: 'Anti-manipulation scan',
      defuseRagebait: 'Defusing ragebait',
    };
    return names[stage] || stage;
  }

  generateSummary(results) {
    const summary = {
      overall: 'safe',
      score: 0,
      warnings: [],
      recommendations: []
    };

    // Aggregate scores and generate summary
    const scores = Object.values(results).map(r => r.score || 0);
    summary.score = scores.reduce((a, b) => a + b, 0) / scores.length;

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
      results: state.results
    };
  }
} // .end AnalysisManager

setupModelManager();

// Initialize manager with error handling
let analysisManager;
try {
  analysisManager = new AnalysisManager();
  console.log('[BetterNet] AnalysisManager created successfully');
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
  console.log('[BetterNet] Service worker started');
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
