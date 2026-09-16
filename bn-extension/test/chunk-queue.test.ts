/**
 * Streaming chunk queue (src/analysis/engine.ts createChunkQueue): the worker pool the
 * background runs a page through. It has to take chunks while it is running, because the
 * page releases them as the reader scrolls (content/chunk-scheduler.ts).
 *
 * The features are stubbed through the registry so the test is about queueing, not analysis.
 */

import assert from 'node:assert/strict';

const { ANALYSIS_MODULES } = await import('../src/features/registry.js');

/** One slow feature, so concurrency is observable. Restored by the process exiting. */
const gates: ((v?: unknown) => void)[] = [];
let active = 0;
let maxActive = 0;
ANALYSIS_MODULES.length = 0;
ANALYSIS_MODULES.push({
  id: 'factChecker',
  name: 'stub',
  analyze: async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => gates.push(resolve));
    active -= 1;
    return { problemScore: 'low', confidence: 1, tags: [], explanation: 'stub' };
  },
} as any);

const { createChunkQueue, analyzeChunksParallel } = await import('../src/analysis/engine.js');

const chunk = (n: number) => ({
  id: `c${n}`,
  xpath: `/html/body/div[${n}]`,
  text: `chunk ${n}`,
  url: 'https://example.com/',
  fingerprint: `f${n}`,
});

/** Let every waiting analysis finish, and give the pool a turn to refill. */
async function releaseAll() {
  while (gates.length) gates.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// --- concurrency is capped, and counts report what is happening ---

{
  const seen: string[] = [];
  const queue = createChunkQueue({ url: 'https://example.com/' }, { maxConcurrency: 2 }, (c) =>
    seen.push(c.id)
  );
  queue.add([chunk(1), chunk(2), chunk(3)]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(maxActive, 2, 'never more than maxConcurrency chunks in flight');
  assert.deepEqual(queue.counts(), { queued: 1, active: 2, done: 0 });

  const idle = queue.idle();
  await releaseAll();
  await releaseAll();
  await idle;

  assert.deepEqual(seen.sort(), ['c1', 'c2', 'c3'], 'every chunk is analysed once');
  assert.equal(queue.counts().done, 3);
  assert.equal(queue.results().length, 3);
}

// --- chunks added while the queue runs join it, and idle() waits for them ---

{
  maxActive = 0;
  const queue = createChunkQueue({ url: 'https://example.com/' }, { maxConcurrency: 1 });
  queue.add([chunk(1)]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The reader scrolls: a chunk arrives with one already in flight.
  queue.add([chunk(2)]);
  assert.deepEqual(queue.counts(), { queued: 1, active: 1, done: 0 });

  const idle = queue.idle();
  await releaseAll();
  await releaseAll();
  await idle;

  assert.equal(queue.counts().done, 2, 'idle() covers work added after it was called');
  assert.deepEqual(
    queue.results().map((r) => r.chunkId),
    ['c1', 'c2'],
    'results keep the order the chunks were added in, which is the priority order'
  );

  // Re-awaiting an idle queue resolves at once, and it can be used again afterwards.
  await queue.idle();
  queue.add([chunk(3)]);
  const again = queue.idle();
  await releaseAll();
  await again;
  assert.equal(queue.counts().done, 3);
}

// --- analyzeChunksParallel still analyses a fixed set of chunks ---

{
  const chunks = [chunk(1), chunk(2)];
  const pending = analyzeChunksParallel(chunks as any, { url: 'https://example.com/' }, {
    maxConcurrency: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await releaseAll();
  const results = await pending;
  assert.equal(results.length, 2);
  assert.equal(results[0].analyses.length, 1, 'the stubbed feature ran for each chunk');
}

console.log('✅ chunk-queue tests passed');
