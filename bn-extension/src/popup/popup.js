// Popup script for BetterNet extension

const FEATURE_DISPLAY = {
  factChecker: { name: 'Fact Checker', description: 'Claims checked against fact-check sources' },
  biasDetector: { name: 'Bias Detector', description: 'Political or ideological bias' },
  antiManipulation: { name: 'Anti-manipulation', description: 'Dark patterns and manipulative UX' },
  defuseRagebait: { name: 'Defuse Ragebait', description: 'Outrage-bait and harmful language' },
};

function runtimeSendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response ?? null);
    });
  });
}

class PopupController {
  constructor() {
    this.currentTabId = null;
    this.currentUrl = null;
    this.updateInterval = null;
    this.adPreviewActive = false;
    this.init();
  }

  async init() {
    // Get current active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      this.showNoTab();
      return;
    }

    this.currentTabId = tabs[0].id;
    const url = tabs[0].url;
    this.currentUrl = url;

    // Check if URL is valid (not chrome://, etc.)
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      this.showMessage('This page cannot be analyzed.');
      return;
    }

    // Display URL
    document.getElementById('current-url').textContent = this.truncateUrl(url);

    // Set up settings button
    document.getElementById('settings-btn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Set up retry button
    document.getElementById('retry-btn')?.addEventListener('click', () => {
      this.retryAnalysis();
    });

    // Set up exclude toggle button
    document.getElementById('exclude-toggle-btn').addEventListener('click', () => {
      this.toggleSiteExclusion();
    });

    document.getElementById('chunks-toggle')?.addEventListener('click', () => {
      this.toggleChunksList();
    });

    // Check and update exclusion status
    await this.updateExclusionStatus();

    // Load current analysis status
    await this.loadAnalysisStatus();

    // Set up real-time updates
    this.setupUpdates();

    // Request analysis if not already started
    this.ensureAnalysisStarted();
  }

  async loadAnalysisStatus() {
    // Check storage for cached analysis
    const storageKey = `analysis_${this.currentTabId}`;
    const data = await chrome.storage.local.get(storageKey);
    
    if (data[storageKey]) {
      this.updateUI(data[storageKey]);
    } else {
      // Request status from background
      chrome.runtime.sendMessage({
        type: 'GET_ANALYSIS_STATUS'
      }, (response) => {
        if (response && response.status) {
          this.updateUI({
            status: response.status.status,
            progress: response.status.progress,
            stages: response.status.stages
          });
        }
      });
    }
  }

  setupUpdates() {
    // Listen for storage updates (from background script)
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        const analysisKey = `analysis_${this.currentTabId}`;
        if (changes[analysisKey]) {
          this.updateUI(changes[analysisKey].newValue);
        }
      }
      // Update exclusion status when excludedSites changes
      if (areaName === 'sync' && changes.excludedSites) {
        this.updateExclusionStatus();
      }
    });

    // Also poll for updates (backup mechanism)
    this.updateInterval = setInterval(() => {
      this.loadAnalysisStatus();
      if (!document.getElementById('results-section')?.classList.contains('hidden')) {
        void this.appendAdBlockerResultItem();
      }
    }, 1000);
  }

  async ensureAnalysisStarted() {
    // Check if analysis is already running
    const storageKey = `analysis_${this.currentTabId}`;
    const data = await chrome.storage.local.get(storageKey);
    
    if (!data[storageKey] || data[storageKey].status === 'not_started') {
      // Trigger analysis via content script
      try {
        await chrome.tabs.sendMessage(this.currentTabId, {
          type: 'TRIGGER_ANALYSIS'
        });
      } catch (error) {
        // Content script might not be loaded, try sending message anyway
        console.log('Could not send message to content script:', error);
      }
    }
  }

  updateUI(data) {
    const loadingEl = document.getElementById('loading');
    const analysisEl = document.getElementById('analysis-container');
    const progressSection = document.getElementById('progress-section');
    const resultsSection = document.getElementById('results-section');
    const errorSection = document.getElementById('error-section');

    // Hide all sections first
    loadingEl.classList.add('hidden');
    analysisEl.classList.remove('hidden');
    progressSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    errorSection.classList.add('hidden');

    if (data.status === 'error') {
      this.showError(data.error || 'Analysis failed');
      return;
    }

    if (data.status === 'excluded') {
      progressSection.classList.add('hidden');
      resultsSection.classList.add('hidden');
      errorSection.classList.remove('hidden');
      document.getElementById('error-message').textContent = data.message || 'This site is excluded from analysis';
      return;
    }

    if (data.status === 'analyzing') {
      const progress = data.progress || 0;
      document.getElementById('progress-bar').style.width = `${progress}%`;

      const stageEl = document.getElementById('current-stage');
      const flagged = (data.neutralisedCount || 0) + (data.adsHidden || 0);
      let stageText = data.currentStage || 'Analyzing page…';
      if (flagged > 0) {
        const parts = [];
        if (data.neutralisedCount > 0) parts.push(`${data.neutralisedCount} labelled`);
        if (data.adsHidden > 0) parts.push(`${data.adsHidden} ads hidden`);
        stageText = `${stageText} · ${parts.join(', ')}`;
      }
      stageEl.textContent = stageText;

      if (data.partialResults && Object.keys(data.partialResults).length > 0) {
        this.showPartialResults(data.partialResults, data.stages);
      }
    }

    if (data.status === 'completed' && data.result) {
      // Show final results
      progressSection.classList.add('hidden');
      resultsSection.classList.remove('hidden');
      this.displayResults(data.result);
    }

  }

  showPartialResults(partialResults, stages) {
    // Optionally show partial results during analysis
    // This can be enhanced to show intermediate findings
  }

  displayResults(result) {
    const summary = result.summary || {};
    const overallStatus = document.getElementById('overall-status');
    const summaryDetails = document.getElementById('summary-details');
    const resultsList = document.getElementById('results-list');

    // Set overall status
    overallStatus.className = `overall-status ${summary.overall || 'safe'}`;
    overallStatus.textContent = `Status: ${this.capitalize(summary.overall || 'safe')}`;

    // Show summary details
    summaryDetails.innerHTML = `
      <p><strong>Analysis Score:</strong> ${((1 - (summary.score || 0)) * 100).toFixed(1)}% safe</p>
      <p><strong>Analysis Time:</strong> ${(result.duration / 1000).toFixed(1)}s</p>
    `;

    // Display detailed results
    resultsList.innerHTML = '';
    const results = result.results || {};
    
    Object.entries(FEATURE_DISPLAY).forEach(([key, meta]) => {
      const resultData = results[key];
      if (!resultData) return;

      const score = resultData.score || 0;
      const confidence = resultData.confidence || 0;
      const scoreClass = score < 0.3 ? 'low' : score < 0.6 ? 'medium' : 'high';
      const scorePercent = (score * 100).toFixed(0);

      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `
        <div class="result-item-header">
          <span class="result-item-name">${meta.name}</span>
          <span class="result-item-score ${scoreClass}">${scorePercent}%</span>
        </div>
        <div class="result-item-details">
          ${meta.description}<br>
          <small>Confidence: ${(confidence * 100).toFixed(0)}%</small>
        </div>
      `;
      resultsList.appendChild(item);
    });

    this.displayFactCheckResults(result);
    this.displayChunkResults(result.chunkResults || []);
    void this.appendAdBlockerResultItem();
  }

  toggleChunksList() {
    const list = document.getElementById('chunks-list');
    const btn = document.getElementById('chunks-toggle');
    const icon = document.getElementById('chunks-toggle-icon');
    const open = list.classList.toggle('hidden');
    const expanded = !open;
    btn.setAttribute('aria-expanded', String(expanded));
    icon.textContent = expanded ? '▾' : '▸';
  }

  displayChunkResults(chunkResults) {
    const section = document.getElementById('chunks-section');
    const list = document.getElementById('chunks-list');
    const label = document.getElementById('chunks-toggle-label');
    if (!section || !list) return;

    if (!chunkResults.length) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    label.textContent = `Page chunks (${chunkResults.length})`;
    list.innerHTML = '';
    list.classList.add('hidden');
    document.getElementById('chunks-toggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('chunks-toggle-icon').textContent = '▸';

    chunkResults.forEach((chunk, index) => {
      const score = chunk.overallScore ?? 0;
      const scoreClass = score < 0.3 ? 'low' : score < 0.6 ? 'medium' : 'high';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'chunk-item';
      item.dataset.xpath = chunk.xpath || '';
      const preview = chunk.textPreview || `Chunk ${index + 1}`;
      item.innerHTML = `
        <span class="chunk-item-preview">${this.escapeHtml(preview)}</span>
        <span class="chunk-item-score ${scoreClass}">${(score * 100).toFixed(0)}%</span>
      `;
      item.addEventListener('click', () => this.highlightChunkOnPage(chunk.xpath, item));
      list.appendChild(item);
    });
  }

  async isPageAdBlockerEnabled() {
    if (!this.currentUrl) return false;
    let hostname = '';
    try {
      hostname = new URL(this.currentUrl).hostname.replace(/^www\./, '');
    } catch {
      return false;
    }

    const stored = await chrome.storage.sync.get(null);
    const mod = {
      enabled: true,
      blockPageAds: true,
      blockYouTubeAds: true,
      ...(stored.modules?.adBlocker || {}),
    };
    if (mod.enabled === false || mod.blockPageAds === false) return false;

    const excluded = stored.excludedSites || [];
    if (excluded.includes(hostname) || excluded.includes(`www.${hostname}`)) {
      return false;
    }

    const overrides =
      stored.domainOverrides?.[hostname] || stored.domainOverrides?.[`www.${hostname}`];
    if (overrides?.adBlocker === false) return false;

    return true;
  }

  async fetchAdBlockStatus() {
    const enabled = await this.isPageAdBlockerEnabled();
    if (!enabled) {
      return { enabled: false, blockedCount: 0, adsPreviewActive: false };
    }

    let blockedCount = 0;
    let adsPreviewActive = false;

    if (this.currentTabId) {
      const key = `analysis_${this.currentTabId}`;
      const local = await chrome.storage.local.get(key);
      blockedCount = local[key]?.adsHidden ?? 0;

      const remote = await runtimeSendMessage({
        type: 'GET_AD_BLOCK_STATUS',
        tabId: this.currentTabId,
      });
      if (remote) {
        blockedCount = Math.max(blockedCount, remote.blockedCount ?? 0);
        adsPreviewActive = remote.adsPreviewActive ?? false;
      }
    }

    return { enabled: true, blockedCount, adsPreviewActive };
  }

  async appendAdBlockerResultItem() {
    const resultsList = document.getElementById('results-list');
    if (!resultsList) return;

    document.querySelector('.adblocker-result-item')?.remove();

    const status = await this.fetchAdBlockStatus();
    if (!status.enabled) return;

    this.adPreviewActive = status.adsPreviewActive;

    const countLabel =
      status.blockedCount > 0
        ? `${status.blockedCount} hidden`
        : 'None on this page';

    let hintText = 'No ads detected on this page yet.';
    if (status.adsPreviewActive) {
      hintText =
        'Previewing what was blocked. Ad blocking is still on — new ads stay hidden.';
    } else if (status.blockedCount > 0) {
      hintText = `${status.blockedCount} ad block${status.blockedCount === 1 ? '' : 's'} hidden — see what you were protected from.`;
    }

    const item = document.createElement('div');
    item.className = 'result-item adblocker-result-item';
    item.innerHTML = `
      <div class="result-item-header">
        <span class="result-item-name">Ad Blocker</span>
        <span class="result-item-score low">${countLabel}</span>
      </div>
      <div class="result-item-details">
        Blocks ads on web pages while you browse.<br>
        <small>${this.escapeHtml(hintText)}</small><br>
        <button type="button" class="show-ads-btn show-ads-btn--inline" ${status.blockedCount === 0 && !status.adsPreviewActive ? 'disabled' : ''}>
          ${status.adsPreviewActive ? 'Hide again' : 'Show blocked'}
        </button>
      </div>
    `;

    item.querySelector('.show-ads-btn--inline')?.addEventListener('click', () => {
      this.toggleBlockedAdsPreview();
    });

    resultsList.insertBefore(item, resultsList.firstChild);
  }

  async toggleBlockedAdsPreview() {
    if (!this.currentTabId) return;

    try {
      const type = this.adPreviewActive ? 'HIDE_BLOCKED_ADS_PREVIEW' : 'SHOW_BLOCKED_ADS';
      await chrome.tabs.sendMessage(this.currentTabId, { type });
      await this.appendAdBlockerResultItem();
    } catch (error) {
      this.showStatusMessage('Could not update ad preview on this tab', 'error');
      console.log('Ad preview toggle failed:', error);
    }
  }

  async highlightChunkOnPage(xpath, clickedEl) {
    if (!xpath || !this.currentTabId) return;
    document.querySelectorAll('.chunk-item.active').forEach((el) => el.classList.remove('active'));
    clickedEl?.classList.add('active');
    try {
      await chrome.tabs.sendMessage(this.currentTabId, {
        type: 'HIGHLIGHT_CHUNK',
        xpath,
      });
    } catch (error) {
      console.log('Could not highlight chunk:', error);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  displayFactCheckResults(result) {
    const factCheckSection = document.getElementById('factcheck-results');
    const factCheckList = document.getElementById('factcheck-list');
    
    const factCheckerResult = result.results?.factChecker;
    if (!factCheckerResult || !factCheckerResult.factChecks || factCheckerResult.factChecks.length === 0) {
      factCheckSection.classList.add('hidden');
      return;
    }

    // Show fact-check section
    factCheckSection.classList.remove('hidden');
    factCheckList.innerHTML = '';

    // Display explanation
    if (factCheckerResult.explanation) {
      const explanationEl = document.createElement('div');
      explanationEl.className = 'factcheck-explanation';
      explanationEl.textContent = factCheckerResult.explanation;
      factCheckList.appendChild(explanationEl);
    }

    // Display each claim and its fact-checks
    factCheckerResult.factChecks.forEach((claimResult, index) => {
      const claimItem = document.createElement('div');
      claimItem.className = 'factcheck-claim-item';
      
      // Claim text
      const claimText = document.createElement('div');
      claimText.className = 'factcheck-claim-text';
      claimText.textContent = claimResult.claim || `Claim ${index + 1}`;
      claimItem.appendChild(claimText);

      // Fact-checks for this claim
      if (claimResult.factChecks && claimResult.factChecks.length > 0) {
        const factChecksContainer = document.createElement('div');
        factChecksContainer.className = 'factcheck-reviews';

        claimResult.factChecks.forEach(factCheck => {
          const reviewItem = document.createElement('div');
          reviewItem.className = 'factcheck-review-item';

          // Rating badge
          const rating = factCheck.claimReview?.[0]?.textualRating || 'Unknown';
          const ratingClass = this.getRatingClass(rating);
          
          reviewItem.innerHTML = `
            <div class="factcheck-review-header">
              <span class="factcheck-rating ${ratingClass}">${rating}</span>
              <span class="factcheck-publisher">${factCheck.claimReview?.[0]?.publisher || 'Unknown Publisher'}</span>
            </div>
            ${factCheck.claimReview?.[0]?.title ? `<div class="factcheck-title">${factCheck.claimReview[0].title}</div>` : ''}
            ${factCheck.claimReview?.[0]?.url ? `<a href="${factCheck.claimReview[0].url}" target="_blank" class="factcheck-link">View fact-check →</a>` : ''}
          `;

          factChecksContainer.appendChild(reviewItem);
        });

        claimItem.appendChild(factChecksContainer);
      } else {
        const noChecks = document.createElement('div');
        noChecks.className = 'factcheck-no-results';
        noChecks.textContent = 'No fact-checks found for this claim';
        claimItem.appendChild(noChecks);
      }

      factCheckList.appendChild(claimItem);
    });

    // Show metadata if available
    if (factCheckerResult.metadata) {
      const metadataEl = document.createElement('div');
      metadataEl.className = 'factcheck-metadata';
      metadataEl.innerHTML = `
        <small>
          Claims checked: ${factCheckerResult.metadata.claimsChecked || 0} | 
          Fact-checks found: ${factCheckerResult.metadata.factChecksFound || 0}
          ${factCheckerResult.metadata.averageRating !== undefined ? ` | Average rating: ${(factCheckerResult.metadata.averageRating * 100).toFixed(0)}%` : ''}
        </small>
      `;
      factCheckList.appendChild(metadataEl);
    }
  }

  getRatingClass(rating) {
    const ratingLower = (rating || '').toLowerCase();
    if (ratingLower.includes('false') || ratingLower.includes('pants on fire')) {
      return 'rating-false';
    } else if (ratingLower.includes('true')) {
      return 'rating-true';
    } else if (ratingLower.includes('mixture') || ratingLower.includes('half')) {
      return 'rating-mixed';
    }
    return 'rating-unknown';
  }

  showError(message) {
    const errorSection = document.getElementById('error-section');
    const analysisEl = document.getElementById('analysis-container');
    const loadingEl = document.getElementById('loading');
    
    loadingEl.classList.add('hidden');
    analysisEl.classList.remove('hidden');
    errorSection.classList.remove('hidden');
    document.getElementById('error-message').textContent = message;
  }

  showNoTab() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('no-tab').classList.remove('hidden');
  }

  showMessage(message) {
    const loadingEl = document.getElementById('loading');
    loadingEl.innerHTML = `<p>${message}</p>`;
  }

  async retryAnalysis() {
    // Clear existing analysis
    const storageKey = `analysis_${this.currentTabId}`;
    await chrome.storage.local.remove(storageKey);

    // Trigger new analysis
    await this.ensureAnalysisStarted();
    await this.loadAnalysisStatus();
  }

  truncateUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + urlObj.pathname.substring(0, 50);
    } catch {
      return url.substring(0, 60);
    }
  }

  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  async updateExclusionStatus() {
    if (!this.currentUrl) return;

    const isExcluded = await this.isSiteExcluded(this.currentUrl);
    const toggleBtn = document.getElementById('exclude-toggle-btn');
    const toggleIcon = document.getElementById('exclude-toggle-icon');
    const toggleText = document.getElementById('exclude-toggle-text');

    if (isExcluded) {
      toggleBtn.classList.add('excluded');
      toggleIcon.textContent = '🔓';
      toggleText.textContent = 'Included';
    } else {
      toggleBtn.classList.remove('excluded');
      toggleIcon.textContent = '🔒';
      toggleText.textContent = 'Exclude';
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

  async toggleSiteExclusion() {
    if (!this.currentUrl) return;

    try {
      const urlObj = new URL(this.currentUrl);
      const hostname = urlObj.hostname;
      
      const settings = await chrome.storage.sync.get({ excludedSites: [] });
      let excludedSites = settings.excludedSites || [];
      
      const isExcluded = excludedSites.includes(hostname);
      
      if (isExcluded) {
        excludedSites = excludedSites.filter(site => site !== hostname);
        this.showStatusMessage('Site removed from excluded list', 'success');
      } else {
        excludedSites.push(hostname);
        this.showStatusMessage('Site added to excluded list', 'success');
      }
      
      await chrome.storage.sync.set({ excludedSites });
      await this.updateExclusionStatus();

      chrome.runtime.sendMessage({
        type: 'SITE_EXCLUSION_CHANGED',
        tabId: this.currentTabId,
        excluded: !isExcluded,
      });

      // Notify content script to update
      try {
        await chrome.tabs.sendMessage(this.currentTabId, {
          type: 'EXCLUSION_CHANGED'
        });
      } catch (error) {
        // Content script might not be loaded
        console.log('Could not notify content script:', error);
      }
    } catch (error) {
      this.showStatusMessage('Error updating exclusion: ' + error.message, 'error');
    }
  }

  showStatusMessage(message, type) {
    // Create temporary status message
    const statusEl = document.createElement('div');
    statusEl.className = `status-message ${type}`;
    statusEl.textContent = message;
    statusEl.style.cssText = `
      position: fixed;
      top: 70px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 1000;
      ${type === 'success' ? 'background: #e8f5e9; color: #2e7d32;' : 'background: #ffebee; color: #c62828;'}
    `;
    document.body.appendChild(statusEl);
    
    setTimeout(() => {
      statusEl.remove();
    }, 2000);
  }

  cleanup() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}

// Initialize popup controller
const popupController = new PopupController();

// Cleanup on popup close
window.addEventListener('beforeunload', () => {
  popupController.cleanup();
});
