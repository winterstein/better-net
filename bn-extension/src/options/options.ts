// better:net settings (options page)

import { LOCAL_MODELS, formatBytes } from '../ai/model-catalog.js';

const LOG = '[BN:local-model]';
const STORAGE_TIMEOUT_MS = 8_000;
const MESSAGE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out — reload the extension`)), timeoutMs);
    }),
  ]);
}

async function readSyncSettings(): Promise<Record<string, unknown>> {
  return withTimeout(
    chrome.storage.sync.get(null) as Promise<Record<string, unknown>>,
    STORAGE_TIMEOUT_MS,
    'Settings storage'
  );
}

async function sendExtensionMessage(message) {
  console.log(LOG, 'options → background', message);
  return withTimeout(
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        console.log(LOG, 'options ← background', response);
        resolve(response ?? null);
      });
    }),
    MESSAGE_TIMEOUT_MS,
    'Background'
  );
}

class SettingsController {
  [key: string]: any;

  constructor() {
    this.settings = null;
    this.currentPage = 'ai-model';
    this.localModelsState = {};
    this.localModelPollTimer = null;
    this.localModelsUiReady = false;
    this.uiReady = false;
    document.getElementById('nav-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleNav();
    });
    this.init();
  }

  setupEventListeners() {
    document.getElementById('save-btn')?.addEventListener('click', () => this.saveSettings());
    document.getElementById('reset-btn')?.addEventListener('click', () => this.resetSettings());
    document.getElementById('add-excluded-site-btn')?.addEventListener('click', () =>
      this.addExcludedSite()
    );
    document.getElementById('new-excluded-site')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addExcludedSite();
    });
    document.getElementById('add-offlist-domain-btn')?.addEventListener('click', () =>
      this.addOffListDomain()
    );
    document.getElementById('new-offlist-domain')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addOffListDomain();
    });

    window.addEventListener('hashchange', () => {
      const id = location.hash.replace(/^#/, '');
      if (id && this.navPages.some((p) => p.id === id)) this.showPage(id, false);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.localModels) {
        this.localModelsState = changes.localModels.newValue || {};
        this.renderLocalModelsList(this.localModelsState);
      }
    });
  }

  renderSettingsUi() {
    this.buildNav();
    this.buildModulesList();
    this.applySettingsToForm();
    this.ensureLocalModelsUI();
    this.renderOffList();
    this.renderExcludedSites();

    const pageFromHash = location.hash.replace(/^#/, '');
    const target =
      pageFromHash && this.navPages.some((p) => p.id === pageFromHash)
        ? pageFromHash
        : 'ai-model';
    // Re-applying settings must not close the mobile nav (storage reload race).
    this.showPage(target, false, { closeNav: !this.uiReady || target !== this.currentPage });
    this.uiReady = true;
  }

  async init() {
    if (!window.BN_SETTINGS) {
      console.error('[BetterNet] BN_SETTINGS missing — is defaults.js loaded?');
      this.showStatus('Settings failed to load (defaults.js missing). Try reloading the extension.', 'error');
      return;
    }
    const { DEFAULTS, NAV_PAGES, MODULES, mergeSettings, normalizeDomain } =
      window.BN_SETTINGS;
    this.defaults = DEFAULTS;
    this.navPages = NAV_PAGES;
    this.modules = MODULES;
    this.mergeSettings = mergeSettings;
    this.normalizeDomain = normalizeDomain;

    // Render immediately so the page is usable even if storage/background is slow.
    this.settings = this.mergeSettings({});
    this.setupEventListeners();
    this.renderSettingsUi();

    try {
      const stored = await readSyncSettings();
      this.settings = this.mergeSettings(stored);
      this.renderSettingsUi();
    } catch (err) {
      console.error('[BetterNet] Settings init failed:', err);
      this.showStatus('Settings failed to load: ' + (err?.message || err), 'error');
    }
  }

  ensureLocalModelsUI() {
    if (!this.localModelsUiReady) {
      document.getElementById('analysis-mode')?.addEventListener('change', () => {
        this.updateLocalModelsVisibility();
      });
      document.getElementById('local-memory-clear')?.addEventListener('click', () => {
        void this.clearLocalModelMemory();
      });
      this.localModelsUiReady = true;
    }
    this.updateLocalModelsVisibility();
    void this.refreshLocalModelStatus().catch((err) => {
      console.warn('[BetterNet] Local model status refresh failed:', err);
    });
  }

  updateLocalModelsVisibility() {
    const isLocal = document.getElementById('analysis-mode')?.value === 'local';
    document.getElementById('local-model-active-row')?.classList.toggle('hidden', !isLocal);
  }

  isModelDownloaded(state) {
    return state?.status === 'ready';
  }

  formatMemoryStats(stats) {
    if (!stats || stats.error) {
      return stats?.error || 'Memory stats unavailable';
    }
    const loaded = (stats.loadedModelIds || [])
      .map((id) => LOCAL_MODELS.find((m) => m.id === id)?.name || id)
      .join(', ');
    const heap =
      stats.jsHeapUsedBytes != null && stats.jsHeapLimitBytes != null
        ? `JS heap ${formatBytes(stats.jsHeapUsedBytes)} used / ${formatBytes(stats.jsHeapLimitBytes)} limit`
        : 'JS heap size not reported by this browser';
    return `${heap}. In memory: ${loaded || 'none'}.`;
  }

  async refreshLocalMemoryStats() {
    const el = document.getElementById('local-memory-stats');
    if (!el) return;
    try {
      const res = await sendExtensionMessage({
        type: 'BN_LOCAL_MODEL',
        action: 'memory',
      });
      if (res?.error) throw new Error(res.error);
      el.textContent = this.formatMemoryStats(res);
    } catch (err) {
      el.textContent = 'Memory stats unavailable' + (err?.message ? `: ${err.message}` : '');
    }
  }

  async clearLocalModelMemory() {
    if (
      !confirm(
        'Clear runtime memory? Downloaded models stay on disk; the next analysis will reload the active model.'
      )
    ) {
      return;
    }
    try {
      const res = await sendExtensionMessage({
        type: 'BN_LOCAL_MODEL',
        action: 'clearMemory',
      });
      if (res?.error) throw new Error(res.error);
      const el = document.getElementById('local-memory-stats');
      if (el && res?.memory) el.textContent = this.formatMemoryStats(res.memory);
      else await this.refreshLocalMemoryStats();
      this.showStatus('Runtime memory cleared', 'success');
    } catch (err) {
      this.showStatus('Clear memory failed: ' + (err?.message || err), 'error');
    }
  }

  async refreshLocalModelStatus() {
    try {
      const res = await sendExtensionMessage({
        type: 'BN_LOCAL_MODEL',
        action: 'status',
      });
      if (res?.models) {
        this.localModelsState = res.models;
        this.renderLocalModelsList(res.models);
        void this.refreshLocalMemoryStats();
        return;
      }
    } catch {
      // fall through to storage
    }
    const { localModels = {} } = await chrome.storage.local.get({ localModels: {} });
    this.localModelsState = localModels;
    this.renderLocalModelsList(localModels);
    void this.refreshLocalMemoryStats();
  }

  syncLocalModelSelect(stateMap = this.localModelsState) {
    const select = document.getElementById('local-model-id') as HTMLSelectElement | null;
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '';
    for (const model of LOCAL_MODELS) {
      const state = stateMap[model.id] || { status: 'not_installed' };
      const opt = document.createElement('option');
      opt.value = model.id;
      const tag = this.isModelDownloaded(state) ? 'downloaded' : 'not downloaded';
      opt.textContent = `${model.name} (${tag}, ~${formatBytes(model.sizeBytes)})`;
      select.appendChild(opt);
    }
    const preferred = this.settings.localModelId || 'flan-t5-small';
    select.value = [...select.options].some((o) => o.value === prev)
      ? prev
      : [...select.options].some((o) => o.value === preferred)
        ? preferred
        : select.options[0]?.value;
  }

  updateLocalModelPoll(stateMap: Record<string, { status?: string }> = {}) {
    const busy = Object.values(stateMap).some((s) =>
      ['downloading', 'loading'].includes(s?.status ?? '')
    );
    if (busy && !this.localModelPollTimer) {
      this.localModelPollTimer = setInterval(() => this.refreshLocalModelStatus(), 1500);
    } else if (!busy && this.localModelPollTimer) {
      clearInterval(this.localModelPollTimer);
      this.localModelPollTimer = null;
    }
  }

  busyStatusText(state) {
    const progressPct = Math.min(100, Math.max(0, state.progress ?? 0));
    if (state.status === 'loading') return 'Loading model…';
    return `Downloading… ${progressPct}%`;
  }

  /** Update progress bars in place when only %/busy text changed — avoids list flicker. */
  updateLocalModelProgressInPlace(stateMap = {}) {
    const container = document.getElementById('local-models-list');
    if (!container?.children.length) return false;

    for (const model of LOCAL_MODELS) {
      const state = stateMap[model.id] || { status: 'not_installed' };
      const card = container.querySelector(`[data-model-id="${CSS.escape(model.id)}"]`);
      if (!(card instanceof HTMLElement)) return false;

      const prevStatus = card.dataset.status || 'not_installed';
      const nextStatus = state.status || 'not_installed';
      const wasBusy = prevStatus === 'downloading' || prevStatus === 'loading';
      const isBusy = nextStatus === 'downloading' || nextStatus === 'loading';

      if (wasBusy && isBusy) {
        const progressPct = Math.min(100, Math.max(0, state.progress ?? 0));
        const statusEl = card.querySelector('.local-model-status');
        const bar = card.querySelector('.local-model-progress-bar');
        const progress = card.querySelector('.local-model-progress');
        if (statusEl) statusEl.textContent = this.busyStatusText(state);
        if (bar instanceof HTMLElement) bar.style.width = `${progressPct}%`;
        if (progress instanceof HTMLElement) {
          progress.setAttribute('aria-valuenow', String(progressPct));
        }
        card.dataset.status = nextStatus;
        continue;
      }

      if (prevStatus !== nextStatus) return false;
    }
    return true;
  }

  renderLocalModelsList(stateMap = {}) {
    if (!this.settings) return;
    const container = document.getElementById('local-models-list');
    console.log(LOG, 'renderLocalModelsList', stateMap);
    this.syncLocalModelSelect(stateMap);
    this.updateLocalModelPoll(stateMap);

    if (this.updateLocalModelProgressInPlace(stateMap)) return;

    container.innerHTML = '';

    for (const model of LOCAL_MODELS) {
      const state = stateMap[model.id] || { status: 'not_installed' };
      const downloaded = this.isModelDownloaded(state);
      const card = document.createElement('div');
      card.className = 'local-model-card' + (downloaded ? ' local-model-card--downloaded' : '');
      card.dataset.modelId = model.id;
      card.dataset.status = state.status || 'not_installed';

      const isBusy = state.status === 'downloading' || state.status === 'loading';
      const progressPct = Math.min(100, Math.max(0, state.progress ?? 0));
      let statusText = 'Not downloaded';
      let statusClass = 'local-model-status';
      if (isBusy) {
        statusText = this.busyStatusText(state);
        statusClass += ' local-model-status--busy';
      } else if (downloaded) {
        statusText = 'Downloaded — ready to use';
        statusClass += ' local-model-status--ready';
      } else if (state.status === 'error') {
        statusText = `Download failed: ${state.error || 'unknown error'}`;
        statusClass += ' local-model-status--error';
      } else if (state.status === 'removed') {
        statusText = 'Not downloaded';
      }

      const canDownload = !['ready', 'loading', 'downloading'].includes(state.status);
      // Ready or failed: allow remove (error may leave cached files / bad state).
      const canRemove =
        !isBusy && (downloaded || state.status === 'error');

      const badge = downloaded
        ? '<span class="local-model-badge local-model-badge--downloaded">Downloaded</span>'
        : '<span class="local-model-badge">Not on device</span>';

      card.innerHTML = `
        <div class="local-model-header">
          <div class="local-model-title-row">
            <strong>${this.escapeHtml(model.name)}</strong>
            ${badge}
          </div>
          <span class="local-model-size">~${formatBytes(model.sizeBytes)}</span>
        </div>
        <p class="local-model-desc">${this.escapeHtml(model.description)}</p>
        <p class="${statusClass}">${this.escapeHtml(statusText)}</p>
        ${
          isBusy
            ? `<div class="local-model-progress" role="progressbar" aria-valuenow="${progressPct}" aria-valuemin="0" aria-valuemax="100" aria-label="Download progress">
                 <div class="local-model-progress-bar" style="width: ${progressPct}%"></div>
               </div>`
            : ''
        }
        <div class="local-model-actions"></div>
      `;

      const actions = card.querySelector('.local-model-actions');
      if (canDownload) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-small';
        btn.textContent = state.status === 'error' ? 'Retry download' : 'Download';
        btn.addEventListener('click', () => {
          console.log(LOG, 'Download button clicked', model.id, 'state=', state.status);
          this.downloadLocalModel(model.id);
        });
        actions.appendChild(btn);
      }
      if (canRemove) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-small btn-secondary';
        btn.textContent = 'Remove';
        btn.addEventListener('click', () => this.removeLocalModel(model.id));
        actions.appendChild(btn);
      }

      container.appendChild(card);
    }
  }

  async downloadLocalModel(modelId) {
    console.log(LOG, 'downloadLocalModel()', modelId);
    this.showStatus('Starting download…', 'success');
    try {
      const res = await sendExtensionMessage({
        type: 'BN_LOCAL_MODEL',
        action: 'download',
        modelId,
      });
      if (!res) {
        throw new Error(
          'No response from extension (reload the extension and try again)'
        );
      }
      if (res.error) throw new Error(res.error);
      if (!res.started && !res.ok) {
        console.warn(LOG, 'unexpected download response', res);
        throw new Error('Download did not start');
      }
      console.log(LOG, 'download started', res);
      this.showStatus('Downloading in background — keep this browser open', 'success');
      await this.refreshLocalModelStatus();
    } catch (err) {
      const msg =
        err?.message ||
        (typeof err === 'string' ? err : 'Could not reach extension background');
      console.error(LOG, 'downloadLocalModel failed', msg, err);
      this.showStatus('Download failed: ' + msg, 'error');
      await this.refreshLocalModelStatus();
    }
  }

  async removeLocalModel(modelId) {
    const model = LOCAL_MODELS.find((m) => m.id === modelId);
    const label = model?.name || modelId;
    if (!confirm(`Delete the downloaded copy of "${label}" from this browser?`)) return;
    try {
      const res = await sendExtensionMessage({
        type: 'BN_LOCAL_MODEL',
        action: 'remove',
        modelId,
      });
      if (res?.error) throw new Error(res.error);
      this.showStatus('Model removed', 'success');
      await this.refreshLocalModelStatus();
    } catch (err) {
      this.showStatus('Remove failed: ' + err.message, 'error');
    }
  }

  buildNav() {
    const list = document.getElementById('nav-list');
    if (!list) return;
    list.innerHTML = '';
    for (const page of this.navPages) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-link';
      btn.dataset.page = page.id;
      btn.textContent = page.label;
      btn.addEventListener('click', () => this.showPage(page.id));
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  showPage(pageId, updateHash = true, { closeNav = true } = {}) {
    this.currentPage = pageId;
    if (updateHash) location.hash = pageId;
    if (pageId === 'ai-model') {
      void this.refreshLocalModelStatus().catch((err) => {
        console.warn('[BetterNet] Local model status refresh failed:', err);
      });
    }

    document.querySelectorAll('.page').forEach((el) => {
      el.classList.toggle('hidden', el.dataset.page !== pageId);
    });
    document.querySelectorAll('.nav-link').forEach((el) => {
      el.classList.toggle('active', el.dataset.page === pageId);
    });
    if (closeNav) this.closeNav();
  }

  closeNav() {
    document.getElementById('settings-nav')?.classList.remove('nav-open');
    document.getElementById('nav-toggle')?.setAttribute('aria-expanded', 'false');
  }

  toggleNav() {
    const nav = document.getElementById('settings-nav');
    if (!nav) return;
    const open = nav.classList.toggle('nav-open');
    document.getElementById('nav-toggle')?.setAttribute('aria-expanded', String(open));
  }

  buildModulesList() {
    const container = document.getElementById('modules-list');
    if (!container) return;
    container.innerHTML = '';

    for (const mod of this.modules) {
      const state = this.settings.modules[mod.id];
      const card = document.createElement('article');
      card.className = 'module-card';
      card.dataset.moduleId = mod.id;

      const extra =
        mod.id === 'adBlocker'
          ? `
        <div class="module-options">
          <label class="checkbox-label">
            <input type="checkbox" data-module-opt="blockYouTubeAds" ${state.blockYouTubeAds ? 'checked' : ''}>
            <span>Block YouTube ads (allow videos)</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" data-module-opt="blockPageAds" ${state.blockPageAds ? 'checked' : ''}>
            <span>Block ads on web pages</span>
          </label>
        </div>`
          : '';

      card.innerHTML = `
        <div class="module-header">
          <div class="module-title">
            <label class="checkbox-label module-enable">
              <input type="checkbox" data-module-enable ${state.enabled ? 'checked' : ''}>
              <strong>${this.escapeHtml(mod.name)}</strong>
            </label>
            <p class="module-desc">${this.escapeHtml(mod.description)}</p>
          </div>
        </div>
        ${extra}
      `;
      container.appendChild(card);
    }
  }

  applySettingsToForm() {
    const s = this.settings;
    const analysisMode = document.getElementById('analysis-mode') as HTMLSelectElement | null;
    if (!analysisMode) return;

    analysisMode.value = s.analysisMode;
    const localModelId = document.getElementById('local-model-id') as HTMLSelectElement | null;
    if (localModelId) localModelId.value = s.localModelId || 'flan-t5-small';
    this.updateLocalModelsVisibility();

    const setChecked = (id: string, checked: boolean) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.checked = checked;
    };
    const setValue = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = value;
    };

    setChecked('auto-analyze', s.autoAnalyze);
    setChecked('show-indicators', s.showIndicators);
    setValue('openai-key', s.BN_OPENAI_API_KEY || '');
    setValue('anthropic-key', s.BN_ANTHROPIC_API_KEY || '');
    setValue('google-factcheck-key', s.BN_GOOGLE_API_KEY || '');
    setChecked('share-anonymous', !!s.shareAnonymous);
    setChecked('share-usage-stats', !!s.shareUsageStats);
    setChecked('share-factcheck-cache', !!s.shareFactCheckCache);
    setValue('account-email', s.accountEmail || '');
    setValue('server-endpoint', s.serverEndpoint || '');
  }

  readFormIntoSettings() {
    const modules = { ...this.settings.modules };

    document.querySelectorAll('.module-card').forEach((card) => {
      const id = card.dataset.moduleId;
      const enabled = card.querySelector('[data-module-enable]').checked;
      modules[id] = { ...modules[id], enabled };
      card.querySelectorAll('[data-module-opt]').forEach((input) => {
        modules[id][input.dataset.moduleOpt] = input.checked;
      });
    });

    return {
      ...this.settings,
      analysisMode: document.getElementById('analysis-mode').value,
      localModelId: document.getElementById('local-model-id').value,
      autoAnalyze: document.getElementById('auto-analyze').checked,
      showIndicators: document.getElementById('show-indicators').checked,
      BN_OPENAI_API_KEY: document.getElementById('openai-key').value.trim(),
      BN_ANTHROPIC_API_KEY: document.getElementById('anthropic-key').value.trim(),
      BN_GOOGLE_API_KEY: document.getElementById('google-factcheck-key').value.trim(),
      shareAnonymous: document.getElementById('share-anonymous').checked,
      shareUsageStats: document.getElementById('share-usage-stats').checked,
      shareFactCheckCache: document.getElementById('share-factcheck-cache').checked,
      accountEmail: document.getElementById('account-email').value.trim(),
      serverEndpoint: document.getElementById('server-endpoint').value.trim(),
      modules,
      excludedSites: this.settings.excludedSites,
      domainOverrides: this.settings.domainOverrides,
    };
  }

  renderOffList() {
    const container = document.getElementById('offlist-domains');
    const domains = Object.keys(this.settings.domainOverrides || {}).sort();

    if (domains.length === 0) {
      container.innerHTML =
        '<p class="empty-message">No per-domain overrides. All enabled modules run on every site (except excluded domains).</p>';
      return;
    }

    container.innerHTML = '';
    for (const domain of domains) {
      const overrides = this.settings.domainOverrides[domain];
      const offModules = this.modules
        .filter((m) => overrides[m.id] === false)
        .map((m) => m.name);

      const card = document.createElement('div');
      card.className = 'offlist-card';
      card.innerHTML = `
        <div class="offlist-card-header">
          <strong>${this.escapeHtml(domain)}</strong>
          <button type="button" class="btn-remove" data-domain="${this.escapeHtml(domain)}" title="Remove">×</button>
        </div>
        <p class="offlist-summary">${offModules.length ? `Off: ${this.escapeHtml(offModules.join(', '))}` : 'No modules marked off'}</p>
        <div class="offlist-toggles"></div>
      `;

      const toggles = card.querySelector('.offlist-toggles');
      for (const mod of this.modules) {
        const label = document.createElement('label');
        label.className = 'checkbox-label offlist-module';
        const checked = overrides[mod.id] !== false;
        label.innerHTML = `
          <input type="checkbox" data-domain="${this.escapeHtml(domain)}" data-module="${mod.id}" ${checked ? 'checked' : ''}>
          <span>${this.escapeHtml(mod.name)}</span>
        `;
        label.querySelector('input').addEventListener('change', (e) =>
          this.setDomainModuleOverride(domain, mod.id, e.target.checked)
        );
        toggles.appendChild(label);
      }

      card.querySelector('.btn-remove').addEventListener('click', () =>
        this.removeOffListDomain(domain)
      );
      container.appendChild(card);
    }
  }

  async addOffListDomain() {
    const input = document.getElementById('new-offlist-domain');
    const raw = input.value.trim();
    if (!raw) {
      this.showStatus('Enter a domain', 'error');
      return;
    }
    const domain = this.normalizeDomain(raw);
    if (this.settings.domainOverrides[domain]) {
      this.showStatus('Domain already on Off-List', 'error');
      return;
    }
    const overrides = {};
    for (const m of this.modules) overrides[m.id] = false;
    this.settings.domainOverrides[domain] = overrides;
    input.value = '';
    this.renderOffList();
    this.showStatus(`Added ${domain} — all modules off for this domain`, 'success');
  }

  removeOffListDomain(domain) {
    delete this.settings.domainOverrides[domain];
    this.renderOffList();
    this.showStatus('Domain removed from Off-List', 'success');
  }

  setDomainModuleOverride(domain, moduleId, enabledOnDomain) {
    if (!this.settings.domainOverrides[domain]) return;
    if (enabledOnDomain) {
      delete this.settings.domainOverrides[domain][moduleId];
    } else {
      this.settings.domainOverrides[domain][moduleId] = false;
    }
    if (Object.keys(this.settings.domainOverrides[domain]).length === 0) {
      delete this.settings.domainOverrides[domain];
    }
    this.renderOffList();
  }

  renderExcludedSites() {
    const listEl = document.getElementById('excluded-sites-list');
    const excludedSites = this.settings.excludedSites || [];
    listEl.innerHTML = '';

    if (excludedSites.length === 0) {
      listEl.innerHTML =
        '<li class="empty-message">No excluded domains.</li>';
      return;
    }

    excludedSites.forEach((site, index) => {
      const li = document.createElement('li');
      li.className = 'excluded-site-item';
      li.innerHTML = `
        <span class="site-url">${this.escapeHtml(site)}</span>
        <button type="button" class="btn-remove" data-index="${index}" title="Remove">×</button>
      `;
      li.querySelector('.btn-remove').addEventListener('click', () =>
        this.removeExcludedSite(index)
      );
      listEl.appendChild(li);
    });
  }

  addExcludedSite() {
    const input = document.getElementById('new-excluded-site');
    const site = input.value.trim();
    if (!site) {
      this.showStatus('Enter a domain to exclude', 'error');
      return;
    }
    const normalized = this.normalizeDomain(site);
    if (this.settings.excludedSites.includes(normalized)) {
      this.showStatus('Domain already excluded', 'error');
      return;
    }
    this.settings.excludedSites.push(normalized);
    input.value = '';
    this.renderExcludedSites();
    this.showStatus('Domain excluded from all features', 'success');
  }

  removeExcludedSite(index) {
    this.settings.excludedSites.splice(index, 1);
    this.renderExcludedSites();
    this.showStatus('Domain removed from exclude list', 'success');
  }

  async saveSettings() {
    const settings = this.readFormIntoSettings();
    try {
      await chrome.storage.sync.set(settings);
      this.settings = this.mergeSettings(settings);
      this.showStatus('Settings saved', 'success');
    } catch (error) {
      this.showStatus('Error saving: ' + error.message, 'error');
    }
  }

  async resetSettings() {
    if (!confirm('Reset all settings to defaults?')) return;
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(this.defaults);
    this.settings = this.mergeSettings(this.defaults);
    this.buildModulesList();
    this.applySettingsToForm();
    this.renderOffList();
    this.renderExcludedSites();
    await this.refreshLocalModelStatus();
    this.showStatus('Settings reset', 'success');
  }

  showStatus(message, type) {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    setTimeout(() => {
      statusEl.className = 'status-message';
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

new SettingsController();
