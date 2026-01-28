/** Background service worker for BetterNet extension
Coordinates page analysis and manages state
*/ 

import { analyzeChunksParallel } from '../analyzers/analysis.js';
import { getGoogleFactCheckKey, getOpenAIKey, getAnthropicKey, initializeChromeStorage } from '../utils/env-utils.js';
import { logit, setTabId } from '../utils/logger.js';

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
          this.startAnalysis(tabId, message.url, message.chunks, message.pageMetadata);
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

  async startAnalysis(tabId, url, chunks, pageMetadata) {
    setTabId(tabId);
    logit('log', '[BetterNet] [ANALYZE_CHUNKS] Starting analysis for tab', tabId, 'URL:', url, 'Chunks:', chunks.length);
    
    // Check if site is excluded
    const isExcluded = await this.isSiteExcluded(url);
    if (isExcluded) {
      logit('log', '[BetterNet] [ANALYZE_CHUNKS] Site is excluded:', url);
      this.broadcastUpdate(tabId, {
        status: 'excluded',
        message: 'This site is excluded from analysis'
      });
      return;
    }

    if (!chunks || chunks.length === 0) {
      logit('warn', '[BetterNet] [ANALYZE_CHUNKS] No chunks provided');
      this.broadcastUpdate(tabId, {
        status: 'no_chunks',
        message: 'No content chunks found'
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
      status: 'analyzing',
      progress: 0,
      stages: {
        contentExtraction: 'completed',
        fakeNews: 'pending',
        scams: 'pending',
        toxicity: 'pending',
        bias: 'pending',
        // aiGenerated: 'pending'
      },
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
      
      // Get analysis settings
      const settings = await chrome.storage.sync.get({
        analysisMode: 'local'
      });
      
      // Get API keys from env-utils (checks env vars, env.js, chrome.storage)
      const googleFactCheckKey = getGoogleFactCheckKey();
      const openaiKey = getOpenAIKey();
      const anthropicKey = getAnthropicKey();
      
      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analysis settings:', {
        mode: settings.analysisMode,
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
		this.broadcastUpdate(state.tabId, {
			type: "analysisUpdate",
			xpath: chunk.xpath,
			combinedResults
		})
	  };
      
      logit('log', '[BetterNet] [PERFORM_ANALYSIS] Analyzing chunks in parallel...');
      const chunkResults = await analyzeChunksParallel(
        state.chunks,
        pageMetadata,
        {
          mode: settings.analysisMode,
          config: {
            openaiKey: openaiKey,
            anthropicKey: anthropicKey,
            googleFactCheckKey: googleFactCheckKey
          },
          maxConcurrency: 5,
          enabledAnalyzers: ['fakeNews', 'bias', 'scams', 'toxicity']
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
        const analysisTypes = ['fakeNews', 'bias', 'scams', 'toxicity'];
        
        analysisTypes.forEach(type => {
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
      
      // Analysis complete
      this.completeAnalysis(state.tabId, {
        url: state.url,
        analysisId: state.id,
        results: state.results,
        summary: summary,
        chunks: state.chunks.map(c => ({
          id: c.id,
          textLength: c.text?.length || 0,
          xpath: c.xpath
        })),
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
      fakeNews: 'Checking for fake news',
      scams: 'Scanning for scams',
      toxicity: 'Analyzing toxicity',
      bias: 'Detecting bias',
    //   aiGenerated: 'Checking for AI-generated content'
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

  broadcastUpdate(tabId, data) {
	setTabId(tabId);
	logit('log', '[BetterNet] [BROADCAST_UPDATE] Tab:', tabId, data);
    
    // Update internal state
    const state = this.activeAnalyses.get(tabId);
    if (state) {
      Object.assign(state, data);
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
