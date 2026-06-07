/**
 * Environment utilities for accessing API keys and configuration.
 */

import { logit } from './logger.js';
import envConfig from '../env.js';

const SUPPORTED_KEYS = [
  'BN_GOOGLE_API_KEY',
  'BN_OPENAI_API_KEY',
  'BN_ANTHROPIC_API_KEY'
];

let chromeStorageCache = null;
let chromeStorageInitialized = false;

export async function initializeChromeStorage() {
  if (chromeStorageInitialized) {
    return;
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    try {
      const defaults = {};
      SUPPORTED_KEYS.forEach(key => { defaults[key] = ''; });
      chromeStorageCache = await chrome.storage.sync.get(defaults);
    } catch (error) {
      logit('warn', 'Could not access chrome.storage:', error);
      chromeStorageCache = {};
    }
  } else {
    chromeStorageCache = {};
  }
  chromeStorageInitialized = true;
}

export function getValue(key) {
  if (!SUPPORTED_KEYS.includes(key)) {
    return null;
  }

  if (typeof process !== 'undefined' && process.env?.[key]?.trim()) {
    return process.env[key].trim();
  }

  const envJsValue = envConfig[key];
  if (typeof envJsValue === 'string' && envJsValue.trim()) {
    return envJsValue.trim();
  }

  const cached = chromeStorageCache?.[key];
  if (typeof cached === 'string' && cached.trim()) {
    return cached.trim();
  }

  return null;
}

export function getGoogleFactCheckKey() {
  return getValue('BN_GOOGLE_API_KEY');
}

export function getOpenAIKey() {
  return getValue('BN_OPENAI_API_KEY');
}

export function getAnthropicKey() {
  return getValue('BN_ANTHROPIC_API_KEY');
}

if (typeof chrome !== 'undefined' && chrome.storage) {
  initializeChromeStorage().catch(() => {});
}
