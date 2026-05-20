/**
 * Integration test: download and run MobileBERT zero-shot (same model as offscreen).
 * Requires network on first run (~25 MB). Skip with BN_SKIP_MOBILEBERT=1.
 */

import { pipeline } from '@huggingface/transformers';
import { getLocalModel } from '../src/ai/model-catalog.js';

const SKIP = process.env.BN_SKIP_MOBILEBERT === '1';
const TIMEOUT_MS = Number(process.env.BN_MOBILEBERT_TIMEOUT_MS) || 600_000;

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

if (SKIP) {
  console.log('⏭️  Skipped mobilebert integration (BN_SKIP_MOBILEBERT=1)');
  process.exit(0);
}

const spec = getLocalModel('mobilebert-mnli');
assert(spec.id === 'mobilebert-mnli', 'catalog should resolve mobilebert-mnli');
assert(spec.pipeline === 'zero-shot-classification', 'mobilebert should be zero-shot');

const LABELS = [
  'neutral factual content',
  'biased or misleading content',
  'rage bait or outrage content',
];

const timer = setTimeout(() => {
  console.error(`Timed out after ${TIMEOUT_MS}ms (set BN_MOBILEBERT_TIMEOUT_MS to extend)`);
  process.exit(1);
}, TIMEOUT_MS);

console.log(`Loading ${spec.huggingFaceId} (${spec.pipeline})…`);

const pipe = await pipeline(spec.pipeline, spec.huggingFaceId, {
  progress_callback(progress) {
    if (progress?.progress != null) {
      console.log(`  ${progress.file || 'progress'}: ${Math.round(progress.progress)}%`);
    }
  },
});

console.log('Running zero-shot inference…');
const text =
  'Breaking: scientists announced a peer-reviewed breakthrough in renewable energy storage.';
const output = await pipe(text, LABELS, { multi_label: false });

clearTimeout(timer);

assert(Array.isArray(output?.labels) && output.labels.length > 0, 'expected labels array');
assert(Array.isArray(output?.scores) && output.scores.length > 0, 'expected scores array');
assert(output.labels.length === output.scores.length, 'labels and scores length mismatch');

const topLabel = output.labels[0];
const topScore = output.scores[0];
assert(typeof topLabel === 'string' && topLabel.length > 0, 'top label should be non-empty string');
assert(typeof topScore === 'number' && topScore > 0 && topScore <= 1, `invalid top score: ${topScore}`);

console.log('Top label:', topLabel, `(${(topScore * 100).toFixed(1)}%)`);
console.log('✅ mobilebert integration test passed (download + zero-shot inference)');
