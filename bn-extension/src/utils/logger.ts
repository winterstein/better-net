/**
 * Logger for BetterNet. No-op unless Settings → Advanced → Developer Mode is on.
 *
 * Developer Mode also reveals AIQA trace links on feedback (specs/feedback.md); this
 * module owns the console half of it. The setting was called `consoleLogging` up to
 * v0.4, so a stored value under the old key is still honoured.
 */

let _tabId = null;
let _enabled = false;
let _listening = false;

export function setTabId(tabId) {
  _tabId = tabId;
}

export function setDeveloperMode(enabled: boolean) {
  _enabled = !!enabled;
}

export function isDeveloperMode() {
  return _enabled;
}

/** Reads Developer Mode from settings, falling back to the pre-v0.4 `consoleLogging`. */
export function developerModeFromSettings(settings: {
  developerMode?: boolean;
  consoleLogging?: boolean;
} = {}): boolean {
  return !!(settings.developerMode ?? settings.consoleLogging);
}

/** Subscribe to chrome.storage so the toggle applies without a reload. Safe to call more than once. */
export function initDeveloperMode() {
  if (_listening) return;
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) return;
  _listening = true;
  chrome.storage.sync
    .get(['developerMode', 'consoleLogging'])
    .then((stored) => {
      _enabled = developerModeFromSettings(stored);
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if ('developerMode' in changes) {
      _enabled = !!changes.developerMode.newValue;
    } else if ('consoleLogging' in changes) {
      _enabled = !!changes.consoleLogging.newValue;
    }
  });
}

export function logit(level, ...args) {
  if (!_enabled) return;

  const logMethod = console[level] || console.log;
  logMethod(...args);

  if (!_tabId || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
    return;
  }

  try {
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    chrome.tabs.sendMessage(_tabId, {
      type: 'BG_LOG',
      level,
      message: `[BetterNet] ${message}`,
      args
    }).catch(() => {});
  } catch (error) {
    if (_enabled) console.error('[BetterNet] Error in logit:', error);
  }
}

initDeveloperMode();
