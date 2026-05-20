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

class PageAnalyzer {
    constructor() {
      this.isAnalyzing = false;
      this.currentUrl = window.location.href;
      this.setupListeners();
      
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

      history.pushState = function() {
        originalPushState.apply(history, arguments);
        setTimeout(checkUrl, 100);
      };

      history.replaceState = function() {
        originalReplaceState.apply(history, arguments);
        setTimeout(checkUrl, 100);
      };
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
        const settings = mergeSettings(await chrome.storage.sync.get(null));
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
      return meta ? meta.content : '';
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
        const settings = mergeSettings(await chrome.storage.sync.get(null));
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
      const element = findElementByXPath(xpath);
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

      console.log('[BetterNet] [CONTENT] Element found, adding badge. Score:', combinedResults.overallScore);
      // Add or update badge on the chunk
      this.addBadgeToChunk(element, combinedResults);
    }


    addBadgeToChunk(element, analysisResults) {
      // Remove existing badge if present
      const existingBadge = element.querySelector('.betternet-chunk-badge');
      if (existingBadge) {
        existingBadge.remove();
      }

      // Create badge
      const badge = this.createNutritionBadge(analysisResults);
      
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

    createNutritionBadge(analysisResults) {
      const badge = document.createElement('div');
      badge.className = 'betternet-chunk-badge';
      
      const { overallScore, summary, analyses } = analysisResults;
      
      // Determine traffic light color
      const trafficLight = this.getTrafficLight(overallScore);
      
      // Create nutrition label
      const nutritionData = this.calculateNutritionData(analyses);
      
      badge.innerHTML = `
        <div class="betternet-badge-content" style="
          display: flex;
          align-items: center;
          gap: 6px;
          background: white;
          border: 2px solid ${trafficLight.border};
          border-radius: 6px;
          padding: 4px 8px;
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
        </div>
      `;

      // Add hover effect
      badge.querySelector('.betternet-badge-content').addEventListener('mouseenter', (e) => {
        e.currentTarget.style.transform = 'scale(1.05)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
      });
      
      badge.querySelector('.betternet-badge-content').addEventListener('mouseleave', (e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      });

      // Add click handler to show details
      badge.querySelector('.betternet-badge-content').addEventListener('click', (e) => {
        e.stopPropagation();
        this.showChunkDetails(analysisResults, badge);
      });

      return badge;
    }

    getTrafficLight(score) {
      if (score >= 0.7) {
        return { color: '#f44336', border: '#d32f2f', label: 'High Risk' };
      } else if (score >= 0.4) {
        return { color: '#ff9800', border: '#f57c00', label: 'Caution' };
      } else {
        return { color: '#4CAF50', border: '#388e3c', label: 'Safe' };
      }
    }

    calculateNutritionData(analyses) {
      const scores = [];
      const flags = [];
      
      Object.entries(analyses).forEach(([type, result]) => {
        if (result && !result.error && typeof result.score === 'number') {
          scores.push({ type, score: result.score });
          if (result.flags && result.flags.length > 0) {
            flags.push(...result.flags);
          }
        }
      });

      if (scores.length === 0) {
        return { label: 'No Data', score: 0 };
      }

      // Calculate overall
      const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
      
      // Find highest risk type
      const highestRisk = scores.reduce((max, s) => s.score > max.score ? s : max, scores[0]);
      
      let label = 'Safe';
      if (avgScore >= 0.7) {
        label = 'High Risk';
      } else if (avgScore >= 0.4) {
        label = 'Caution';
      }

      return {
        label,
        score: avgScore,
        scores,
        flags: [...new Set(flags)],
        highestRisk
      };
    }

    renderFactCheckClaims(factChecks) {
      if (!factChecks || factChecks.length === 0) {
        return '';
      }

      let html = `
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e0e0e0;">
          <div style="font-weight: 600; font-size: 13px; color: #333; margin-bottom: 12px;">Fact-Checked Claims:</div>
      `;

      factChecks.forEach((claimResult, index) => {
        const claimText = claimResult.claim || `Claim ${index + 1}`;
        const hasReviews = claimResult.factChecks && claimResult.factChecks.length > 0;

        html += `
          <div style="
            margin-bottom: 12px;
            padding: 10px;
            background: #f9f9f9;
            border-radius: 6px;
            border-left: 3px solid #2196f3;
          ">
            <div style="font-size: 12px; font-weight: 600; color: #333; margin-bottom: 8px;">
              ${this.truncateText(claimText, 150)}
            </div>
        `;

        if (hasReviews) {
          claimResult.factChecks.forEach(factCheck => {
            const review = factCheck.claimReview?.[0];
            if (review) {
              const rating = review.textualRating || 'Unknown';
              const ratingColor = this.getRatingColor(rating);
              
              html += `
                <div style="
                  margin-top: 8px;
                  padding: 8px;
                  background: white;
                  border-radius: 4px;
                  border: 1px solid #e0e0e0;
                ">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                    <span style="
                      font-size: 11px;
                      padding: 3px 8px;
                      border-radius: 12px;
                      font-weight: 600;
                      background: ${ratingColor.bg};
                      color: ${ratingColor.text};
                      text-transform: capitalize;
                    ">${rating}</span>
                    <span style="font-size: 11px; color: #666;">${review.publisher || 'Unknown Publisher'}</span>
                  </div>
                  ${review.title ? `
                    <div style="font-size: 11px; color: #333; margin-bottom: 4px;">
                      ${this.truncateText(review.title, 120)}
                    </div>
                  ` : ''}
                  ${review.url ? `
                    <a href="${review.url}" target="_blank" style="
                      font-size: 11px;
                      color: #2196f3;
                      text-decoration: none;
                    ">View fact-check →</a>
                  ` : ''}
                </div>
              `;
            }
          });
        } else {
          html += `
            <div style="font-size: 11px; color: #999; font-style: italic; margin-top: 4px;">
              No fact-checks found for this claim
            </div>
          `;
        }

        html += `</div>`;
      });

      html += `</div>`;
      return html;
    }

    getRatingColor(rating) {
      const ratingLower = (rating || '').toLowerCase();
      if (ratingLower.includes('false') || ratingLower.includes('pants on fire')) {
        return { bg: '#ffebee', text: '#c62828' };
      } else if (ratingLower.includes('true')) {
        return { bg: '#e8f5e9', text: '#2e7d32' };
      } else if (ratingLower.includes('mixture') || ratingLower.includes('half')) {
        return { bg: '#fff3e0', text: '#f57c00' };
      }
      return { bg: '#f5f5f5', text: '#666' };
    }

    truncateText(text, maxLength) {
      if (!text || text.length <= maxLength) return text;
      return text.substring(0, maxLength) + '...';
    }

    showChunkDetails(analysisResults, badgeElement) {
      // Remove existing modal if present
      const existingModal = document.getElementById('betternet-detail-modal');
      if (existingModal) {
        existingModal.remove();
      }

      const { overallScore, summary, analyses } = analysisResults;
      const nutritionData = this.calculateNutritionData(analyses);
      const trafficLight = this.getTrafficLight(overallScore);

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'betternet-detail-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;

      const modalContent = document.createElement('div');
      modalContent.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 24px;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        position: relative;
      `;

      // Analysis type labels
      const analysisLabels = {
        factChecker: 'Fact Checker',
        biasDetector: 'Bias Detector',
        antiManipulation: 'Anti-manipulation',
        defuseRagebait: 'Defuse Ragebait',
      };

      // Build details HTML
      let detailsHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #333;">Content Analysis</h2>
          <button id="betternet-close-modal" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
          ">×</button>
        </div>

        <div style="margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <div style="
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${trafficLight.color};
              flex-shrink: 0;
            "></div>
            <div>
              <div style="font-weight: 600; color: #333; font-size: 16px;">Overall: ${nutritionData.label}</div>
              <div style="font-size: 14px; color: #666;">Score: ${(overallScore * 100).toFixed(0)}%</div>
            </div>
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #333;">Analysis Breakdown</h3>
          <div style="display: flex; flex-direction: column; gap: 12px;">
      `;

      Object.entries(analyses).forEach(([type, result]) => {
        if (result && !result.error) {
          const typeLabel = analysisLabels[type] || type;
          const score = result.score || 0;
          const scorePercent = (score * 100).toFixed(0);
          const barColor = score >= 0.7 ? '#f44336' : score >= 0.4 ? '#ff9800' : '#4CAF50';
          
          // Fact Checker may include claim-level fact-check results
          const hasFactChecks = type === 'factChecker' && result.factChecks && result.factChecks.length > 0;
          const factCheckHTML = hasFactChecks ? this.renderFactCheckClaims(result.factChecks) : '';
          
          detailsHTML += `
            <div style="
              border: 1px solid #e0e0e0;
              border-radius: 8px;
              padding: 12px;
            ">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 600; color: #333;">${typeLabel}</span>
                <span style="font-size: 14px; color: #666;">${scorePercent}%</span>
              </div>
              <div style="
                width: 100%;
                height: 8px;
                background: #f0f0f0;
                border-radius: 4px;
                overflow: hidden;
              ">
                <div style="
                  width: ${scorePercent}%;
                  height: 100%;
                  background: ${barColor};
                  transition: width 0.3s ease;
                "></div>
              </div>
              ${result.explanation ? `
                <div style="font-size: 12px; color: #666; margin-top: 8px;">
                  ${result.explanation}
                </div>
              ` : ''}
              ${result.flags && result.flags.length > 0 ? `
                <div style="margin-top: 8px;">
                  ${result.flags.map(flag => `
                    <span style="
                      display: inline-block;
                      background: #f5f5f5;
                      padding: 2px 8px;
                      border-radius: 4px;
                      font-size: 11px;
                      color: #666;
                      margin-right: 4px;
                      margin-top: 4px;
                    ">${flag}</span>
                  `).join('')}
                </div>
              ` : ''}
              ${factCheckHTML}
            </div>
          `;
        }
      });

      detailsHTML += `
          </div>
        </div>
      `;

      if (summary && summary.recommendations && summary.recommendations.length > 0) {
        detailsHTML += `
          <div>
            <h3 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600; color: #333;">Recommendations</h3>
            <ul style="margin: 0; padding-left: 20px; color: #666; font-size: 14px;">
              ${summary.recommendations.map(rec => `<li style="margin-bottom: 8px;">${rec}</li>`).join('')}
            </ul>
          </div>
        `;
      }

      modalContent.innerHTML = detailsHTML;
      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      // Close button handler
      document.getElementById('betternet-close-modal').addEventListener('click', () => {
        modal.remove();
      });

      // Close on background click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });

      // Close on Escape key
      const escapeHandler = (e) => {
        if (e.key === 'Escape') {
          modal.remove();
          document.removeEventListener('keydown', escapeHandler);
        }
      };
      document.addEventListener('keydown', escapeHandler);
    }

  }

// Initialize page analyzer
if (document.body) {
  new PageAnalyzer();
} else {
  window.addEventListener('load', () => new PageAnalyzer());
}
