/**
 * Update bundle catalog: bundled snapshots + remote manifest URLs.
 * Feature modules read data via update-manager.js, not this file directly.
 */

export const UPDATE_BASE_URL =
  'https://updates.betternet.org/extension/v1';

/** @typedef {{ version: number, manifestUrl: string }} UpdateBundleDef */

/** @type {Record<string, UpdateBundleDef>} */
export const UPDATE_BUNDLES = {
  'domain-off-defaults': {
    version: 1,
    manifestUrl: `${UPDATE_BASE_URL}/domain-off-defaults/manifest.json`,
  },
  'chunking-xpath-patterns': {
    version: 1,
    manifestUrl: `${UPDATE_BASE_URL}/chunking-xpath-patterns/manifest.json`,
  },
};

/** Shipped snapshots (version must match catalog entry). */
export const BUNDLED_SNAPSHOTS = {
  'domain-off-defaults': {
    version: 1,
    domains: {
      'gov.uk': { factChecker: false, adBlocker: false },
      'nhs.uk': { factChecker: false },
      'parliament.uk': { factChecker: false, biasDetector: false },
    },
  },
  'chunking-xpath-patterns': {
    version: 1,
    domains: {},
  },
};
