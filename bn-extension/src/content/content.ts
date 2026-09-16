// Content script for BetterNet extension
// Extracts page content and coordinates analysis

// Import chunking (will be bundled by esbuild)
import { extractChunks, looksUnrendered } from '../chunking/chunking.js';
import { createStepRecorder } from '../tracing/trace-steps.js';
import { findElementByXPath, waitForContentRender } from '../utils/utils.js';
import { isDeveloperMode, logit, setDeveloperMode, developerModeFromSettings } from '../utils/logger.js';
import { partitionChunks } from '../ad-blocker/detect-chunk.js';
import {
  initAdBlocker,
  shouldBlockPageAds,
  blockAdsFromChunks,
  showBlockedAds,
  hideBlockedAdsPreview,
  getBlockedAdCount,
  isAdsPreviewActive,
} from '../ad-blocker/run.js';
import { mergeSettings } from '../settings/modules-esm.js';
import { isFeedbackEnabled } from '../feedback/feedback-client.js';
import {
  calculateNutritionData,
  getTrafficLight,
  showContentAnalysisModal,
} from './content-analysis-modal.js';
import { applyClickUnbaitFromAnalysis } from './apply-click-unbait.js';
import { renderChunkOverlays, clearChunkOverlays } from './chunk-overlay.js';
import { planChunks, scheduleDeferredChunks } from './chunk-scheduler.js';
import {
  DEFAULT_NUTRIENT_LABEL_MIN_RISK,
  shouldShowNutrientLabel,
} from '../types/RiskLevel.js';
import { chunkProblemScore } from '../types/ChunkAnalysis.js';
import { classifyPageType } from '../classify/page-type.js';

/**
 * Waiting for `load` is not enough on a single-page app: x.com renders its post tree after
 * the content script runs, so the first pass sees an empty DOM and we chunked nothing at
 * all there. Chunk again on a backoff until content appears (~7.5s worst case).
 */
const CHUNK_RETRY_DELAYS_MS = [0, 500, 1000, 2000, 4000];
/** Same page for labelling purposes: the fragment does not change what is on screen. */
function samePage(a: string, b: string): boolean {
  const strip = (url: string) => {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.href;
    } catch {
      return url;
    }
  };
  return strip(a) === strip(b);
}

/** Long enough for the SPA to swap the view in, short enough not to feel stale. */
const SPA_SETTLE_MS = 800;

async function extractChunksWhenRendered(url, chunkOptions, recorder) {
  let chunks = [];
  for (let attempt = 0; attempt < CHUNK_RETRY_DELAYS_MS.length; attempt++) {
    const delay = CHUNK_RETRY_DELAYS_MS[attempt];
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    chunks = await recorder.step(
      'betternet.chunk_page',
      { 'betternet.chunk.attempt': attempt + 1 },
      (step) => extractChunks(document, url, { ...chunkOptions, recorder: step })
    );
    logit('log',
      '[BetterNet] [CONTENT] Extracted',
      chunks.length,
      'chunks (attempt',
      attempt + 1,
      'of',
      CHUNK_RETRY_DELAYS_MS.length + ')'
    );
    // A count above zero is not the same as a rendered page: x.com's loading screen yields
    // one teaser chunk of site furniture, which used to end the backoff on the first
    // attempt and leave the post itself unchunked and unlabelled.
    if (!looksUnrendered(chunks, url)) break;
    if (chunks.length) {
      logit('log','[BetterNet] [CONTENT] Only page furniture so far, waiting for the app to render');
    }
  }
  return chunks;
}

class PageAnalyzer {
  [key: string]: any;

