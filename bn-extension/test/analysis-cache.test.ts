/**
 * Client analysis cache (specs/cache/spec.md): keys, eviction, storage, and the engine
 * skipping a feature it has already analysed.
 */

import assert from 'node:assert/strict';
import { defaultCacheKey } from '../src/analysis/cache-key.js';
import { LocalAnalysisCache } from '../src/analysis/analysis-cache.js';
import type { CacheStorage } from '../src/analysis/analysis-cache.js';
import { factcheckCacheKey, normalizeClaimText } from '../src/features/fact-checker/factcheck-cache-key.js';

const claimA = 'Studies show the vaccine is safe and effective for adults.';
const claimB = 'Studies showed that vaccines are safe and effective for adults!';

assert.equal(normalizeClaimText(claimA), normalizeClaimText(claimB));
assert.equal(factcheckCacheKey({ text: claimA }), factcheckCacheKey({ text: claimB }));
assert.notEqual(
  factcheckCacheKey({ text: claimA }),
  factcheckCacheKey({ text: 'Studies show the vaccine is not safe and effective for adults.' })
);
assert.notEqual(
  factcheckCacheKey({ text: claimA }),
  factcheckCacheKey({ text: 'Studies show the bridge is safe and effective for adults.' })
);

// Position is not part of the key. A different link is.
const body = { text: 'The same paragraph.', title: 'Headline' };
assert.equal(
  defaultCacheKey({ ...body, xpath: '/html/body/div[1]' }),
  defaultCacheKey({ ...body, xpath: '/html/body/div[9]', text: '  The   same paragraph. ' })
);
assert.notEqual(
  defaultCacheKey(body),
  defaultCacheKey({ ...body, primaryLink: { url: 'https://example.com/other' } })
);
assert.notEqual(defaultCacheKey(body), defaultCacheKey({ ...body, text: 'A different paragraph.' }));

function memoryStorage(): CacheStorage & { saved: Record<string, unknown> } {
  const saved: Record<string, unknown> = {};
  return {
    saved,
    async get(key: string) {
      return { [key]: saved[key] };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(saved, items);
    },
  };
}

const result = { problemScore: 'low' as const, confidence: 1, tags: [], explanation: 'kept' };

{
  const cache = new LocalAnalysisCache(2, null);
  await cache.set('factChecker', 'a', { ...result, explanation: 'a' });
  await cache.set('factChecker', 'b', { ...result, explanation: 'b' });
  await cache.set('factChecker', 'c', { ...result, explanation: 'c' });
  assert.equal(await cache.get('factChecker', 'a'), undefined, 'oldest entry is dropped past the cap');
  // Reading b makes it the newest, so the next insert drops c rather than b.
  assert.equal((await cache.get('factChecker', 'b'))?.explanation, 'b');
  await cache.set('factChecker', 'd', { ...result, explanation: 'd' });
  assert.equal(await cache.get('factChecker', 'c'), undefined);
  assert.equal((await cache.get('factChecker', 'b'))?.explanation, 'b');
}

{
  const cache = new LocalAnalysisCache(10, null);
  await cache.set('factChecker', 'b', result);
  await cache.set('biasDetector', 'b', { ...result, explanation: 'bias' });
  assert.equal((await cache.get('factChecker', 'b'))?.explanation, 'kept');
  assert.equal((await cache.get('biasDetector', 'b'))?.explanation, 'bias');
  await cache.set('factChecker', 'e', { ...result, error: 'nope', explanation: 'failed' });
  assert.equal(await cache.get('factChecker', 'e'), undefined, 'a failure is not stored');
}

{
  const storage = memoryStorage();
  const first = new LocalAnalysisCache(10, storage);
  await first.set('factChecker', 'k', result);
  await first.flush();
  const second = new LocalAnalysisCache(10, storage);
  assert.equal((await second.get('factChecker', 'k'))?.explanation, 'kept');
  const hit = await second.get('factChecker', 'k');
  hit.explanation = 'mutated';
  assert.equal((await second.get('factChecker', 'k'))?.explanation, 'kept', 'callers cannot edit a stored result');
}

// --- engine: a second view of the same text does not call the feature again ---

