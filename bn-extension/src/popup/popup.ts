// Popup script for BetterNet extension

import { findAnalysisByModule } from '../types/ModuleAnalysis.js';
import { chunkProblemScore } from '../types/ChunkAnalysis.js';
import { fractionFromProblemScore } from '../types/Score.js';
import { hostListed, normalizeHost } from '../utils/host.js';
import { escapeHtml } from '../utils/escape-html.js';
import { createPopupLog, runStep } from './popup-diagnostics.js';
import { setupAccountLink } from '../accounts/account-link-ui.js';

const log = createPopupLog();

const FEATURE_DISPLAY = {
  factChecker: { name: 'Fact Checker', description: 'Claims checked against fact-check sources' },
  biasDetector: { name: 'Bias Detector', description: 'Political or ideological bias' },
  antiManipulation: { name: 'Anti-manipulation', description: 'Dark patterns and manipulative UX' },
  defuseRagebait: { name: 'Defuse Ragebait', description: 'Outrage-bait and harmful language' },
  clickUnbait: { name: 'Click Unbait', description: 'Honest summaries on clickbait links' },
};

// The popup renders its shell before awaiting anything, so these bound how
// long we wait for *data* only — never how long the user stares at a spinner.
const TABS_TIMEOUT_MS = 2_000;
const STORAGE_TIMEOUT_MS = 4_000;
const MESSAGE_TIMEOUT_MS = 3_000;
const POLL_INTERVAL_MS = 1_000;
/** If the popup is not interactive by now, say so instead of spinning. */
const READY_WATCHDOG_MS = 2_500;

async function runtimeSendMessage(message) {
  const step = await runStep(
    `runtime.sendMessage ${message?.type}`,
    () =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            log.warn(
              `sendMessage ${message?.type} lastError:`,
              chrome.runtime.lastError.message
            );
            resolve(null);
            return;
          }
          resolve(response ?? null);
        });
      }),
    MESSAGE_TIMEOUT_MS,
    log
  );
  return step.value;
}

/** Last-resort UI, so a broken popup is never a blank rectangle. */
function showFatalError(message) {
  try {
    document.getElementById('loading')?.classList.add('hidden');
    document.getElementById('analysis-container')?.classList.remove('hidden');
    document.getElementById('progress-section')?.classList.add('hidden');
    document.getElementById('results-section')?.classList.add('hidden');
    document.getElementById('error-section')?.classList.remove('hidden');
    const errorEl = document.getElementById('error-message');
    if (errorEl) errorEl.textContent = message;
  } catch (error) {
    log.error('could not render fatal error UI:', error);
  }
}

