/**
 * Unit tests for local model lifecycle status helpers.
 *
 * The case that matters: tearing down the worker must not throw away a downloaded model.
 * `initialising` covers both a post-download session build and a warm load of weights that
 * are already on disk, so the reset has to read `installed`, not the status alone.
 */

import {
  MODEL_STATUS,
  isBusyStatus,
  isInstalled,
  abandonedState,
} from '../src/ai/model-status.js';

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

// busy covers both phases, and the pre-split status still stored on disk
assert(isBusyStatus(MODEL_STATUS.DOWNLOADING), 'downloading is busy');
assert(isBusyStatus(MODEL_STATUS.INITIALISING), 'initialising is busy');
assert(isBusyStatus('loading'), 'legacy loading status is still treated as busy');
assert(!isBusyStatus(MODEL_STATUS.READY), 'ready is not busy');
assert(!isBusyStatus(undefined), 'missing status is not busy');

// installed: the flag is authoritative, ready covers state written before the flag existed
assert(isInstalled({ status: MODEL_STATUS.READY }), 'ready implies installed');
assert(isInstalled({ status: MODEL_STATUS.ERROR, installed: true }), 'flag survives an error');
assert(!isInstalled({ status: MODEL_STATUS.DOWNLOADING }), 'a download in flight is not installed');
assert(!isInstalled(undefined), 'no state is not installed');

// a warm load that gets torn down goes back to ready — the weights never left the cache
const warm = abandonedState({ status: MODEL_STATUS.INITIALISING, installed: true, progress: 100 });
assert(warm.status === MODEL_STATUS.READY, `warm load should revert to ready, got ${warm.status}`);
assert(warm.installed === true, 'warm load should stay installed');
assert(warm.error === undefined, 'warm load should clear any error');

// an abandoned download has incomplete bytes, so it starts over
const partial = abandonedState({ status: MODEL_STATUS.DOWNLOADING, progress: 42 });
assert(
  partial.status === MODEL_STATUS.NOT_INSTALLED,
  `abandoned download should reset, got ${partial.status}`
);
assert(partial.progress === 0, 'abandoned download should reset progress');
assert(partial.installed === false, 'abandoned download is not installed');

console.log('✅ model-status tests passed');
