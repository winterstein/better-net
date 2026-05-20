/**
 * Minimal chrome.* mock for background / offscreen unit tests in Node.
 */

export function createOffscreenPort(handlers = {}) {
  const messageListeners = [];
  const disconnectListeners = [];
  const posted = [];

  const port = {
    name: 'bn-offscreen',
    posted,
    postMessage(msg) {
      posted.push(msg);
      const { requestId, action } = msg || {};
      let reply;
      if (Object.hasOwn(handlers, action)) {
        reply = handlers[action](msg);
      } else if (handlers.default) {
        reply = handlers.default(msg);
      }
      if (reply === null) return;
      if (reply === undefined) {
        queueMicrotask(() => emit({ requestId, ok: true }));
        return;
      }
      queueMicrotask(() => emit({ requestId, ...reply }));
    },
    onMessage: {
      addListener(fn) {
        messageListeners.push(fn);
      },
    },
    onDisconnect: {
      addListener(fn) {
        disconnectListeners.push(fn);
      },
    },
    emit(msg) {
      for (const fn of messageListeners) fn(msg);
    },
    disconnect() {
      for (const fn of disconnectListeners) fn();
    },
  };

  function emit(msg) {
    port.emit(msg);
  }

  return port;
}

/**
 * @param {{ storage?: Record<string, unknown>, hasOffscreen?: boolean, autoConnectPort?: boolean, portHandlers?: Record<string, (msg: object) => object> }} [opts]
 */
export function installChromeMock(opts = {}) {
  const storageData = { localModels: {}, ...(opts.storage || {}) };
  const messageListeners = [];
  const connectListeners = [];
  let offscreenExists = false;
  let connectedPort = null;

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === 'string') {
            return { [keys]: storageData[keys] };
          }
          const defaults = keys && typeof keys === 'object' ? keys : {};
          const out = { ...defaults };
          for (const key of Object.keys(defaults)) {
            if (key in storageData) out[key] = storageData[key];
          }
          return out;
        },
        async set(obj) {
          Object.assign(storageData, obj);
        },
      },
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test-id/${path}`;
      },
      onMessage: {
        addListener(fn) {
          messageListeners.push(fn);
        },
      },
      onConnect: {
        addListener(fn) {
          connectListeners.push(fn);
        },
      },
      async getContexts() {
        return offscreenExists
          ? [{ contextType: 'OFFSCREEN_DOCUMENT', documentUrl: chrome.runtime.getURL('offscreen/offscreen.html') }]
          : [];
      },
    },
    offscreen: opts.hasOffscreen === false
      ? undefined
      : {
          async hasDocument() {
            return offscreenExists;
          },
          async createDocument() {
            offscreenExists = true;
            if (opts.autoConnectPort !== false) {
              connectedPort = createOffscreenPort(opts.portHandlers || {});
              for (const fn of connectListeners) fn(connectedPort);
            }
          },
          async closeDocument() {
            offscreenExists = false;
            if (connectedPort) {
              connectedPort.disconnect();
              connectedPort = null;
            }
          },
        },
    _test: {
      storageData,
      messageListeners,
      connectListeners,
      setOffscreenDocumentExists(exists) {
        offscreenExists = exists;
      },
      connectPort(port) {
        connectedPort = port;
        for (const fn of connectListeners) fn(port);
      },
      get connectedPort() {
        return connectedPort;
      },
    },
  };

  globalThis.chrome = chrome;
  return chrome;
}

export async function dispatchRuntimeMessage(chrome, message, sender = { id: 'test-sender' }) {
  return new Promise((resolve) => {
    for (const fn of chrome._test.messageListeners) {
      const handled = fn(message, sender, resolve);
      if (handled === true) return;
    }
    resolve(undefined);
  });
}
