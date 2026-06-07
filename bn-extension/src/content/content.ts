// Content script for BetterNet extension
// Extracts page content and coordinates analysis

// Import chunking (will be bundled by esbuild)
import { extractChunks } from '../chunking/chunking.js';
import { findElementByXPath, waitForContentRender } from '../utils/utils.js';
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

class PageAnalyzer {
  [key: string]: any;

  constructor() {
      this.isAnalyzing = false;
      this.currentUrl = window.location.href;
      this.dismissedChunkXpaths = new Set();
      this.feedbackEnabled = false;
      this.setupListeners();
      void this.loadFeedbackSettings();

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
        // Optionally re-analyze on navigation
        // this.analyzePage();
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

  async loadFeedbackSettings() {
    try {
      const stored = await chrome.storage.sync.get(null);
      this.feedbackEnabled = isFeedbackEnabled(mergeSettings(stored));
    } catch {
      this.feedbackEnabled = false;
    }
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
    if (this.isAnalyzing) {
      console.log('[BetterNet] [CONTENT] Analysis already in progress, skipping');
      return;
    }

    const url = window.location.href;
    console.log('[BetterNet] [CONTENT] Starting page analysis for:', url);

    // Check if site is excluded
    const isExcluded = await this.isSiteExcluded(url);
    if (isExcluded) {
      console.log('[BetterNet] [CONTENT] Site is excluded, skipping analysis');
      // Don't analyze excluded sites
      return;
    }

    this.isAnalyzing = true;

    // Extract page content for metadata
    console.log('[BetterNet] [CONTENT] Extracting page content...');
    const content = this.extractContent();
    console.log('[BetterNet] [CONTENT] Content extracted:', {
      title: content.title,
      textLength: content.text?.length || 0,
      htmlLength: content.html?.length || 0
    });

    // Wait for JavaScript to render content before extracting chunks
    console.log('[BetterNet] [CONTENT] Waiting for page content to render...');
    await waitForContentRender(3000, 200);
    console.log('[BetterNet] [CONTENT] Content render wait complete');

    // Extract chunks in content script (has DOM access)
    console.log('[BetterNet] [CONTENT] Extracting chunks from page...');
    try {
      const hostname = new URL(url).hostname;
      const settings = mergeSettings((await chrome.storage.sync.get(null)) as unknown as Record<string, unknown>);
      const blockPageAds = shouldBlockPageAds(settings, hostname);

      let chunks = await extractChunks(document, url, {
        minTextLength: 100,
        maxChunks: 50,
        includeAds: blockPageAds,
      });
      console.log('[BetterNet] [CONTENT] Extracted', chunks.length, 'chunks');

      // If no chunks found, wait a bit more and retry (for slow-loading pages)
      if (chunks.length === 0) {
        console.log('[BetterNet] [CONTENT] No chunks found, waiting for additional content...');
        await waitForContentRender(2000, 200);
        chunks = await extractChunks(document, url, {
          minTextLength: 100,
          maxChunks: 50,
          includeAds: blockPageAds,
        });
        console.log('[BetterNet] [CONTENT] Retry extracted', chunks.length, 'chunks');
      }

      let adsHidden = 0;
      if (blockPageAds) {
        const { adChunks, contentChunks } = partitionChunks(chunks, url);
        adsHidden = blockAdsFromChunks(adChunks, url);
        chunks = contentChunks;
        console.log(
          '[BetterNet] [CONTENT] Ad blocker:',
          adsHidden,
          'hidden,',
          adChunks.length,
          'ad chunks removed from analysis'
        );
      }

      // Send chunks to background for analysis
      console.log('[BetterNet] [CONTENT] Sending chunks to background for analysis');
      chrome.runtime.sendMessage({
        type: 'ANALYZE_CHUNKS',
        url,
        chunks,
        adsHidden,
        pageMetadata: {
          title: content.title,
          domain: new URL(url).hostname,
          author: content.metadata?.author || '',
          description: content.description || ''
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[BetterNet] [CONTENT] Error sending message:', chrome.runtime.lastError.message);
        } else {
          console.log('[BetterNet] [CONTENT] Chunks sent successfully');
        }
      });
    } catch (error) {
      console.error('[BetterNet] [CONTENT] Error extracting chunks:', error);
      this.isAnalyzing = false;
    }
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
    console.log('[BetterNet] [CONTENT] Received message:', message.type, message.data, sender);

    switch (message.type) {
      case 'BG_LOG':
        // Handle background script logs
        this.handleBackgroundLog(message);
        return false;

      case 'ANALYSIS_UPDATE':
        if (message.data.type === 'analysisUpdate' && message.data.xpath) {
          this.handleChunkAnalysisUpdate(message.data);
        }
        return false;

      case 'ANALYSIS_COMPLETE':
        console.log('[BetterNet] [CONTENT] Handling analysis complete');
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
    // Log background messages to page console
    const { level, message: logMessage, args } = message;
    const logMethod = console[level] || console.log;

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
      console.warn('[BetterNet] [CONTENT] Could not find element for highlight:', xpath);
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
    console.log('[BetterNet] [CONTENT] handleChunkAnalysisUpdate called, xpath:', data.xpath);
    // Handle per-chunk analysis updates
    const { xpath, combinedResults } = data;
    if (!xpath || !combinedResults) {
      console.warn('[BetterNet] [CONTENT] Missing xpath or combinedResults:', { xpath: !!xpath, combinedResults: !!combinedResults });
      return;
    }

    // Find the element by xpath
    console.log('[BetterNet] [CONTENT] Finding element by xpath:', xpath);
    const element = findElementByXPath(xpath);
    if (!element) {
      console.warn('[BetterNet] [CONTENT] Could not find element for xpath:', xpath);
      return;
    }

    if (this.dismissedChunkXpaths.has(xpath)) {
      return;
    }

    console.log('[BetterNet] [CONTENT] Element found, adding badge. Score:', combinedResults.summary?.problemScore);
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
      const problemScore = analysisResults.summary?.problemScore ?? 0;

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
