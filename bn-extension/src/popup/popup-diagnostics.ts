/**
 * Popup diagnostics — timestamped console logging and per-step timeouts.
 *
 * The Toolbar Badge -> Popup path has been unreliable (blank popups, long
 * spinner stalls, clicks that appear to do nothing). Every async call the
 * popup makes on open goes through `runStep`, so a slow or failed call shows
 * up in the console with a duration instead of silently stalling the UI.
 */

import { logit } from '../utils/logger.js';

const PREFIX = '[BetterNet][popup]';

export interface StepResult<T> {
  /** True when the call resolved before the timeout. */
  ok: boolean;
  value: T | null;
  error: unknown;
  timedOut: boolean;
  ms: number;
}

export interface PopupLog {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Milliseconds since the popup script started. */
  sinceOpen(): number;
}

type Sink = Pick<Console, 'debug' | 'log' | 'warn' | 'error'>;

const gatedSink: Sink = {
  debug: (...args) => logit('debug', ...args),
  log: (...args) => logit('log', ...args),
  warn: (...args) => logit('warn', ...args),
  error: (...args) => logit('error', ...args),
};

/** Logger whose every line carries ms-since-popup-open, so stalls are obvious. */
export function createPopupLog(
  sink: Sink = gatedSink,
  now: () => number = () => Date.now()
): PopupLog {
  const t0 = now();
  const stamp = () => `${PREFIX} +${now() - t0}ms`;
  return {
    debug: (...args) => sink.debug(stamp(), ...args),
    info: (...args) => sink.log(stamp(), ...args),
    warn: (...args) => sink.warn(stamp(), ...args),
    error: (...args) => sink.error(stamp(), ...args),
    sinceOpen: () => now() - t0,
  };
}

/**
 * Run one startup step with a timeout. Never rejects — the popup must keep
 * rendering even when a chrome.* call hangs or the service worker is asleep.
 */
export async function runStep<T>(
  name: string,
  fn: () => Promise<T> | T,
  timeoutMs: number,
  log: PopupLog,
  now: () => number = () => Date.now()
): Promise<StepResult<T>> {
  const started = now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<'__bn_timeout__'>((resolve) => {
    timer = setTimeout(() => resolve('__bn_timeout__'), timeoutMs);
  });

  try {
    const outcome = await Promise.race([Promise.resolve().then(fn), timeout]);
    const ms = now() - started;

    if (outcome === '__bn_timeout__') {
      log.warn(`step "${name}" TIMED OUT after ${timeoutMs}ms`);
      return { ok: false, value: null, error: null, timedOut: true, ms };
    }

    log.debug(`step "${name}" ok in ${ms}ms`);
    return { ok: true, value: outcome as T, error: null, timedOut: false, ms };
  } catch (error) {
    const ms = now() - started;
    log.error(`step "${name}" FAILED after ${ms}ms:`, error);
    return { ok: false, value: null, error, timedOut: false, ms };
  } finally {
    clearTimeout(timer);
  }
}