const { ANALYSIS_MODULES } = await import('../src/features/registry.js');
let calls = 0;
let fail = false;
ANALYSIS_MODULES.length = 0;
ANALYSIS_MODULES.push({
  id: 'stub',
  name: 'stub',
  analyze: async () => {
    calls += 1;
    if (fail) return { error: 'nope', problemScore: 'low', confidence: 0, tags: [] };
    return { problemScore: 'low', confidence: 1, tags: [], explanation: 'ok' };
  },
} as any);

const { analyzeChunksParallel } = await import('../src/analysis/engine.js');

const chunk = (text: string, xpath: string) => ({
  id: xpath,
  xpath,
  text,
  url: 'https://example.com/a',
  fingerprint: 'fp',
  tags: [],
});

const options = { enabledFeatures: ['stub'] };
await analyzeChunksParallel([chunk('Same words here.', '/div[1]')], {}, options);
await analyzeChunksParallel([chunk('Same words here.', '/div[4]')], {}, options);
assert.equal(calls, 1, 'reload with a new xpath reuses the cached feature result');

await analyzeChunksParallel([chunk('Different words here.', '/div[5]')], {}, options);
assert.equal(calls, 2);

fail = true;
await analyzeChunksParallel([chunk('This one fails.', '/div[6]')], {}, options);
await analyzeChunksParallel([chunk('This one fails.', '/div[7]')], {}, options);
assert.equal(calls, 4, 'a failed analysis is run again');

fail = false;
const beforeMode = calls;
await analyzeChunksParallel([chunk('Mode specific text.', '/div[8]')], {}, { ...options, mode: 'local' });
await analyzeChunksParallel([chunk('Mode specific text.', '/div[9]')], {}, { ...options, mode: 'openai' });
assert.equal(calls, beforeMode + 2, 'a different analysis mode does not reuse the stored result');

let skipped = 0;
ANALYSIS_MODULES[0].analyze = async () => {
  skipped += 1;
  return {
    problemScore: 'low',
    confidence: 0,
    tags: [],
    explanation: 'no model',
    metadata: { localModelSkipped: 'no_backend' },
  };
};
await analyzeChunksParallel([chunk('Waiting for a model.', '/div[10]')], {}, options);
await analyzeChunksParallel([chunk('Waiting for a model.', '/div[11]')], {}, options);
assert.equal(skipped, 2, 'a model-missing fallback is not cached');

let llmCalls = 0;
ANALYSIS_MODULES[0].analyze = async () => {
  llmCalls += 1;
  return {
    problemScore: 'medium',
    confidence: 0.7,
    tags: ['suspect-claim'],
    explanation: 'General knowledge: a claim looks suspect.',
    metadata: { diagnostic: 'llm_general_knowledge' },
  };
};
await analyzeChunksParallel([chunk('The vaccine is safe for adults today.', '/f1')], {}, options);
await analyzeChunksParallel([chunk('The vaccine is safe for adults today.', '/f2')], {}, options);
assert.equal(llmCalls, 1, 'a fact-check LLM verdict is cached');

let missCalls = 0;
ANALYSIS_MODULES[0].analyze = async () => {
  missCalls += 1;
  return {
    problemScore: 'low',
    confidence: 0.3,
    tags: [],
    explanation: 'Checked 1 claim; none have been fact-checked.',
    metadata: { diagnostic: 'no_fact_checks_found' },
  };
};
await analyzeChunksParallel([chunk('Another claim nobody published.', '/f3')], {}, options);
await analyzeChunksParallel([chunk('Another claim nobody published.', '/f4')], {}, options);
assert.equal(missCalls, 2, 'a Google miss left after a heuristic fallback is not cached');

let offCalls = 0;
ANALYSIS_MODULES[0].analyze = async () => {
  offCalls += 1;
  return { problemScore: 'low', confidence: 1, tags: [], explanation: 'fresh' };
};
const off = { ...options, useLocalCache: false };
await analyzeChunksParallel([chunk('Cache switched off.', '/off1')], {}, off);
await analyzeChunksParallel([chunk('Cache switched off.', '/off2')], {}, off);
assert.equal(offCalls, 2, 'Use local cache off runs the feature every time');

console.log('analysis-cache tests OK');
