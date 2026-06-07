/** Logger for BetterNet (background + Node tests). */

let _tabId = null;

export function setTabId(tabId) {
  _tabId = tabId;
}

export function logit(level, ...args) {
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
    console.error('[BetterNet] Error in logit:', error);
  }
}