  constructor() {
      this.isAnalyzing = false;
      this.currentUrl = window.location.href;
      this.dismissedChunkXpaths = new Set();
      this.feedbackEnabled = false;
      this.feedbackOffReason = 'sharing-off';
      this.developerMode = false;
      this.showIndicators = true;
      this.nutrientLabelMinRisk = DEFAULT_NUTRIENT_LABEL_MIN_RISK;
      this.showChunkOverlay = false;
      this.lastChunks = [];
      // Off-screen chunks waiting for a scroll (content/chunk-scheduler.ts).
      this.chunkSchedule = null;
      this.setupListeners();
      void this.loadFeedbackSettings();
      void this.loadLabelSettings();

    // Start analysis when page loads
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  setupListeners() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Only return true when sendResponse will be called async (keeps channel open).
      // Returning true for unhandled messages (e.g. BN_LOCAL_MODEL) blocks other listeners.
      return this.handleMessage(message, sender, sendResponse);
    });


    // Apply label settings changes without needing a page reload
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      // Developer Mode and the sharing toggles change what the modal offers, so pick them
      // up now rather than on the next page load.
      if (changes.developerMode || changes.shareAnonymous || changes.serverEndpoint) {
        void this.loadFeedbackSettings();
      }
      if (!changes.nutrientLabelMinRisk && !changes.showIndicators && !changes.showChunkOverlay) {
        return;
      }
      void this.loadLabelSettings().then(() => {
        this.removeHiddenBadges();
        // Toggling the overlay applies to the page you are looking at, without a reload —
        // the point of it is to answer "what did the chunker just do here?".
        if (this.showChunkOverlay) renderChunkOverlays(this.lastChunks || []);
        else clearChunkOverlays();
      });
    });

    // Listen for navigation changes (SPA support)
    this.observeNavigation();
  }


  observeNavigation() {
    // Watch for URL changes in SPAs
    let lastUrl = this.currentUrl;
    const checkUrl = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        this.currentUrl = lastUrl;
        // On x.com, Facebook and Reddit most page views are this, not a load — clicking a
        // post from the timeline used to leave the new page unanalysed and unlabelled,
        // which is exactly the path a demo takes.
        this.scheduleReanalysis();
      }
    };
    setInterval(checkUrl, 1000);

    // Also watch for pushState/replaceState
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      originalPushState.apply(history, arguments);
      setTimeout(checkUrl, 100);
    };

    history.replaceState = function () {
      originalReplaceState.apply(history, arguments);
      setTimeout(checkUrl, 100);
    };
  }

  /**
   * The route changes before the new view renders, and a single navigation can fire
   * pushState more than once, so settle first and collapse repeats. Labels from the
   * previous page are dropped: their xpaths point into a DOM that has been replaced.
   */
  scheduleReanalysis() {
    clearTimeout(this.reanalysisTimer);
    this.reanalysisTimer = setTimeout(() => {
      const url = window.location.href;
      if (url === this.analysedUrl) return;
      logit('log', '[BetterNet] [CONTENT] SPA navigation, re-analysing:', url);
      document.querySelectorAll('.betternet-chunk-badge').forEach((badge) => badge.remove());
      clearChunkOverlays();
      this.stopChunkSchedule();
      this.dismissedChunkXpaths.clear();
      this.analyzePage();
    }, SPA_SETTLE_MS);
  }

  /** What the Content Analysis modal may offer: feedback, and the trace link with it. */
  async loadFeedbackSettings() {
    try {
      const settings = mergeSettings(await chrome.storage.sync.get(null));
      this.feedbackEnabled = isFeedbackEnabled(settings);
      // Which of the two switches is off, so the modal can say so rather than just
      // rendering nothing where the controls should be.
      this.feedbackOffReason = settings.shareAnonymous ? 'no-endpoint' : 'sharing-off';
      this.developerMode = developerModeFromSettings(settings);
      this.aiqaServerUrl = settings.aiqaServerUrl;
      this.aiqaOrganisationId = settings.aiqaOrganisationId;
    } catch {
      this.feedbackEnabled = false;
      this.feedbackOffReason = 'sharing-off';
      this.developerMode = false;
    }
  }

  /** Which chunks get a Nutrient Label. Re-read on change so it applies without a reload. */
  async loadLabelSettings() {
    try {
      const settings = mergeSettings(await chrome.storage.sync.get(null));
      this.showIndicators = settings.showIndicators !== false;
      this.nutrientLabelMinRisk = settings.nutrientLabelMinRisk;
      this.showChunkOverlay = !!settings.showChunkOverlay;
      setDeveloperMode(developerModeFromSettings(settings));
      logit('log',
        '[BetterNet] [CONTENT] Nutrient Labels:',
        this.showIndicators ? `from ${this.nutrientLabelMinRisk} upwards` : 'off'
      );
    } catch (error) {
      logit('warn','[BetterNet] [CONTENT] Could not read label settings:', error);
    }
  }

  /**
   * Does this chunk clear the user's Nutrient Label risk threshold? The threshold is a
   * [0,1] band edge and `summary.problemScore` is a ProblemScore enum, so it has to be
   * converted — comparing the two directly makes `'high' >= 0.4` false and hides every
   * label. chunkProblemScore() does the conversion (types/ChunkAnalysis.ts).
   */
  shouldLabelChunk(analysisResults) {
    if (!this.showIndicators) return false;
    return shouldShowNutrientLabel(chunkProblemScore(analysisResults ?? {}), this.nutrientLabelMinRisk);
  }

  /** Drop labels that no longer clear the threshold after a settings change. */
  removeHiddenBadges() {
    document.querySelectorAll('.betternet-chunk-badge').forEach((badge) => {
      const score = Number(badge.dataset.problemScore ?? 0);
      if (!this.showIndicators || !shouldShowNutrientLabel(score, this.nutrientLabelMinRisk)) {
        badge.remove();
      }
    });
  }

  async init() {
    this.injectHighlightStyles();
    this.injectAdPreviewStyles();
    this.stopAdBlocker = await initAdBlocker();
    this.analyzePage();
  }

  injectAdPreviewStyles() {
    if (document.getElementById('betternet-ad-preview-styles')) return;
    const style = document.createElement('style');
    style.id = 'betternet-ad-preview-styles';
    style.textContent = `
        .bn-ad-block-preview {
          outline: 2px dashed #ff9800 !important;
          outline-offset: 2px;
          position: relative;
        }
        .bn-ad-block-preview::before {
          content: 'Hidden ad (preview)';
          position: absolute;
          top: 4px;
          left: 4px;
          z-index: 2147483646;
          font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #e65100;
          background: #fff3e0;
          border: 1px solid #ffb74d;
          border-radius: 4px;
          padding: 2px 6px;
          pointer-events: none;
        }
      `;
    document.head.appendChild(style);
  }

  injectHighlightStyles() {
    if (document.getElementById('betternet-highlight-styles')) return;
    const style = document.createElement('style');
    style.id = 'betternet-highlight-styles';
    style.textContent = `
        .betternet-chunk-highlight {
          outline: 3px solid #667eea !important;
          outline-offset: 2px;
          box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.25);
          scroll-margin: 80px;
        }
      `;
    document.head.appendChild(style);
  }

  async analyzePage() {
    const url = window.location.href;
    // Only a repeat of the *same* page is a no-op. A navigation must supersede whatever is
    // still running: an analysis can take minutes, and dropping the new page because the
    // old one had not finished left the page the user is actually looking at unanalysed.
    if (this.isAnalyzing && url === this.analysedUrl) {
      logit('log','[BetterNet] [CONTENT] Analysis already in progress for this page, skipping');
      return;
    }
    if (this.isAnalyzing) {
      logit('log','[BetterNet] [CONTENT] Superseding the analysis of', this.analysedUrl);
    }

    logit('log','[BetterNet] [CONTENT] Starting page analysis for:', url);

    // Check if site is excluded
    const isExcluded = await this.isSiteExcluded(url);
    if (isExcluded) {
      logit('log','[BetterNet] [CONTENT] Site is excluded, skipping analysis');
      // Don't analyze excluded sites
      return;
    }

    this.isAnalyzing = true;
    // What the last analysis was for, so a repeated pushState to the same route is a no-op.
    this.analysedUrl = url;

    // Extract page content for metadata
    logit('log','[BetterNet] [CONTENT] Extracting page content...');
    const content = this.extractContent();
    logit('log','[BetterNet] [CONTENT] Content extracted:', {
      title: content.title,
      textLength: content.text?.length || 0,
      htmlLength: content.html?.length || 0
    });

    // Wait for JavaScript to render content before extracting chunks
    logit('log','[BetterNet] [CONTENT] Waiting for page content to render...');
    await waitForContentRender(3000, 200);
    logit('log','[BetterNet] [CONTENT] Content render wait complete');

    // Extract chunks in content script (has DOM access)
    logit('log','[BetterNet] [CONTENT] Extracting chunks from page...');
    try {
      const hostname = new URL(url).hostname;
      const settings = mergeSettings((await chrome.storage.sync.get(null)) as unknown as Record<string, unknown>);
      setDeveloperMode(developerModeFromSettings(settings));
      const blockPageAds = shouldBlockPageAds(settings, hostname);

      // Chunking is timed here and sent to the background, which owns the AIQA
      // exporter and the API key (tracing/trace-steps.ts). Steps are dropped there if
      // tracing turns out to be off, so this only needs the toggle.
      const { recorder, steps } = createStepRecorder(!!settings.aiqaTracing);
      const chunkOptions = {
        minTextLength: 100,
        maxChunks: 50,
        includeAds: blockPageAds,
      };

      let chunks = await extractChunksWhenRendered(url, chunkOptions, recorder);

      let adsHidden = 0;
      if (blockPageAds) {
        const { adChunks, contentChunks } = partitionChunks(chunks, url);
        adsHidden = blockAdsFromChunks(adChunks, url);
        chunks = contentChunks;
        logit('log',
          '[BetterNet] [CONTENT] Ad blocker:',
          adsHidden,
          'hidden,',
          adChunks.length,
          'ad chunks removed from analysis'
        );
      }

      // Analyse what the reader can see first, biggest and highest up the page first, and
      // hold the rest back until it scrolls into view (content/chunk-scheduler.ts).
      this.stopChunkSchedule();
      const plan = planChunks(chunks, { gate: settings.analyzeOnScreenFirst !== false });
      this.lastChunks = plan.ordered;

      // Debug aid: the chunks exactly as sent, in the order they were sent, so the boxes
      // match the console and the popup. Read from the settings loaded above, not the
      // field: the constructor's load may not have resolved before the first analysis.
      this.showChunkOverlay = !!settings.showChunkOverlay;
      if (this.showChunkOverlay) renderChunkOverlays(plan.ordered);
      this.pageMetadata = {
        title: content.title,
        domain: new URL(url).hostname,
        author: content.metadata?.author || '',
        description: content.description || '',
        // Classify before analyzing (specs/content-classification.md): the engine routes
        // features by page type, and refuses content analysis on login / checkout pages.
        pageType: classifyPageType(document, url),
      };
      logit('log',
        '[BetterNet] [CONTENT] Sending', plan.analyseNow, 'of', plan.ordered.length,
        'chunks to background for analysis'
      );

      // Observe the deferred chunks before sending: the background may answer that it is
      // analysing everything anyway (a demo page), and then the observer is torn down again.
      if (plan.deferred.length) {
        this.chunkSchedule = scheduleDeferredChunks(plan.deferred, (released) =>
          this.sendMoreChunks(url, released)
        );
      }

      chrome.runtime.sendMessage({
        type: 'ANALYZE_CHUNKS',
        url,
        chunks: plan.ordered,
        analyseNow: plan.analyseNow,
        chunksWaiting: plan.deferred.length,
        adsHidden,
        traceSteps: steps,
        pageMetadata: this.pageMetadata,
      }, (response) => {
        if (chrome.runtime.lastError) {
          logit('error','[BetterNet] [CONTENT] Error sending message:', chrome.runtime.lastError.message);
        } else if ((response as any)?.releaseAll) {
          // The background queued the whole page regardless, so gating would only make the
          // Popup report chunks as waiting when they are already being analysed.
          logit('log','[BetterNet] [CONTENT] Background is analysing every chunk; dropping viewport gating');
          this.stopChunkSchedule();
        } else {
          logit('log','[BetterNet] [CONTENT] Chunks sent successfully');
        }
      });
    } catch (error) {
      logit('error','[BetterNet] [CONTENT] Error extracting chunks:', error);
      this.isAnalyzing = false;
    }
  }

  /**
   * Hand over chunks that have scrolled into view. Ignored once the page has moved on:
   * the analysis for the new URL owns the labels from then on.
   */
  sendMoreChunks(url, released) {
    if (!released?.length || url !== this.analysedUrl) return;
    logit('log','[BetterNet] [CONTENT] Releasing', released.length, 'chunk(s) scrolled into view');
    chrome.runtime.sendMessage({
      type: 'ANALYZE_MORE_CHUNKS',
      url,
      chunks: released,
      chunksWaiting: this.chunkSchedule?.pending() ?? 0,
      pageMetadata: this.pageMetadata,
    }, () => {
      if (chrome.runtime.lastError) {
        logit('warn','[BetterNet] [CONTENT] Could not send scrolled-in chunks:', chrome.runtime.lastError.message);
      }
    });
  }

  /**
   * A page-type correction made in the Content Analysis modal. Routing reads the page type
   * (features/module-routing.ts), so a correction applies to the chunks analysed after it —
   * released by scrolling, or by the next pass. Chunks already analysed are not re-run.
   */
  setPageType(value) {
    if (!value || !this.pageMetadata) return;
    this.pageMetadata.pageType = { value, confidence: 1, source: 'user' };
    logit('log', '[BetterNet] [CONTENT] Page type corrected to', value);
  }

  stopChunkSchedule() {
    this.chunkSchedule?.stop();
    this.chunkSchedule = null;
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

  extractContent() {
    // Extract relevant content from the page
    const content = {
      url: window.location.href,
      title: document.title,
      description: this.getMetaContent('description'),
      text: this.extractText(),
      html: document.documentElement.outerHTML, // Include full HTML for chunking
      images: this.extractImages(),
      links: this.extractLinks(),
      metadata: {
        author: this.getMetaContent('author'),
        publishedTime: this.getMetaContent('article:published_time'),
        modifiedTime: this.getMetaContent('article:modified_time'),
        siteName: this.getMetaContent('og:site_name'),
        domain: window.location.hostname
      }
    };

    return content;
  }

  extractText() {
    // Extract main text content, excluding navigation, ads, etc.
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post',
      '.article'
    ];

    let mainContent = null;
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        mainContent = element;
        break;
      }
    }

    if (!mainContent) {
      mainContent = document.body;
    }

    // Remove script and style elements
    const clone = mainContent.cloneNode(true);
    const scripts = clone.querySelectorAll('script, style, noscript, iframe');
    scripts.forEach(el => el.remove());

    // Get text content
    return clone.textContent.trim();
  }

  extractImages() {
    const images = Array.from(document.querySelectorAll('img'))
      .filter(img => img.src && !img.src.startsWith('data:'))
      .map(img => ({
        src: img.src,
        alt: img.alt || '',
        title: img.title || ''
      }))
      .slice(0, 10); // Limit to first 10 images

    return images;
  }

  extractLinks() {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(link => link.href && link.href.startsWith('http'))
      .map(link => ({
        url: link.href,
        text: link.textContent.trim().substring(0, 100),
        isExternal: !link.href.startsWith(window.location.origin)
      }))
      .slice(0, 20); // Limit to first 20 links

    return links;
  }

  getMetaContent(property) {
    const meta = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
    return meta ? (meta as HTMLMetaElement).content : '';
  }

  handleMessage(message, sender, sendResponse) {
    logit('log','[BetterNet] [CONTENT] Received message:', message.type, message.data, sender);

    switch (message.type) {
      case 'BG_LOG':
        // Handle background script logs
        this.handleBackgroundLog(message);
        return false;

      case 'ANALYSIS_UPDATE':
        if (message.data.type === 'analysisUpdate') {
          // No xpath means the verdict belongs to no element on this page — a canned demo
          // chunk standing in for a page we could not chunk. Nothing to label, but say so:
          // dropping it silently here is what made a missing Nutrient Label undiagnosable.
          if (!message.data.xpath) {
            logit('warn','[BetterNet] [CONTENT] Analysis result has no xpath, nothing to label');
          } else {
            this.handleChunkAnalysisUpdate(message.data);
          }
        }
        return false;

      case 'ANALYSIS_COMPLETE':
        logit('log','[BetterNet] [CONTENT] Handling analysis complete');
        this.handleAnalysisComplete(message.result);
        return false;

      case 'EXCLUSION_CHANGED':
        // Re-check if site is excluded and update accordingly
        this.checkExclusionStatus();
        return false;

      case 'TRIGGER_ANALYSIS':
        this.analyzePage();
        return false;

      case 'HIGHLIGHT_CHUNK':
        this.highlightChunk(message.xpath);
        return false;

      case 'SHOW_BLOCKED_ADS':
        sendResponse({ count: showBlockedAds(), adsPreviewActive: true });
        return false;

      case 'HIDE_BLOCKED_ADS_PREVIEW':
        sendResponse({ count: hideBlockedAdsPreview(), adsPreviewActive: false });
        return false;

      case 'GET_AD_BLOCK_STATUS':
        this.getAdBlockStatus(sendResponse);
        return true;

      default:
        return false;
    }
  }

  handleBackgroundLog(message) {
    if (!isDeveloperMode()) return;
    const { level, message: logMessage, args } = message;
    const logMethod = typeof console[level] === 'function' ? console[level] : console['log'];

    // Format the message nicely
    if (args && args.length > 0) {
      logMethod(`[BG] ${logMessage}`, ...args);
    } else {
      logMethod(`[BG] ${logMessage}`);
    }
  }

  async getAdBlockStatus(sendResponse) {
    try {
      const hostname = window.location.hostname;
      const settings = mergeSettings((await chrome.storage.sync.get(null)) as unknown as Record<string, unknown>);
      const enabled = shouldBlockPageAds(settings, hostname);
      sendResponse({
        enabled,
        blockedCount: getBlockedAdCount(),
        adsPreviewActive: isAdsPreviewActive(),
      });
    } catch {
      sendResponse({ enabled: false, blockedCount: 0, adsPreviewActive: false });
    }
  }

  async checkExclusionStatus() {
    const url = window.location.href;
    const isExcluded = await this.isSiteExcluded(url);

    if (isExcluded) {
      this.isAnalyzing = false;
    } else {
      // If not excluded and not analyzing, start analysis
      if (!this.isAnalyzing) {
        this.analyzePage();
      }
    }
  }

  handleAnalysisComplete(result) {
    this.isAnalyzing = false;
  }

  highlightChunk(xpath) {
    this.clearChunkHighlight();
    if (!xpath) return;
    const element = findElementByXPath(xpath) as Element | null;
    if (!element) {
      logit('warn','[BetterNet] [CONTENT] Could not find element for highlight:', xpath);
      return;
    }
    element.classList.add('betternet-chunk-highlight');
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.highlightedChunkElement = element;
  }

  clearChunkHighlight() {
    if (this.highlightedChunkElement) {
      this.highlightedChunkElement.classList.remove('betternet-chunk-highlight');
      this.highlightedChunkElement = null;
    }
    document.querySelectorAll('.betternet-chunk-highlight').forEach((el) => {
      el.classList.remove('betternet-chunk-highlight');
    });
  }

  handleChunkAnalysisUpdate(data) {
    logit('log','[BetterNet] [CONTENT] handleChunkAnalysisUpdate called, xpath:', data.xpath);
    // Handle per-chunk analysis updates
    const { xpath, combinedResults } = data;
    if (!xpath || !combinedResults) {
      logit('warn','[BetterNet] [CONTENT] Missing xpath or combinedResults:', { xpath: !!xpath, combinedResults: !!combinedResults });
      return;
    }

    // Results for the previous route arrive after the SPA has swapped the DOM. Their
    // xpaths resolve against markup that is no longer there, so they label the wrong thing.
    const resultUrl = combinedResults.url;
    if (resultUrl && !samePage(resultUrl, window.location.href)) {
      logit('log','[BetterNet] [CONTENT] Ignoring analysis for a page we have left:', resultUrl);
      return;
    }

    // Find the element by xpath
    logit('log','[BetterNet] [CONTENT] Finding element by xpath:', xpath);
    const element = findElementByXPath(xpath);
    if (!element) {
      logit('warn','[BetterNet] [CONTENT] Could not find element for xpath:', xpath);
      return;
    }

    if (this.dismissedChunkXpaths.has(xpath)) {
      return;
    }

    applyClickUnbaitFromAnalysis(element, combinedResults);

    const score = chunkProblemScore(combinedResults ?? {});
    if (!this.shouldLabelChunk(combinedResults)) {
      logit('log',
        `[BetterNet] [CONTENT] No label for chunk (score ${score}, threshold ${this.nutrientLabelMinRisk})`
      );
      return;
    }

    logit('log','[BetterNet] [CONTENT] Element found, adding badge. Score:', score);
    this.addBadgeToChunk(element, combinedResults, xpath);
  }

  addBadgeToChunk(element, analysisResults, xpath) {
      if (xpath && this.dismissedChunkXpaths.has(xpath)) {
        return;
      }
    // Remove existing badge if present
    const existingBadge = element.querySelector('.betternet-chunk-badge');
    if (existingBadge) {
      existingBadge.remove();
    }

    const badge = this.createNutritionBadge(analysisResults, xpath);

    // Position badge relative to the chunk element
    // Try to find a good position (top-right corner)
    const position = this.calculateBadgePosition(element);

    badge.style.position = 'absolute';
    badge.style.top = `${position.top}px`;
    badge.style.right = `${position.right}px`;
    badge.style.zIndex = '999998';

    // Make sure parent element has relative positioning
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.position === 'static') {
      element.style.position = 'relative';
    }

    element.appendChild(badge);
  }

  calculateBadgePosition(element) {
    // Try to position badge in top-right corner of visible area
    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    // Position relative to element's top-right
    return {
      top: 5,
      right: 5
    };
  }

  createNutritionBadge(analysisResults, xpath) {
    const badge = document.createElement('div');
      badge.className = 'betternet-chunk-badge';
      
      const { analyses = [] } = analysisResults;
      // The fraction, not the enum: removeHiddenBadges() reads this back with Number().
      const problemScore = chunkProblemScore(analysisResults ?? {});
      badge.dataset.problemScore = String(problemScore);

      const trafficLight = getTrafficLight(problemScore);
      const nutritionData = calculateNutritionData(analyses);
      
      badge.innerHTML = `
        <div class="betternet-badge-content" style="
          display: flex;
          align-items: center;
          gap: 6px;
          background: white;
          border: 2px solid ${trafficLight.border};
          border-radius: 6px;
          padding: 4px 4px 4px 8px;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 12px;
          transition: all 0.2s ease;
        ">
          <div class="betternet-traffic-light" style="
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: ${trafficLight.color};
            flex-shrink: 0;
          "></div>
          <div class="betternet-badge-text" style="
            font-weight: 600;
            color: #333;
          ">${nutritionData.label}</div>
          <button type="button" class="betternet-badge-dismiss" aria-label="Dismiss label" title="Dismiss" style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            margin: 0;
            padding: 0;
            border: none;
            border-radius: 4px;
            background: transparent;
            color: #888;
            font-size: 14px;
            line-height: 1;
            cursor: pointer;
            flex-shrink: 0;
          ">×</button>
        </div>
      `;

      const badgeContent = badge.querySelector('.betternet-badge-content');
      const dismissBtn = badge.querySelector('.betternet-badge-dismiss');

      badgeContent.addEventListener('mouseenter', (e) => {
        e.currentTarget.style.transform = 'scale(1.05)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
      });
      
      badgeContent.addEventListener('mouseleave', (e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      });

      dismissBtn.addEventListener('mouseenter', () => {
        dismissBtn.style.color = '#333';
        dismissBtn.style.background = '#f0f0f0';
      });
      dismissBtn.addEventListener('mouseleave', () => {
        dismissBtn.style.color = '#888';
        dismissBtn.style.background = 'transparent';
      });
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (xpath) {
          this.dismissedChunkXpaths.add(xpath);
        }
        badge.remove();
      });

    badgeContent.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('.betternet-badge-dismiss')) return;
      e.stopPropagation();
      showContentAnalysisModal({
        ...analysisResults,
        feedbackEnabled: this.feedbackEnabled,
        feedbackOffReason: this.feedbackOffReason,
        developerMode: this.developerMode,
        aiqaServerUrl: this.aiqaServerUrl,
        aiqaOrganisationId: this.aiqaOrganisationId,
        // Chunker feedback is about the page: how many chunks it was split into.
        chunkCount: this.lastChunks?.length,
        pageUrl: window.location.href,
        // The page-type tag, shown and correctable under "This page".
        pageType: this.pageMetadata?.pageType,
        onPageTypeEdit: (value) => this.setPageType(value),
      });
    });

    return badge;
  }
}

// Initialize page analyzer
if (document.body) {
  new PageAnalyzer();
} else {
  window.addEventListener('load', () => new PageAnalyzer());
}
