/**
 * Aggregate Hugging Face / transformers.js multi-file download progress.
 *
 * Their progress_callback fires per file (initiate → download → progress → done).
 * Using a single file's `progress` (or treating missing progress as 0) makes the
 * UI jump up and down — especially with a partial browser cache.
 */

export type FileByteProgress = { loaded: number; total: number; done?: boolean };

export type ProgressEventLike = {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
};

/** Apply one callback event; returns overall 0–99, or null if nothing to display. */
export function applyDownloadProgressEvent(
  files: Map<string, FileByteProgress>,
  event: ProgressEventLike | null | undefined,
  estimatedTotalBytes = 0
): number | null {
  if (!event?.file) return null;

  if (event.status === 'progress' && event.total != null && event.total > 0) {
    files.set(event.file, {
      loaded: Math.max(0, event.loaded ?? 0),
      total: event.total,
      done: false,
    });
  } else if (event.status === 'done') {
    const prev = files.get(event.file);
    if (prev && prev.total > 0) {
      files.set(event.file, { loaded: prev.total, total: prev.total, done: true });
    } else {
      return null;
    }
  } else {
    // initiate / download / ready — no byte update
    return null;
  }

  let loaded = 0;
  let knownTotal = 0;
  for (const f of files.values()) {
    loaded += f.loaded;
    knownTotal += f.total;
  }
  if (loaded <= 0 && knownTotal <= 0) return null;

  // Prefer catalog estimate so small early files (config.json) don't read as 100%.
  const denom = Math.max(estimatedTotalBytes, knownTotal, 1);
  return Math.min(99, Math.round((100 * loaded) / denom));
}

/**
 * Every file we have seen bytes for has finished. Used with the byte percentage to tell
 * "downloads are over, the session is initialising" from "still fetching".
 *
 * Not a perfect end-of-download signal: transformers.js announces files as it reaches
 * them, so between one file finishing and the next starting this reads true. Pairing it
 * with a near-complete byte count keeps that window to milliseconds.
 */
export function allFilesDone(files: Map<string, FileByteProgress>): boolean {
  if (files.size === 0) return false;
  for (const f of files.values()) {
    if (!f.done) return false;
  }
  return true;
}
