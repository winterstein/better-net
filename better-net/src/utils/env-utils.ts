/**
 * Environment utilities for accessing API keys and configuration
 * Checks in order: environment variables, env.js, chrome.storage.sync (user options)
 * Uses canonical keys prefixed with BN_ (e.g., BN_GOOGLE_API_KEY)
 */

import { logit } from './logger.js';
import envConfig from '../env.js';

type SupportedKey = 'BN_GOOGLE_API_KEY' | 'BN_OPENAI_API_KEY' | 'BN_ANTHROPIC_API_KEY';

interface ChromeStorageCache {
  BN_GOOGLE_API_KEY?: string;
  BN_OPENAI_API_KEY?: string;
  BN_ANTHROPIC_API_KEY?: string;
  [key: string]: unknown;
}

let chromeStorageCache: ChromeStorageCache | null = null;
let chromeStorageInitialized = false;

/**
 * List of all supported canonical keys
 */
const SUPPORTED_KEYS: readonly SupportedKey[] = [
  'BN_GOOGLE_API_KEY',
  'BN_OPENAI_API_KEY',
  'BN_ANTHROPIC_API_KEY'
] as const;



/**
 * Initialize and cache chrome.storage.sync options
 * Should be called on module startup in browser extension contexts
 */
export async function initializeChromeStorage(): Promise<void> {
  if (chromeStorageInitialized) {
    logit('log', 'Chrome storage already initialized, skipping');
    return;
  }

  logit('log', 'Initializing chrome storage cache...');

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    try {
      // Get all relevant keys from chrome.storage.sync using canonical keys
      const defaults: Record<string, string> = {};
      SUPPORTED_KEYS.forEach(key => {
        defaults[key] = '';
      });

      logit('log', 'Fetching keys from chrome.storage.sync:', Object.keys(defaults));
      chromeStorageCache = await chrome.storage.sync.get(defaults) as ChromeStorageCache;
      
      // Log which keys were found (without logging actual key values for security)
      const foundKeys = Object.keys(chromeStorageCache).filter(key => {
        const value = chromeStorageCache?.[key];
        return typeof value === 'string' && value.trim().length > 0;
      });
      logit('log', `Chrome storage initialized. Found ${foundKeys.length} configured key(s):`, foundKeys);
      
      chromeStorageInitialized = true;
    } catch (error) {
      logit('warn', 'Could not access chrome.storage:', error);
      chromeStorageCache = {};
      chromeStorageInitialized = true; // Mark as initialized even on error to prevent retries
    }
  } else {
    logit('log', 'Chrome storage not available (not in extension context)');
    chromeStorageCache = {};
    chromeStorageInitialized = true;
  }
}

/**
 * Get a configuration value from various sources
 * Checks in order:
 * 1. Environment variables (using the canonical key)
 * 2. env.js file (using the canonical key)
 * 3. chrome.storage.sync (cached on startup, using the canonical key)
 * 
 * @param key - The canonical key name (e.g., 'BN_GOOGLE_API_KEY', 'BN_OPENAI_API_KEY')
 * @returns Value or null if not found
 */
export function getValue(key: SupportedKey): string | null {
  if (!SUPPORTED_KEYS.includes(key)) {
    logit('warn', `Unknown key: ${key}. Supported keys: ${SUPPORTED_KEYS.join(', ')}`);
    return null;
  }

  logit('log', `Getting value for key: ${key}`);

  // 1. Check environment variables (for Node.js/development)
  if (typeof process !== 'undefined' && process.env) {
    const envValue = process.env[key];
    if (envValue && envValue.trim()) {
      logit('log', `Found ${key} in environment variable`);
      return envValue.trim();
    }
  }

  // 2. Check env.js file
  const envJsValue = envConfig[key];
  if (typeof envJsValue === 'string' && envJsValue.trim()) {
    logit('log', `Found ${key} in env.js`);
    return envJsValue.trim();
  }

  // 3. Check chrome.storage.sync (cached)
  if (chromeStorageCache) {
    const cachedValue = chromeStorageCache[key];
    if (typeof cachedValue === 'string' && cachedValue.trim()) {
      logit('log', `Found ${key} in chrome.storage.sync`);
      return cachedValue.trim();
    }
  }

  logit('log', `Key ${key} not found in any source`);
  return null;
}

/**
 * Get Google Fact Check API key from various sources
 * @returns API key or null if not found
 */
export function getGoogleFactCheckKey(): string | null {
  return getValue('BN_GOOGLE_API_KEY');
}

/**
 * Get OpenAI API key from various sources
 * @returns API key or null if not found
 */
export function getOpenAIKey(): string | null {
  return getValue('BN_OPENAI_API_KEY');
}

/**
 * Get Anthropic API key from various sources
 * @returns API key or null if not found
 */
export function getAnthropicKey(): string | null {
  return getValue('BN_ANTHROPIC_API_KEY');
}

// Auto-initialize chrome storage if in browser extension context
if (typeof chrome !== 'undefined' && chrome.storage) {
  logit('log', 'Auto-initializing chrome storage on module load');
  initializeChromeStorage().catch(error => {
    logit('warn', 'Failed to initialize chrome storage:', error);
  });

  // Listen for storage changes to update cache
  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && chromeStorageCache) {
        logit('log', 'Chrome storage changed, updating cache:', Object.keys(changes));
        // Update cache with changed values
        for (const key in changes) {
          if (changes[key].newValue !== undefined) {
            chromeStorageCache[key] = changes[key].newValue;
            logit('log', `Updated cache for key: ${key}`);
          } else {
            delete chromeStorageCache[key];
            logit('log', `Removed key from cache: ${key}`);
          }
        }
      }
    });
  }
}

