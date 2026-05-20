/**
 * ESM settings helpers (options page uses settings/defaults.js IIFE).
 */

export const MODULES = [
  { id: 'adBlocker', name: 'Ad Blocker' },
  { id: 'cookieCutter', name: 'Cookie Cutter' },
  { id: 'privacyShield', name: 'Privacy Shield' },
  { id: 'clickUnbait', name: 'Click Unbait' },
  { id: 'factChecker', name: 'Fact Checker' },
  { id: 'biasDetector', name: 'Bias Detector' },
  { id: 'antiManipulation', name: 'Anti-manipulation' },
  { id: 'adRevenue', name: 'Ad Revenue' },
  { id: 'defuseRagebait', name: 'Defuse Ragebait' },
];

export function defaultModuleState() {
  return Object.fromEntries(
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
}

export function mergeSettings(stored = {}) {
  const modules = { ...defaultModuleState(), ...(stored.modules || {}) };
  for (const m of MODULES) {
    modules[m.id] = { ...defaultModuleState()[m.id], ...(stored.modules?.[m.id] || {}) };
  }
  return {
    analysisMode: 'local',
    localModelId: 'mobilebert-mnli',
    excludedSites: [],
    domainOverrides: {},
    ...stored,
    modules,
  };
}

/**
 * @param {ReturnType<typeof mergeSettings>} settings
 * @param {string} moduleId
 * @param {string} [hostname]
 */
export function isModuleEnabled(settings, moduleId, hostname) {
  const mod = settings.modules?.[moduleId];
  if (mod?.enabled === false) return false;
  const host = hostname?.replace(/^www\./, '');
  if (host && settings.excludedSites?.includes(host)) return false;
  const overrides = settings.domainOverrides?.[host];
  if (overrides && overrides[moduleId] === false) return false;
  return true;
}
