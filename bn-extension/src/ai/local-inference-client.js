/**
 * Background-side client for local model inference in the offscreen document.
 * Uses a dedicated port (not broadcast runtime.sendMessage) to avoid content-script races.
 */

import { logit } from '../utils/logger.js';

const LOG = '[BN:local-model]';
const OFFSCREEN_URL = 'offscreen/offscreen.html';
const PORT_NAME = 'bn-offscreen';
const OFFSCREEN_PORT_WAIT_MS = 20_000;

let offscreenReady = null;
/** @type {chrome.runtime.Port | null} */
let offscreenPort = null;
/** @type {Map<string, (msg: object) => void>} */
const portWaiters = new Map();

async function persistLocalModels(localModels) {
  await chrome.storage.local.set({ localModels });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  console.log(LOG, 'background: offscreen port connected');
  offscreenPort = port;
  port.onMessage.addListener((msg) => {
    if (msg?.type === 'MODEL_STATE_SYNC' && msg.localModels) {
      persistLocalModels(msg.localModels).catch((err) => {
        console.error(LOG, 'background: failed to persist model state', err);
      });
      return;
    }
    const { requestId } = msg || {};
    if (!requestId || !portWaiters.has(requestId)) return;
    console.log(LOG, 'background: port response', requestId, msg);
    portWaiters.get(requestId)(msg);
    portWaiters.delete(requestId);
  });
  chrome.storage.local.get({ localModels: {} }).then(({ localModels }) => {
    port.postMessage({ type: 'INIT_STATE', localModels: localModels || {} });
    console.log(LOG, 'background: sent INIT_STATE to offscreen');
  });
  port.onDisconnect.addListener(() => {
    console.warn(LOG, 'background: offscreen port disconnected');
    offscreenPort = null;
    offscreenReady = null;
    for (const [, resolve] of portWaiters) {
      resolve({ error: 'Offscreen port disconnected' });
    }
    portWaiters.clear();
  });
});

async function hasOffscreenDocument() {
  if (!chrome.offscreen?.hasDocument) return false;
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    return contexts.length > 0;
  }
  return chrome.offscreen.hasDocument();
}

async function closeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) return;
  console.log(LOG, 'background: closing offscreen document');
  await chrome.offscreen.closeDocument();
  offscreenPort = null;
}

function postToOffscreen(action, payload = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    if (!offscreenPort) {
      reject(new Error('Offscreen port not connected'));
      return;
    }
    const requestId = `${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      portWaiters.delete(requestId);
      reject(new Error(`Offscreen request timed out (${action})`));
    }, timeoutMs);

    portWaiters.set(requestId, (msg) => {
      clearTimeout(timer);
      if (msg?.error) reject(new Error(msg.error));
      else resolve(msg);
    });

    console.log(LOG, 'background: port request →', requestId, action, payload);
    offscreenPort.postMessage({ requestId, action, ...payload });
  });
}

async function waitForOffscreenPort() {
  const deadline = Date.now() + OFFSCREEN_PORT_WAIT_MS;
  while (Date.now() < deadline) {
    if (offscreenPort) {
      try {
        const res = await postToOffscreen('PING', {}, 5000);
        if (res?.ok) {
          console.log(LOG, 'background: offscreen PING ok');
          return;
        }
      } catch (err) {
        console.warn(LOG, 'background: offscreen PING failed:', err.message);
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Local AI offscreen worker did not connect (reload extension and retry)');
}

export async function ensureOffscreen() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error('Local models require Chromium with offscreen document support');
  }
  if (offscreenPort) return;

  if (!offscreenReady) {
    offscreenReady = (async () => {
      const exists = await hasOffscreenDocument();
      console.log(LOG, 'background: ensureOffscreen, document exists?', exists, 'port?', !!offscreenPort);
      if (!exists) {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: ['WORKERS'],
          justification: 'Run downloaded local AI models for private on-device analysis',
        });
        logit('log', '[LOCAL_AI] Offscreen document created');
        console.log(LOG, 'background: offscreen document created');
      }
      await waitForOffscreenPort();
    })();
  }

  try {
    await offscreenReady;
  } catch (err) {
    console.error(LOG, 'background: ensureOffscreen failed:', err);
    offscreenReady = null;
    await closeOffscreenDocument();
    throw err;
  }

  if (!offscreenPort) {
    offscreenReady = null;
    throw new Error('Offscreen port not connected after setup');
  }
}

/**
 * @param {string} action
 * @param {Object} [payload]
 * @returns {Promise<Object>}
 */
export async function sendToOffscreen(action, payload = {}) {
  await ensureOffscreen();
  const timeoutMs = action === 'DOWNLOAD' ? 30_000 : 15_000;
  const res = await postToOffscreen(action, payload, timeoutMs);
  console.log(LOG, 'background: sendToOffscreen done', action, res);
  return res;
}

export async function closeOffscreenIfIdle() {
  if (!(await hasOffscreenDocument())) return;
  try {
    await sendToOffscreen('PING');
  } catch {
    await closeOffscreenDocument();
    offscreenReady = null;
  }
}
