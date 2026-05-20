/**
 * BetterNet settings schema and defaults (options page + chrome.storage.sync).
 */
(function (global) {
  const MODULES = [
    {
      id: 'adBlocker',
      name: 'Ad Blocker',
      description: 'Block ads on web pages and in YouTube while allowing videos to play.',
    },
    {
      id: 'cookieCutter',
      name: 'Cookie Cutter',
      description: 'Replace site cookie banners with your better:net consent preferences (TCF).',
    },
    {
      id: 'privacyShield',
      name: 'Privacy Shield',
      description: 'Block tracking calls using vendor lists and other signals.',
    },
    {
      id: 'clickUnbait',
      name: 'Click Unbait',
      description: 'Detect click-bait links and replace them with honest link text.',
    },
    {
      id: 'factChecker',
      name: 'Fact Checker',
      description: 'Extract claims and check them against fact-check sources.',
    },
    {
      id: 'biasDetector',
      name: 'Bias Detector',
      description: 'Detect political or ideological bias at the chunk level.',
    },
    {
      id: 'antiManipulation',
      name: 'Anti-manipulation',
      description: 'Label dark patterns, urgency tricks, and manipulative UX.',
    },
    {
      id: 'adRevenue',
      name: 'Ad Revenue',
      description: 'Transparent, fair-exchange treatment when ads are allowed.',
    },
    {
      id: 'defuseRagebait',
      name: 'Defuse Ragebait',
      description: 'Label outrage-bait and offer gentler presentation.',
    },
  ];

  const defaultModuleState = () =>
    Object.fromEntries(
      MODULES.map((m) => [
        m.id,
        {
          enabled: true,
          ...(m.id === 'adBlocker'
            ? { blockYouTubeAds: true, blockPageAds: true }
            : {}),
        },
      ])
    );

  const DEFAULTS = {
    analysisMode: 'local',
    localModelId: 'mobilebert-mnli',
    autoAnalyze: true,
    showIndicators: true,
    BN_OPENAI_API_KEY: '',
    BN_ANTHROPIC_API_KEY: '',
    BN_GOOGLE_API_KEY: '',
    shareAnonymous: false,
    shareUsageStats: false,
    shareFactCheckCache: false,
    excludedSites: [],
    domainOverrides: {},
    modules: defaultModuleState(),
    accountEmail: '',
  };

  const NAV_PAGES = [
    { id: 'ai-model', label: 'AI Model' },
    { id: 'modules', label: 'Modules' },
    { id: 'off-list', label: 'Off-List' },
    { id: 'account', label: 'Account' },
    { id: 'data-sharing', label: 'Data Sharing' },
  ];

  function normalizeDomain(site) {
    try {
      const url = new URL(site.startsWith('http') ? site : `https://${site}`);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return site.replace(/^www\./, '');
    }
  }

  function mergeSettings(stored) {
    const merged = { ...DEFAULTS, ...stored };
    merged.modules = { ...defaultModuleState(), ...(stored.modules || {}) };
    for (const m of MODULES) {
      merged.modules[m.id] = {
        ...defaultModuleState()[m.id],
        ...(stored.modules?.[m.id] || {}),
      };
    }
    merged.domainOverrides = { ...(stored.domainOverrides || {}) };
    merged.excludedSites = Array.isArray(stored.excludedSites)
      ? stored.excludedSites
      : DEFAULTS.excludedSites;
    return merged;
  }

  function isModuleEnabled(settings, moduleId, domain) {
    const mod = settings.modules?.[moduleId];
    if (!mod?.enabled) return false;
    if (!domain) return true;
    const host = normalizeDomain(domain);
    if (settings.excludedSites?.includes(host)) return false;
    const overrides = settings.domainOverrides?.[host];
    if (overrides && overrides[moduleId] === false) return false;
    return true;
  }

  global.BN_SETTINGS = {
    MODULES,
    NAV_PAGES,
    DEFAULTS,
    defaultModuleState,
    normalizeDomain,
    mergeSettings,
    isModuleEnabled,
  };
})(typeof window !== 'undefined' ? window : globalThis);
