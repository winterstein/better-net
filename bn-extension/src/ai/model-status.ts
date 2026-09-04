/**
 * Local model lifecycle status, shared by the inference worker, the offscreen proxy,
 * the background model-manager and the Settings UI.
 *
 * `downloading` and `initialising` were one `loading` status. Separating them lets a
 * teardown tell "bytes are still missing, start over" from "the weights are on disk and
 * only the in-memory ONNX session was lost, keep the download". Conflating the two made
 * Clear runtime memory mark a fully-downloaded model as Not downloaded.
 */

export const MODEL_STATUS = {
  NOT_INSTALLED: 'not_installed',
  /** Fetching weights. */
  DOWNLOADING: 'downloading',
  /** Weights are local; building the ONNX session (after a download, or a warm load). */
  INITIALISING: 'initialising',
  /** Weights on disk, usable. Not the same as resident in memory. */
  READY: 'ready',
  ERROR: 'error',
} as const;

export type ModelStatus = (typeof MODEL_STATUS)[keyof typeof MODEL_STATUS];

export interface LocalModelState {
  status?: string;
  progress?: number;
  error?: string;
  /** Weights are on disk. Survives a teardown that only clears the in-memory session. */
  installed?: boolean;
}

/** Pre-split state used `loading` for both phases; stored state outlives an update. */
const LEGACY_LOADING = 'loading';

/** Work is in flight that tearing down the offscreen document would abandon. */
export function isBusyStatus(status?: string): boolean {
  return (
    status === MODEL_STATUS.DOWNLOADING ||
    status === MODEL_STATUS.INITIALISING ||
    status === LEGACY_LOADING
  );
}

/** Weights are on disk. `installed` is authoritative; `ready` covers pre-flag state. */
export function isInstalled(state?: LocalModelState | null): boolean {
  return state?.installed === true || state?.status === MODEL_STATUS.READY;
}

/**
 * What a busy model becomes when its worker is torn down. An installed model goes back to
 * ready — the session is gone but the download is not, and re-downloading weights that
 * never left the cache is the bug this avoids.
 */
export function abandonedState(state?: LocalModelState | null): LocalModelState {
  return isInstalled(state)
    ? { ...state, status: MODEL_STATUS.READY, progress: 100, error: undefined }
    : { status: MODEL_STATUS.NOT_INSTALLED, progress: 0, error: undefined, installed: false };
}
