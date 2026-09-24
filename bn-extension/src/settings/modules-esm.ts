/**
 * ESM settings helpers.
 *
 * Keep in step with settings/defaults.ts (IIFE for the options page bundle). Shared bits
 * that must not drift: DEFAULTS keys, isModuleEnabled / normalizeDomain behaviour, module
 * id list. Prefer editing both when changing behaviour.
 */

import { DEFAULT_NUTRIENT_LABEL_MIN_RISK } from '../types/RiskLevel.js';
import { hostListed, normalizeHost } from '../utils/host.js';

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

/**
 * bn-server base URL (bn-server/server.better-net.com.nginx). Feedback is switched off
 * without one, so a blank default meant the Content Analysis modal showed no feedback
 * controls at all until someone found Settings → Advanced. Keep in step with
 * settings/defaults.ts (duplicated for bundling, see AGENTS.md).
 */
export const DEFAULT_SERVER_ENDPOINT = 'https://server.better-net.com';

/**
 * bn-webapp base URL (bn-webapp/specs/feedback/feedback-viewer). Where "View my feedback"
 * goes. Keep in step with settings/defaults.ts.
 */
export const DEFAULT_WEBAPP_URL = 'https://app.better-net.com';

// TODO wtf is this code? it smells bogus
export function mergeSettings(stored: any = {}) {
  const modules = { ...defaultModuleState(), ...(stored.modules || {}) };
  for (const m of MODULES) {
    modules[m.id] = { ...defaultModuleState()[m.id], ...(stored.modules?.[m.id] || {}) };
  }
  const merged = {
    analysisMode: 'local',
    localModelId: 'flan-t5-small',
    showIndicators: true,
    // Keep in step with settings/defaults.ts (duplicated for bundling, see AGENTS.md).
    nutrientLabelMinRisk: DEFAULT_NUTRIENT_LABEL_MIN_RISK,
    aiqaTracing: false,
    aiqaApiKey: '',
    aiqaServerUrl: '',
    aiqaSamplingRate: 1,
    // AIQA organisation the traces belong to. The trace link needs it: the UI has no
    // route for a bare trace id (tracing/aiqa-trace-url.ts).
    aiqaOrganisationId: '',
    developerMode: false,
    /** Debug aid: outline every chunk on the page. See content/chunk-overlay.ts. */
    showChunkOverlay: false,
    // Analyse on-screen chunks first, deferring the rest until they scroll into view
    // (content/chunk-scheduler.ts). Keep in step with settings/defaults.ts.
    analyzeOnScreenFirst: true,
    demoMode: false,
    excludedSites: [],
    domainOverrides: {},
    serverEndpoint: DEFAULT_SERVER_ENDPOINT,
    ...stored,
    modules,
  };
  // A blank endpoint means "use the default": the options page stores '' for an empty
  // field, which would otherwise pin every existing profile to no server for ever.
  if (!String(merged.serverEndpoint || '').trim()) {
    merged.serverEndpoint = DEFAULT_SERVER_ENDPOINT;
  }
  return merged;
}

/**
 * @param {ReturnType<typeof mergeSettings>} settings
 * @param {string} moduleId
 * @param {string} [hostname]
 */
export function isModuleEnabled(settings, moduleId, hostname) {
  const mod = settings.modules?.[moduleId];
  if (mod?.enabled === false) return false;
  const host = normalizeHost(hostname || '');
  if (host && hostListed(host, settings.excludedSites)) return false;
  const overrides =
    settings.domainOverrides?.[host] ||
    settings.domainOverrides?.[`www.${host}`];
  if (overrides && overrides[moduleId] === false) return false;
  return true;
}
