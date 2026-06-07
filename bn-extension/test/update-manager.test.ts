/**
 * Unit tests for update-manager bundle seeding and remote checks.
 */

import { installChromeMock, dispatchRuntimeMessage } from './helpers/chrome-mock.js';

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const chrome = installChromeMock({ storage: {} });

if (!chrome.alarms) {
  const alarms = new Map();
  chrome.alarms = {
    create(name, info) {
      alarms.set(name, info);
    },
    onAlarm: { addListener() {} },
  };
}

const fetchCalls = [];
globalThis.fetch = async (url) => {
  fetchCalls.push(url);
  if (String(url).includes('manifest.json')) {
    return {
      ok: true,
      async json() {
        return { version: 2, url: 'https://updates.test/domain-off-defaults/2.json' };
      },
    };
  }
  if (String(url).includes('/2.json')) {
    return {
      ok: true,
      async json() {
        return {
          version: 2,
          domains: { 'example.gov': { factChecker: false } },
        };
      },
    };
  }
  return { ok: false, status: 404 };
};

const {
  ensureBundlesSeeded,
  getBundle,
  checkBundleForUpdate,
  applyDomainOffDefaults,
  isModuleOffByDefault,
  STORAGE_BUNDLES_KEY,
} = await import('../src/update-manager/update-manager.js');

await ensureBundlesSeeded();

const offDefaults = await getBundle('domain-off-defaults');
assert(offDefaults?.data?.domains?.['gov.uk']?.factChecker === false, 'bundled gov.uk factChecker off');
assert(offDefaults?.source === 'bundled', 'first load should be bundled snapshot');

const settings = applyDomainOffDefaults(
  { domainOverrides: { 'gov.uk': { factChecker: true } } },
  offDefaults
);
assert(settings.domainOverrides['gov.uk'].factChecker === true, 'user override should win');

assert(
  isModuleOffByDefault(offDefaults, 'www.gov.uk', 'adBlocker') === true,
  'should detect off-by-default for module'
);

const checkResult = await checkBundleForUpdate('domain-off-defaults');
assert(checkResult.status === 'updated', `remote update should apply, got ${checkResult.status}`);

const afterRemote = await getBundle('domain-off-defaults');
assert(afterRemote.version === 2, 'version should bump after remote download');
assert(
  afterRemote.data?.domains?.['example.gov']?.factChecker === false,
  'remote domain entry should be stored'
);
assert(afterRemote.source === 'remote', 'source should be remote after download');

// Remote manifest with unchanged version
globalThis.fetch = async () => ({
  ok: true,
  async json() {
    return { version: afterRemote.version };
  },
});
const upToDate = await checkBundleForUpdate('domain-off-defaults');
assert(upToDate.status === 'up_to_date', 'same version should skip download');

// Background message handler
fetchCalls.length = 0;
const { setupUpdateManager } = await import('../src/background/update-manager.js');
setupUpdateManager();

const ignored = await dispatchRuntimeMessage(chrome, { type: 'OTHER' });
assert(ignored === undefined, 'non BN_UPDATE_DATA messages should be ignored');

const listRes = await dispatchRuntimeMessage(chrome, { type: 'BN_UPDATE_DATA', action: 'list' });
assert(listRes?.bundles?.['domain-off-defaults']?.version >= 2, 'list should return stored bundles');

const getRes = await dispatchRuntimeMessage(chrome, {
  type: 'BN_UPDATE_DATA',
  action: 'get',
  bundleId: 'chunking-xpath-patterns',
});
assert(getRes?.entry?.data?.version === 1, 'get should return chunking xpath bundle');

console.log('✅ update-manager tests passed');