/** Mirror popup problems into the service worker console (survives popup close). */
function reportToBackground(type, detail) {
  try {
    chrome.runtime.sendMessage({ type, ...detail }, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    log.warn(`could not report ${type} to background:`, error);
  }
}

window.addEventListener('error', (event) => {
  log.error('uncaught error:', event.message, `${event.filename}:${event.lineno}`);
  reportToBackground('POPUP_ERROR', { message: `uncaught: ${event.message}` });
  showFatalError('BetterNet popup hit an error. See the popup console for details.');
});

window.addEventListener('unhandledrejection', (event) => {
  log.error('unhandled promise rejection:', event.reason);
  reportToBackground('POPUP_ERROR', {
    message: `unhandled rejection: ${String(event.reason)}`,
  });
});

class PopupController {
  [key: string]: any;

  constructor() {
    this.currentTabId = null;
    this.currentUrl = null;
    this.updateInterval = null;
    this.storageListenerAttached = false;
    this.adPreviewActive = false;
    /** Results are published per pass, so the popup keeps the last one it was given. */
    this.lastResult = null;
    this.lastResultAt = 0;
    this.lastChunkStats = null;
    this.chunksExpanded = false;
    this.ready = false;
    this.watchdog = null;
    this.startWatchdog();
    this.init();
  }

  /** A popup that never paints reads as "clicking did nothing" — break that silence. */
  startWatchdog() {
    this.watchdog = setTimeout(() => {
      if (this.ready) return;
      log.warn(`popup still not interactive after ${READY_WATCHDOG_MS}ms`);
      reportToBackground('POPUP_ERROR', { message: 'popup init watchdog fired' });
      showFatalError(
        'BetterNet is taking longer than usual to open. Press Retry, or reload the extension if this keeps happening.'
      );
    }, READY_WATCHDOG_MS);
  }

  markReady(where) {
    if (this.ready) return;
    this.ready = true;
    clearTimeout(this.watchdog);
    this.watchdog = null;
    log.info(`popup interactive (${where}) after ${log.sinceOpen()}ms`);
  }

  async init() {
    log.info('init start; document.readyState =', document.readyState);
    try {
      await this.initPopup();
      log.info(`init complete after ${log.sinceOpen()}ms`);
    } catch (error) {
      log.error('init failed:', error);
      reportToBackground('POPUP_ERROR', {
        message: `init failed: ${error?.message ?? error}`,
      });
      this.showError('Popup failed to load. Try reloading the extension.');
    } finally {
      this.markReady('init finished');
    }
  }

  async initPopup() {
    // Paint the shell before awaiting anything. A slow or hung chrome.* call
    // must never leave the user staring at a spinner.
    this.wireStaticControls();
    this.showIdleAnalysis();
    this.markReady('shell rendered');

    const tabsStep = await runStep(
      'tabs.query',
      () => chrome.tabs.query({ active: true, currentWindow: true }),
      TABS_TIMEOUT_MS,
      log
    );

    if (!tabsStep.ok) {
      this.showError('Could not read the active tab. Close and reopen BetterNet.');
      return;
    }

    const tabs = tabsStep.value || [];
    if (tabs.length === 0) {
      log.warn('no active tab in the current window');
      this.showNoTab();
      return;
    }

    this.currentTabId = tabs[0].id;
    const url = tabs[0].url;
    this.currentUrl = url;
    log.info('active tab', this.currentTabId, url);

    reportToBackground('POPUP_OPENED', {
      tabId: this.currentTabId,
      url,
      openMs: log.sinceOpen(),
    });

    // Check if URL is valid (not chrome://, etc.)
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
      log.info('tab is not analyzable:', url);
      this.showMessage('This page cannot be analyzed.');
      return;
    }

    // Display URL
    const urlEl = document.getElementById('current-url');
    if (urlEl) urlEl.textContent = this.truncateUrl(url);

    // Independent of each other — run together so a slow one cannot delay the other
    await Promise.all([this.updateExclusionStatus(), this.loadAnalysisStatus()]);

    // Set up real-time updates
    this.setupUpdates();

    // Request analysis if not already started
    void this.ensureAnalysisStarted();
  }

  /** Button wiring only — no awaits, so the popup is clickable immediately. */
  wireStaticControls() {
    // Settings works even when the active tab cannot be analyzed
    document.getElementById('settings-btn')?.addEventListener('click', () => {
      log.info('opening options page');
      chrome.runtime.openOptionsPage();
    });

    document.getElementById('retry-btn')?.addEventListener('click', () => {
      log.info('retry clicked');
      void this.retryAnalysis();
    });

    document.getElementById('exclude-toggle-btn')?.addEventListener('click', () => {
      void this.toggleSiteExclusion();
    });

    document.getElementById('chunks-toggle')?.addEventListener('click', () => {
      this.toggleChunksList();
    });

    // Optional account link. Not awaited: its status arrives from the server, and the popup
    // must never wait on the network to become clickable.
    void setupAccountLink({
      sendMessage: (message) => runtimeSendMessage(message),
      openUrl: (url) => {
        chrome.tabs.create({ url });
        window.close();
      },
      ids: { button: 'popup-account-link', status: 'popup-account-link-status' },
    });
  }

  showIdleAnalysis() {
    this.updateUI({
      status: 'not_started',
      progress: 0,
      currentStage: 'Starting analysis…',
    });
  }

  async loadAnalysisStatus() {
    const storageKey = `analysis_${this.currentTabId}`;
    const stored = await runStep(
      'storage.local.get(analysis)',
      () => chrome.storage.local.get(storageKey) as Promise<Record<string, unknown>>,
      STORAGE_TIMEOUT_MS,
      log
    );

    const data = stored.value;
    if (data?.[storageKey]) {
      this.updateUI(data[storageKey]);
      return;
    }

    const response = await runtimeSendMessage({
      type: 'GET_ANALYSIS_STATUS',
      tabId: this.currentTabId,
    });

    if (response?.status) {
      this.updateUI({
        status: response.status.status,
        progress: response.status.progress,
        stages: response.status.stages,
        currentStage: response.status.currentStage,
        neutralisedCount: response.status.neutralisedCount,
        adsHidden: response.status.adsHidden,
        chunkStats: response.status.chunkStats,
        diagnostics: response.status.diagnostics,
        result: response.status.result,
      });
      return;
    }

    log.debug('no analysis status yet for tab', this.currentTabId);
    this.showIdleAnalysis();
  }

  setupUpdates() {
    this.setupStorageListener();
    this.startPolling();
  }

  setupStorageListener() {
    // Attach once — retryAnalysis() re-enters setupUpdates()
    if (this.storageListenerAttached) return;
    this.storageListenerAttached = true;

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
        void this.updateExclusionStatus();
      }
    });
  }

  /** Poll as a backup for the storage listener. */
  startPolling() {
    if (this.updateInterval) return;
    log.debug(`polling analysis status every ${POLL_INTERVAL_MS}ms`);
    this.updateInterval = setInterval(() => {
      void this.loadAnalysisStatus();
      if (!document.getElementById('results-section')?.classList.contains('hidden')) {
        void this.appendAdBlockerResultItem();
      }
    }, POLL_INTERVAL_MS);
  }

  /** Content script unreachable — say so instead of spinning on "Analyzing page…". */
  showStalledNotice(message) {
    const results = document.getElementById('results-section');
    if (results && !results.classList.contains('hidden')) return;
    log.warn('stalled:', message);
    const stage = document.getElementById('current-stage');
    if (stage) stage.textContent = message;
  }

  /**
   * Stop polling once there is nothing left to wait for. Idle polling keeps the
   * service worker awake and slows the storage reads the next popup depends on.
   */
  stopPolling(reason) {
    if (!this.updateInterval) return;
    clearInterval(this.updateInterval);
    this.updateInterval = null;
    log.debug('polling stopped:', reason);
  }

  async ensureAnalysisStarted() {
    // Check if analysis is already running
    const storageKey = `analysis_${this.currentTabId}`;
    const stored = await runStep(
      'storage.local.get(before trigger)',
      () => chrome.storage.local.get(storageKey),
      STORAGE_TIMEOUT_MS,
      log
    );
    const data = stored.value || {};

    if (!data[storageKey] || data[storageKey].status === 'not_started') {
      // Trigger analysis via content script
      log.info('triggering analysis on tab', this.currentTabId);
      const trigger = await runStep(
        'tabs.sendMessage(TRIGGER_ANALYSIS)',
        () => chrome.tabs.sendMessage(this.currentTabId, { type: 'TRIGGER_ANALYSIS' }),
        MESSAGE_TIMEOUT_MS,
        log
      );
      if (!trigger.ok) {
        // Content script might not be loaded on this page
        this.showStalledNotice(
          'BetterNet could not reach this page. Reload the tab, then reopen BetterNet.'
        );
      }
    }
  }

  updateUI(data) {
    if (!data) return;

    const loadingEl = document.getElementById('loading');
    const analysisEl = document.getElementById('analysis-container');
    const progressSection = document.getElementById('progress-section');
    const resultsSection = document.getElementById('results-section');
    const errorSection = document.getElementById('error-section');
    if (!loadingEl || !analysisEl || !progressSection || !resultsSection || !errorSection) return;

    loadingEl.classList.add('hidden');
    analysisEl.classList.remove('hidden');
    errorSection.classList.add('hidden');
    this.showDiagnostics(
      data.diagnostics || data.result?.diagnostics || data.result?.summary?.warnings
    );

    // Counts arrive with every update; a result only when a pass finishes. Both are kept,
    // so a tick that carries one does not blank the other.
    if (data.chunkStats) this.lastChunkStats = data.chunkStats;
    this.renderChunkStats();

    if (data.status === 'error') {
      this.stopPolling('analysis error');
      this.showError(data.error || 'Analysis failed');
      return;
    }

    if (data.status === 'no_chunks') {
      this.stopPolling('nothing to analyse');
      progressSection.classList.add('hidden');
      resultsSection.classList.add('hidden');
      errorSection.classList.remove('hidden');
      this.setErrorMessage(data.message || 'No content found to analyse on this page');
      return;
    }

    if (data.status === 'excluded') {
      this.stopPolling('site excluded');
      progressSection.classList.add('hidden');
      resultsSection.classList.add('hidden');
      errorSection.classList.remove('hidden');
      this.setErrorMessage(data.message || 'This site is excluded from analysis');
      return;
    }

    this.showResults(data, resultsSection);
    this.showProgress(data, progressSection);
  }

  /** The last published result, re-rendered only when a newer one arrives. */
  showResults(data, resultsSection) {
    if (data.result && data.result.timestamp !== this.lastResultAt) {
      this.lastResult = data.result;
      this.lastResultAt = data.result.timestamp;
      resultsSection.classList.remove('hidden');
      this.displayResults(data.result);
      return;
    }
    resultsSection.classList.toggle('hidden', !this.lastResult);
  }

  /**
   * Progress stays on screen while chunks are waiting on a scroll: the page is not
   * finished, it is paused on the reader. It is also why polling restarts — a pass that
   * starts when the reader scrolls has to be able to wake a popup that stopped polling.
   */
  showProgress(data, progressSection) {
    const waiting = this.lastChunkStats?.waiting ?? 0;
    const running = !data.status || data.status === 'analyzing' ||
      data.status === 'not_started' || data.status === 'idle';

    if (!running && !waiting) {
      progressSection.classList.add('hidden');
      if (data.status === 'completed') this.stopPolling('analysis complete');
      return;
    }

    progressSection.classList.remove('hidden');
    const progress = this.progressPercent(data);
    document.getElementById('progress-bar').style.width = `${progress}%`;
    document.getElementById('current-stage').textContent = this.stageText(data, waiting);
    if (data.status === 'analyzing') this.startPolling();
  }

  /**
   * Chunks analysed out of chunks known, so the bar does not read 100% while chunks are
   * still waiting on a scroll. Falls back to the background's figure before any counts.
   */
  progressPercent(data) {
    const stats = this.lastChunkStats;
    const outstanding = stats
      ? (stats.inFlight ?? 0) + (stats.queued ?? 0) + (stats.waiting ?? 0)
      : 0;
    const total = stats ? stats.analysed + outstanding : 0;
    if (!total) return data.progress || 0;
    return Math.round((100 * stats.analysed) / total);
  }

  stageText(data, waiting) {
    if (data.status === 'not_started' || data.status === 'idle') {
      return data.currentStage || 'Starting analysis…';
    }
    if (data.status === 'completed' && waiting > 0) {
      return 'Up to date with what you have read';
    }

    let text = data.currentStage || 'Analyzing page…';
    const parts = [];
    if (data.neutralisedCount > 0) parts.push(`${data.neutralisedCount} labelled`);
    if (data.adsHidden > 0) parts.push(`${data.adsHidden} ads hidden`);
    return parts.length ? `${text} · ${parts.join(', ')}` : text;
  }

  /** Chunks found, analysed, in flight, and held back until the reader scrolls to them. */
  renderChunkStats() {
    const el = document.getElementById('chunk-stats');
    if (!el) return;
    const stats = this.lastChunkStats;
    if (!stats || !stats.found) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }

    const parts = [`${stats.found} chunk${stats.found === 1 ? '' : 's'} found`];
    parts.push(`${stats.analysed} analysed`);
    const inProgress = (stats.inFlight ?? 0) + (stats.queued ?? 0);
    if (inProgress > 0) parts.push(`${inProgress} in progress`);
    el.textContent = parts.join(' · ');
    if (stats.waiting > 0) {
      const span = document.createElement('span');
      span.className = 'chunk-stats-waiting';
      span.textContent = ` · ${stats.waiting} waiting until you scroll`;
      el.appendChild(span);
    }
    el.classList.remove('hidden');
  }

  showDiagnostics(messages) {
    const banner = document.getElementById('diagnostics-banner');
    if (!banner) return;
    const list = Array.isArray(messages)
      ? messages.filter((m) => typeof m === 'string' && m.trim())
      : [];
    if (!list.length) {
      banner.classList.add('hidden');
      banner.textContent = '';
      return;
    }
    banner.textContent = list.join(' ');
    banner.classList.remove('hidden');
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
    const results = result.results || [];

    Object.entries(FEATURE_DISPLAY).forEach(([key, meta]) => {
      const resultData = findAnalysisByModule(results, key);
      if (!resultData) return;

      // problemScore is the ProblemScore enum ('low' | 'medium' | 'high'); multiplying it
      // by 100 rendered "NaN%". Bridge to a fraction the same way the modal does.
      const score = fractionFromProblemScore(resultData.problemScore);
      const confidence = resultData.confidence || 0;
      const scoreClass = score < 0.3 ? 'low' : score < 0.6 ? 'medium' : 'high';
      const scorePercent = (score * 100).toFixed(0);

      const item = document.createElement('div');
      item.className = 'result-item';
      const explanation = resultData.explanation?.trim();
      item.innerHTML = `
        <div class="result-item-header">
          <span class="result-item-name">${meta.name}</span>
          <span class="result-item-score ${scoreClass}">${scorePercent}%</span>
        </div>
        <div class="result-item-details">
          ${meta.description}<br>
          <small>Confidence: ${(confidence * 100).toFixed(0)}%</small>
          ${explanation ? `<p class="result-item-explanation">${escapeHtml(explanation)}</p>` : ''}
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
    // Remembered: results are re-rendered as later chunks land, and collapsing the list
    // under the reader would undo the click they just made.
    this.chunksExpanded = expanded;
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
    list.classList.toggle('hidden', !this.chunksExpanded);
    document.getElementById('chunks-toggle')?.setAttribute('aria-expanded', String(this.chunksExpanded));
    document.getElementById('chunks-toggle-icon').textContent = this.chunksExpanded ? '▾' : '▸';

    chunkResults.forEach((chunk, index) => {
      const score = chunkProblemScore(chunk);
      const scoreClass = score < 0.3 ? 'low' : score < 0.6 ? 'medium' : 'high';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'chunk-item';
      item.dataset.xpath = chunk.xpath || '';
      const preview = chunk.textPreview || `Chunk ${index + 1}`;
      item.innerHTML = `
        <span class="chunk-item-preview">${escapeHtml(preview)}</span>
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

    const stored = (await chrome.storage.sync.get(null)) as unknown as Record<string, any>;
    const mod = {
      enabled: true,
      blockPageAds: true,
      blockYouTubeAds: true,
      ...(stored.modules?.adBlocker || {}),
    };
    if (mod.enabled === false || mod.blockPageAds === false) return false;

    const excluded: string[] = stored.excludedSites || [];
    if (hostListed(hostname, excluded)) {
      return false;
    }

    const host = normalizeHost(hostname);
    const overrides =
      stored.domainOverrides?.[host] || stored.domainOverrides?.[`www.${host}`];
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
        const r = remote as Record<string, any>;
        blockedCount = Math.max(blockedCount, r.blockedCount ?? 0);
        adsPreviewActive = r.adsPreviewActive ?? false;
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
        <small>${escapeHtml(hintText)}</small><br>
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
      log.warn('Ad preview toggle failed:', error);
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
      log.warn('Could not highlight chunk:', error);
    }
  }


  displayFactCheckResults(result) {
    const factCheckSection = document.getElementById('factcheck-results');
    const factCheckList = document.getElementById('factcheck-list');
    
    const factCheckerResult = findAnalysisByModule(result.results || [], 'factChecker');
    const factChecks = factCheckerResult?.metadata?.factChecks as unknown[] | undefined;
    if (!factCheckerResult || !factChecks || factChecks.length === 0) {
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
    factChecks.forEach((claimResult, index) => {
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
          const publisherRaw = factCheck.claimReview?.[0]?.publisher;
          const publisher =
            typeof publisherRaw === 'string'
              ? publisherRaw
              : publisherRaw?.name || 'Unknown Publisher';
          const title = factCheck.claimReview?.[0]?.title || '';
          const url = factCheck.claimReview?.[0]?.url || '';
          
          reviewItem.innerHTML = `
            <div class="factcheck-review-header">
              <span class="factcheck-rating ${ratingClass}">${escapeHtml(rating)}</span>
              <span class="factcheck-publisher">${escapeHtml(publisher)}</span>
            </div>
            ${title ? `<div class="factcheck-title">${escapeHtml(title)}</div>` : ''}
            ${url ? `<a href="${escapeHtml(url)}" target="_blank" class="factcheck-link">View fact-check →</a>` : ''}
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

  setErrorMessage(message) {
    const errorEl = document.getElementById('error-message');
    if (errorEl) errorEl.textContent = message;
  }

  showError(message) {
    log.warn('showError:', message);
    const errorSection = document.getElementById('error-section');
    const analysisEl = document.getElementById('analysis-container');
    const loadingEl = document.getElementById('loading');
    if (!errorSection || !analysisEl || !loadingEl) return;

    loadingEl.classList.add('hidden');
    analysisEl.classList.remove('hidden');
    errorSection.classList.remove('hidden');
    this.setErrorMessage(message);
  }

  showNoTab() {
    log.warn('showNoTab — no analyzable tab');
    document.getElementById('loading')?.classList.add('hidden');
    document.getElementById('no-tab')?.classList.remove('hidden');
  }

  showMessage(message) {
    const loadingEl = document.getElementById('loading');
    const analysisEl = document.getElementById('analysis-container');
    if (!loadingEl) return;
    loadingEl.classList.add('hidden');
    analysisEl?.classList.remove('hidden');
    document.getElementById('progress-section')?.classList.add('hidden');
    document.getElementById('results-section')?.classList.add('hidden');
    document.getElementById('error-section')?.classList.remove('hidden');
    this.setErrorMessage(message);
  }

  async retryAnalysis() {
    log.info('retrying analysis for tab', this.currentTabId);
    if (!this.currentTabId) {
      // Watchdog/tab-query failure path: start over rather than retry nothing
      this.ready = false;
      this.startWatchdog();
      await this.init();
      return;
    }

    // Clear existing analysis
    const storageKey = `analysis_${this.currentTabId}`;
    await chrome.storage.local.remove(storageKey);
    this.lastResult = null;
    this.lastResultAt = 0;
    this.lastChunkStats = null;

    // Trigger new analysis
    await this.ensureAnalysisStarted();
    await this.loadAnalysisStatus();
    this.startPolling();
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
    if (!toggleBtn || !toggleIcon || !toggleText) return;

    if (isExcluded) {
      toggleBtn.classList.add('excluded');
      toggleIcon.textContent = '🔓';
      toggleText.textContent = 'Include';
      toggleBtn.title = 'Currently excluded. Click to include this site in better:net analysis.';
    } else {
      toggleBtn.classList.remove('excluded');
      toggleIcon.textContent = '🔒';
      toggleText.textContent = 'Exclude';
      toggleBtn.title = 'Click to exclude this site from better:net analysis.';
    }
  }

  async isSiteExcluded(url) {
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      return false;
    }

    const settings = await runStep(
      'storage.sync.get(excludedSites)',
      () => chrome.storage.sync.get({ excludedSites: [] }),
      STORAGE_TIMEOUT_MS,
      log
    );
    const excludedSites = settings.value?.excludedSites || [];
    return hostListed(hostname, excludedSites);
  }

  async toggleSiteExclusion() {
    if (!this.currentUrl) return;

    try {
      const urlObj = new URL(this.currentUrl);
      const hostname = normalizeHost(urlObj.hostname);
      
      const settings = await chrome.storage.sync.get({ excludedSites: [] });
      let excludedSites = settings.excludedSites || [];
      
      const isExcluded = hostListed(hostname, excludedSites);
      
      if (isExcluded) {
        excludedSites = excludedSites.filter(site => !hostListed(hostname, [site]));
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
        log.warn('Could not notify content script:', error);
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
    this.stopPolling('popup closing');
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }
}

// Initialize popup controller
log.info('popup script loaded');
const popupController = new PopupController();

// `pagehide`, not `beforeunload`: a slow popup teardown makes Chrome drop the
// *next* toolbar click, which the user sees as "clicking does nothing".
window.addEventListener('pagehide', () => {
  log.info(`popup closing after ${log.sinceOpen()}ms`);
  popupController.cleanup();
});
