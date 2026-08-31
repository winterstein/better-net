/** Logger for BetterNet. No-op unless Settings → Advanced → Console logging is on. */

let _tabId = null;
let _enabled = false;
let _listening = false;

export function setTabId(tabId) {
  _tabId = tabId;
}

export function setConsoleLogging(enabled: boolean) {
  _enabled = !!enabled;
}

export function isConsoleLoggingEnabled() {
  return _enabled;
}

/** Subscribe to chrome.storage so the toggle applies without a reload. Safe to call more than once. */
export function initConsoleLogging() {
  if (_listening) return;
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) return;
  _listening = true;
  chrome.storage.sync
    .get('consoleLogging')
    .then((stored) => {
      _enabled = !!stored?.consoleLogging;
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && 'consoleLogging' in changes) {
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

initConsoleLogging();
