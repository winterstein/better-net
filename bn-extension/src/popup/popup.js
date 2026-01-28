// Popup script for BetterNet extension

class PopupController {
  constructor() {
    this.currentTabId = null;
    this.currentUrl = null;
    this.updateInterval = null;
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
      // Show progress
      const progress = data.progress || 0;
      document.getElementById('progress-bar').style.width = `${progress}%`;
      
      const stageEl = document.getElementById('current-stage');
      if (data.currentStage) {
        stageEl.textContent = data.currentStage;
      }

      // Show partial results if available
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
    
    const resultTypes = [
      { key: 'fakeNews', name: 'Fake News', description: 'Checked for misleading or false information' },
      { key: 'scams', name: 'Scams', description: 'Scanned for fraudulent or deceptive content' },
      { key: 'toxicity', name: 'Toxicity', description: 'Analyzed for harmful or abusive language' },
      { key: 'bias', name: 'Bias', description: 'Detected political or ideological bias' },
    //   { key: 'aiGenerated', name: 'AI Generated', description: 'Checked for AI-generated content' },
      { key: 'reasoning', name: 'Reasoning', description: 'Evaluated logical reasoning quality' }
    ];

    resultTypes.forEach(type => {
      const resultData = results[type.key];
      if (!resultData) return;

      const score = resultData.score || 0;
      const confidence = resultData.confidence || 0;
      const scoreClass = score < 0.3 ? 'low' : score < 0.6 ? 'medium' : 'high';
      const scorePercent = (score * 100).toFixed(0);

      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `
        <div class="result-item-header">
          <span class="result-item-name">${type.name}</span>
          <span class="result-item-score ${scoreClass}">${scorePercent}%</span>
        </div>
        <div class="result-item-details">
          ${type.description}<br>
          <small>Confidence: ${(confidence * 100).toFixed(0)}%</small>
        </div>
      `;
      resultsList.appendChild(item);
    });

    // Display fact-check results if available
    this.displayFactCheckResults(result);
  }

  displayFactCheckResults(result) {
    const factCheckSection = document.getElementById('factcheck-results');
    const factCheckList = document.getElementById('factcheck-list');
    
    // Check if we have fact-check results in fakeNews results
    const fakeNewsResult = result.results?.fakeNews;
    if (!fakeNewsResult || !fakeNewsResult.factChecks || fakeNewsResult.factChecks.length === 0) {
      factCheckSection.classList.add('hidden');
      return;
    }

    // Show fact-check section
    factCheckSection.classList.remove('hidden');
    factCheckList.innerHTML = '';

    // Display explanation
    if (fakeNewsResult.explanation) {
      const explanationEl = document.createElement('div');
      explanationEl.className = 'factcheck-explanation';
      explanationEl.textContent = fakeNewsResult.explanation;
      factCheckList.appendChild(explanationEl);
    }

    // Display each claim and its fact-checks
    fakeNewsResult.factChecks.forEach((claimResult, index) => {
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
    if (fakeNewsResult.metadata) {
      const metadataEl = document.createElement('div');
      metadataEl.className = 'factcheck-metadata';
      metadataEl.innerHTML = `
        <small>
          Claims checked: ${fakeNewsResult.metadata.claimsChecked || 0} | 
          Fact-checks found: ${fakeNewsResult.metadata.factChecksFound || 0}
          ${fakeNewsResult.metadata.averageRating !== undefined ? ` | Average rating: ${(fakeNewsResult.metadata.averageRating * 100).toFixed(0)}%` : ''}
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
