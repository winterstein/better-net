/**
 * Unit tests for multi-file download progress aggregation.
 */

import { applyDownloadProgressEvent } from '../src/ai/download-progress.js';

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

const EST = 1000;

// initiate / download must not reset progress
{
  const files = new Map();
  assert(
    applyDownloadProgressEvent(files, { status: 'initiate', file: 'a.bin' }, EST) === null,
    'initiate should be ignored'
  );
  assert(
    applyDownloadProgressEvent(files, { status: 'download', file: 'a.bin' }, EST) === null,
    'download should be ignored'
  );
  assert(files.size === 0, 'ignored events should not register files');
}

// per-file progress alone would jump; catalog estimate keeps early files small
{
  const files = new Map();
  const p1 = applyDownloadProgressEvent(
    files,
    { status: 'progress', file: 'config.json', loaded: 100, total: 100, progress: 100 },
    EST
  );
  assert(p1 === 10, `small file vs estimate should be ~10%, got ${p1}`);

  applyDownloadProgressEvent(files, { status: 'done', file: 'config.json' }, EST);

  const p2 = applyDownloadProgressEvent(
    files,
    { status: 'progress', file: 'model.onnx', loaded: 0, total: 900, progress: 0 },
    EST
  );
  assert(p2 === 10, `new file at 0 should keep prior loaded share, got ${p2}`);

  const p3 = applyDownloadProgressEvent(
    files,
    { status: 'progress', file: 'model.onnx', loaded: 450, total: 900, progress: 50 },
    EST
  );
  assert(p3 === 55, `halfway through large file should be ~55%, got ${p3}`);

  const p4 = applyDownloadProgressEvent(
    files,
    { status: 'progress', file: 'model.onnx', loaded: 900, total: 900, progress: 100 },
    EST
  );
  assert(p4 === 99, `complete should cap at 99 before ready, got ${p4}`);
}

// without estimate, first completed file reads as 100 of known total — then new file lowers ratio
{
  const files = new Map();
  const a = applyDownloadProgressEvent(
    files,
    { status: 'progress', file: 'a.bin', loaded: 50, total: 50, progress: 100 },
    0
  );
  assert(a === 99, `single known file complete caps at 99, got ${a}`);
  const b = applyDownloadProgressEvent(
    files,
    { status: 'progress', file: 'b.bin', loaded: 0, total: 50, progress: 0 },
    0
  );
  assert(b === 50, `second file discovered should rebalance to 50%, got ${b}`);
}

console.log('✅ download-progress tests passed');
