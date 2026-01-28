/**
 * Logger utility for BetterNet extension
 * 
 * If in the page (e.g. content.js) -- use console.log
 * If in the background (e.g. background.js) -- use logit() after calling setTabId()
 * 
 * Calling code e.g. chunking, factcheck, etc should be the same regardless.
 * content.js and background.js manage setup of a global logger here.
 */

type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

let _tabId: number | null = null;
export function setTabId(tabId: number | null): void {
  _tabId = tabId;
}

/**
 * Logging helper that logs to background console and forwards to content script
 * Uses the tabId set via setTabId() to forward logs to content scripts
 * @param level - Log level: 'log', 'warn', 'error', etc.
 * @param args - Arguments to log
 */
export function logit(level: LogLevel, ...args: any[]): void {
  // Always log to background console
  const logMethod = (console as any)[level] || console.log;
  logMethod(...args);
  
  // Try to send to content script if we have a tabId
  if (_tabId) {
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
      
      const logEntry = {
        level,
        message: `[BetterNet] ${message}`,
        args: args.map(arg => {
          // Serialize objects for transmission
          if (typeof arg === 'object') {
            try {
              return JSON.parse(JSON.stringify(arg));
            } catch {
              return String(arg);
            }
          }
          return arg;
        })
      };
      
      // Send message to content script
      chrome.tabs.sendMessage(_tabId, {
        type: 'BG_LOG',
        ...logEntry
      }).catch((error: Error) => {
        // Tab might not have content script loaded yet, that's okay
        // Only log if it's not a "receiving end does not exist" error
        if (error.message && !error.message.includes('Could not establish connection')) {
          console.warn('[BetterNet] Failed to send log to content script:', error.message);
        }
      });
    } catch (error) {
      console.error('[BetterNet] Error in logit:', error);
    }
  }
}
