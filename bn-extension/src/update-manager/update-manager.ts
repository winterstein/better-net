/**
 * Generic update service for domain-specific extension data.
 * Ships bundled snapshots; optionally downloads newer copies from UPDATE_BASE_URL.
 */

import { BUNDLED_SNAPSHOTS, UPDATE_BUNDLES } from './catalog.js';

export const STORAGE_BUNDLES_KEY = 'bnUpdateBundles';
export const STORAGE_META_KEY = 'bnUpdateManager';

const CHECK_ALARM_NAME = 'bn-update-check';
const CHECK_INTERVAL_MINUTES = 24 * 60;

/**
 * @param {string} bundleId
 * @param {Record<string, { version?: number, updatedAt?: number, source?: string, data?: object }>} [bundles]
 */
export async function getBundle(bundleId: string, bundles?: Record<string, unknown>) {
  const all = bundles ?? (await getStoredBundles());
  const entry = all[bundleId];
  if (entry?.data) return entry;
  return seedBundle(bundleId, all);
}

export async function getStoredBundles() {
  const { [STORAGE_BUNDLES_KEY]: bundles = {} } = await chrome.storage.local.get(STORAGE_BUNDLES_KEY);
  return bundles;
}

export async function getMeta() {
  const { [STORAGE_META_KEY]: meta = {} } = await chrome.storage.local.get(STORAGE_META_KEY);
  return meta;
}

/**
 * Seed storage from the shipped snapshot when a bundle is missing.
 */
export async function seedBundle(bundleId: string, bundlesIn?: Record<string, unknown>) {
  const snapshot = BUNDLED_SNAPSHOTS[bundleId];
  if (!snapshot) return null;

  const bundles = { ...(bundlesIn ?? (await getStoredBundles())) };
  const entry = {
    version: snapshot.version,
    updatedAt: Date.now(),
    source: 'bundled',
    data: snapshot,
  };
  bundles[bundleId] = entry;
  await chrome.storage.local.set({ [STORAGE_BUNDLES_KEY]: bundles });
  return entry;
}

export async function ensureBundlesSeeded() {
  const bundles = await getStoredBundles();
  for (const bundleId of Object.keys(UPDATE_BUNDLES)) {
    if (!bundles[bundleId]?.data) {
      await seedBundle(bundleId, bundles);
      Object.assign(bundles, await getStoredBundles());
    }
  }
}

/**
 * @param {string} bundleId
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function checkBundleForUpdate(bundleId: string, opts: any = {}) {
  const def = UPDATE_BUNDLES[bundleId];
  if (!def?.manifestUrl) {
    return { bundleId, status: 'no_remote' };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const stored = (await getBundle(bundleId)) ?? (await seedBundle(bundleId));
  const localVersion = stored?.version ?? 0;

  try {
    const res = await fetchImpl(def.manifestUrl, { cache: 'no-store' });
    if (!res.ok) {
      return { bundleId, status: 'check_failed', httpStatus: res.status };
    }
    const manifest = await res.json();
    const remoteVersion = Number(manifest?.version);
    if (!remoteVersion || remoteVersion <= localVersion) {
      return { bundleId, status: 'up_to_date', localVersion, remoteVersion: remoteVersion || null };
    }

    const dataUrl = manifest.url || manifest.dataUrl;
    if (!dataUrl) {
      return { bundleId, status: 'invalid_manifest', localVersion, remoteVersion };
    }

    const dataRes = await fetchImpl(dataUrl, { cache: 'no-store' });
    if (!dataRes.ok) {
      return { bundleId, status: 'download_failed', httpStatus: dataRes.status, remoteVersion };
    }
    const data = await dataRes.json();
    await saveRemoteBundle(bundleId, remoteVersion, data);
    return { bundleId, status: 'updated', localVersion, remoteVersion };
  } catch (err) {
    return { bundleId, status: 'error', error: err?.message || String(err) };
  }
}

async function saveRemoteBundle(bundleId, version, data) {
  const bundles = await getStoredBundles();
  bundles[bundleId] = {
    version,
    updatedAt: Date.now(),
    source: 'remote',
    data,
  };
  await chrome.storage.local.set({ [STORAGE_BUNDLES_KEY]: bundles });
}

/**
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function checkAllBundles(opts: any = {}) {
  const results = {};
  for (const bundleId of Object.keys(UPDATE_BUNDLES)) {
    results[bundleId] = await checkBundleForUpdate(bundleId, opts);
  }
  const meta = {
    lastCheckAt: Date.now(),
    results,
  };
  await chrome.storage.local.set({ [STORAGE_META_KEY]: meta });
  return { results, meta };
}

export function scheduleUpdateChecks() {
  if (!chrome.alarms?.create) return;
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
}

export function isUpdateCheckAlarm(name) {
  return name === CHECK_ALARM_NAME;
}

/**
 * Merge bundled domain-off-defaults into settings.domainOverrides (user wins).
 * @param {object} settings
 * @param {object} [bundleEntry]
 */
export function applyDomainOffDefaults(settings, bundleEntry) {
  const domains = bundleEntry?.data?.domains;
  if (!domains) return settings;

  const domainOverrides = { ...(settings.domainOverrides || {}) };
  for (const [domain, defaults] of Object.entries(domains)) {
    const existing = domainOverrides[domain] || {};
    const merged = { ...(defaults as Record<string, unknown>) };
    for (const [moduleId, value] of Object.entries(existing)) {
      if (value !== undefined) merged[moduleId] = value;
    }
    domainOverrides[domain] = merged;
  }
  return { ...settings, domainOverrides };
}

/**
 * @param {object} bundleEntry
 * @param {string} hostname
 * @param {string} moduleId
 */
export function isModuleOffByDefault(bundleEntry, hostname, moduleId) {
  const host = hostname?.replace(/^www\./, '');
  const domains = bundleEntry?.data?.domains || {};
  const overrides = domains[host] || domains[`www.${host}`];
  return overrides?.[moduleId] === false;
}
