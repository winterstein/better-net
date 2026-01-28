// Options page script for BetterNet extension

class OptionsController {
  constructor() {
    this.defaults = {
      analysisMode: 'local',
      autoAnalyze: true,
      showIndicators: true,
      BN_OPENAI_API_KEY: '',
      BN_ANTHROPIC_API_KEY: '',
      BN_GOOGLE_API_KEY: '',
      shareAnonymous: true,
      excludedSites: []
    };

    this.init();
  }

  async init() {
    // Load saved settings
    const settings = await chrome.storage.sync.get(this.defaults);
    this.applySettings(settings);

    // Set up event listeners
    document.getElementById('save-btn').addEventListener('click', () => this.saveSettings());
    document.getElementById('reset-btn').addEventListener('click', () => this.resetSettings());
    document.getElementById('add-excluded-site-btn').addEventListener('click', () => this.addExcludedSite());
    document.getElementById('new-excluded-site').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.addExcludedSite();
      }
    });

    // Load excluded sites list
    this.loadExcludedSites();
  }

  applySettings(settings) {
    document.getElementById('analysis-mode').value = settings.analysisMode || this.defaults.analysisMode;
    document.getElementById('auto-analyze').checked = settings.autoAnalyze !== false;
    document.getElementById('show-indicators').checked = settings.showIndicators !== false;
    document.getElementById('openai-key').value = settings.BN_OPENAI_API_KEY || '';
    document.getElementById('anthropic-key').value = settings.BN_ANTHROPIC_API_KEY || '';
    document.getElementById('google-factcheck-key').value = settings.BN_GOOGLE_API_KEY || '';
    document.getElementById('share-anonymous').checked = settings.shareAnonymous !== false;
  }

  async loadExcludedSites() {
    const settings = await chrome.storage.sync.get(this.defaults);
    const excludedSites = settings.excludedSites || [];
    this.renderExcludedSites(excludedSites);
  }

  renderExcludedSites(excludedSites) {
    const listEl = document.getElementById('excluded-sites-list');
    listEl.innerHTML = '';

    if (excludedSites.length === 0) {
      listEl.innerHTML = '<li class="empty-message">No excluded sites. Analysis will run on all sites.</li>';
      return;
    }

    excludedSites.forEach((site, index) => {
      const li = document.createElement('li');
      li.className = 'excluded-site-item';
      li.innerHTML = `
        <span class="site-url">${this.escapeHtml(site)}</span>
        <button class="btn-remove" data-index="${index}" title="Remove">×</button>
      `;
      li.querySelector('.btn-remove').addEventListener('click', () => this.removeExcludedSite(index));
      listEl.appendChild(li);
    });
  }

  async addExcludedSite() {
    const input = document.getElementById('new-excluded-site');
    const site = input.value.trim();
    
    if (!site) {
      this.showStatus('Please enter a site to exclude', 'error');
      return;
    }

    // Normalize the site (extract domain or use full URL)
    const normalizedSite = this.normalizeSite(site);
    
    const settings = await chrome.storage.sync.get(this.defaults);
    const excludedSites = settings.excludedSites || [];
    
    if (excludedSites.includes(normalizedSite)) {
      this.showStatus('This site is already excluded', 'error');
      return;
    }

    excludedSites.push(normalizedSite);
    await chrome.storage.sync.set({ excludedSites });
    
    input.value = '';
    this.renderExcludedSites(excludedSites);
    this.showStatus('Site added to excluded list', 'success');
  }

  async removeExcludedSite(index) {
    const settings = await chrome.storage.sync.get(this.defaults);
    const excludedSites = settings.excludedSites || [];
    excludedSites.splice(index, 1);
    await chrome.storage.sync.set({ excludedSites });
    this.renderExcludedSites(excludedSites);
    this.showStatus('Site removed from excluded list', 'success');
  }

  normalizeSite(site) {
    // If it's a full URL, try to extract domain, otherwise use as-is
    try {
      const url = new URL(site.startsWith('http') ? site : `https://${site}`);
      return url.hostname;
    } catch {
      // If not a valid URL, return as-is (might be a pattern)
      return site;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async saveSettings() {
    const excludedSitesSettings = await chrome.storage.sync.get(this.defaults);
    const settings = {
      analysisMode: document.getElementById('analysis-mode').value,
      autoAnalyze: document.getElementById('auto-analyze').checked,
      showIndicators: document.getElementById('show-indicators').checked,
      BN_OPENAI_API_KEY: document.getElementById('openai-key').value,
      BN_ANTHROPIC_API_KEY: document.getElementById('anthropic-key').value,
      BN_GOOGLE_API_KEY: document.getElementById('google-factcheck-key').value,
      shareAnonymous: document.getElementById('share-anonymous').checked,
      excludedSites: excludedSitesSettings.excludedSites || []
    };

    try {
      await chrome.storage.sync.set(settings);
      this.showStatus('Settings saved successfully!', 'success');
    } catch (error) {
      this.showStatus('Error saving settings: ' + error.message, 'error');
    }
  }

  async resetSettings() {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(this.defaults);
      this.applySettings(this.defaults);
      this.showStatus('Settings reset to defaults', 'success');
    }
  }

  showStatus(message, type) {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    
    setTimeout(() => {
      statusEl.className = 'status-message';
    }, 3000);
  }
}

// Initialize options controller
new OptionsController();
