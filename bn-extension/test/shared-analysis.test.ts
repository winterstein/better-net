/**
 * Shared analysis, extension side (bn-server/specs/shared-analysis): when a request is
 * made at all, what it carries, how the engine uses a hit, and what private content
 * switches off. Server behaviour is bn-server/test/test_shared_analysis.ts.
 */

import assert from 'node:assert/strict';
import { installChromeMock } from './helpers/chrome-mock.js';
import { getShareId, openSharedAnalysis } from '../src/sharing/shared-analysis-client.js';
import { isMarkedPrivate, markPrivate } from '../src/sharing/private-pages.js';
import { FEEDBACK_QUEUE_KEY, dropQueuedFeedbackForPage } from '../src/feedback/feedback-client.js';
import { NO_TRACE, setTracerImpl } from '../src/tracing/tracer-hook.js';
import { defaultCacheKey } from '../src/analysis/cache-key.js';

installChromeMock();

const SERVER = 'https://server.test';
const ON = { useServerCache: true, serverEndpoint: SERVER };
const PAGE = { url: 'https://news.example.com/story?utm_source=x#top' };

/** A fetch that records every call and answers from `routes`. */
function fakeServer(lookupResults: unknown[] = [], opts: { down?: boolean } = {}) {
  const calls: { url: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (opts.down) throw new Error('offline');
    const json = String(url).endsWith('/site-lists')
      ? { list: [{ pattern: 'blocked.example.org', kind: 'block' }, { pattern: 'x.com/messages', kind: 'private' }] }
      : String(url).endsWith('/lookup')
        ? { results: lookupResults }
        : { stored: 1 };
    return { ok: true, status: 200, json: async () => json } as Response;
  }) as typeof fetch;
  const to = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix));
  return { fetchImpl, calls, to };
}

const verdict = { problemScore: 'medium' as const, confidence: 0.8, tags: [], explanation: 'from the server' };

// --- no opt-in, no request ---
{
  const server = fakeServer();
  assert.equal(await openSharedAnalysis(PAGE, { useServerCache: false, serverEndpoint: SERVER }, server.fetchImpl), null);
  assert.equal(await openSharedAnalysis(PAGE, { useServerCache: true, serverEndpoint: '' }, server.fetchImpl), null);
  assert.equal(server.calls.length, 0, 'sharing off makes no network call at all');
}

// --- unsuitable pages: the list is fetched once, the page is never sent ---
{
  const server = fakeServer();
  const type = (value: string) => ({ value, confidence: 0.9, source: 'test' }) as any;
  for (const page of [
    { url: 'https://news.example.com/login', pageType: type('login') },
    { url: 'https://www.google.com/search?q=x', pageType: type('search_results') },
    { url: 'https://news.example.com/a', siteType: type('adult') },
    { url: 'https://news.example.com/a', private: true },
    { url: 'https://blocked.example.org/a' },
    { url: 'https://x.com/messages/1' },
    { url: 'http://localhost:8080/a' },
  ]) {
    assert.equal(await openSharedAnalysis(page, ON, server.fetchImpl), null, JSON.stringify(page));
  }
  assert.equal(server.to('/lookup').length, 0);
  assert.equal(server.to('/site-lists').length, 1, 'the site list is cached, not fetched per page');
}

// --- lookup, the rank rule, and upload ---
{
  const server = fakeServer([
    { featureId: 'biasDetector', chunkKey: 'key-1', model: 'gpt-4o-mini', result: verdict },
  ]);
  const share = await openSharedAnalysis(PAGE, ON, server.fetchImpl);
  assert.ok(share);
  assert.deepEqual(server.to('/lookup')[0].body, { url: 'https://news.example.com/story' }, 'only the normalised url is sent');

  assert.equal(share.get('biasDetector', 'key-1', 'flan-t5-small')?.explanation, 'from the server');
  assert.equal(share.get('biasDetector', 'key-1', 'gpt-4o-mini')?.model, 'gpt-4o-mini', 'an equal model is good enough');
  assert.equal(share.get('biasDetector', 'key-1', 'gpt-4o'), undefined, 'a weaker model than mine is not used');
  assert.equal(share.get('factChecker', 'key-1', ''), undefined, 'hits are per feature');

  assert.equal(await share.upload(), 0);
  assert.equal(server.to('/api/shared-analysis').length, 0, 'nothing queued, nothing sent');

  share.add('biasDetector', 'key-2', 'gpt-4o', { ...verdict, explanation: 'fresh' });
  assert.equal(await share.upload(), 1);
  const sent = server.to('/api/shared-analysis')[0].body;
  assert.equal(sent.url, 'https://news.example.com/story');
  assert.equal(sent.shareId, await getShareId());
  assert.deepEqual(sent.results, [{ featureId: 'biasDetector', chunkKey: 'key-2', model: 'gpt-4o', result: { ...verdict, explanation: 'fresh' } }]);
  assert.equal(await share.upload(), 0, 'a result is uploaded once');
}

// --- server down: analysis carries on, uploads are dropped ---
{
  const server = fakeServer([], { down: true });
  const share = await openSharedAnalysis(PAGE, ON, server.fetchImpl);
  assert.ok(share, 'a failed lookup still returns a usable object');
  assert.equal(share.get('biasDetector', 'key-1', ''), undefined);
  share.add('biasDetector', 'key-2', 'gpt-4o', verdict);
  assert.equal(await share.upload(), 0);
}

// --- share id: stable within a month, new the next, and not the feedback id ---
{
  const june = await getShareId(new Date('2026-06-03T00:00:00Z'));
  assert.equal(await getShareId(new Date('2026-06-28T00:00:00Z')), june);
  assert.notEqual(await getShareId(new Date('2026-07-01T00:00:00Z')), june);
  const { bnDeviceId } = await chrome.storage.local.get('bnDeviceId');
  assert.equal(bnDeviceId, undefined, 'sharing never creates the feedback local id');
}

// --- engine ---

const { ANALYSIS_MODULES } = await import('../src/features/registry.js');
let calls = 0;
let seenOptions: any = null;
ANALYSIS_MODULES.length = 0;
ANALYSIS_MODULES.push({
  id: 'stub',
  name: 'stub',
  analyze: async (_chunk, _page, options) => {
    calls += 1;
    seenOptions = options;
    return { id: 'local-id', problemScore: 'low', confidence: 1, tags: [], explanation: 'analysed here', model: options.mode === 'heuristic' ? '' : 'gpt-4o' };
  },
} as any);
const { analyzeChunksParallel } = await import('../src/analysis/engine.js');

let n = 0;
const chunk = (tags: string[] = ['chunk-type:article']) => {
  n += 1;
  return { id: `c${n}`, xpath: `/div[${n}]`, text: `Paragraph number ${n} of the story.`, url: PAGE.url, fingerprint: `fp${n}`, tags };
};
/** A stand-in for the object openSharedAnalysis returns, holding what the engine did with it. */
function fakeShare(hits: Record<string, { model: string; result: any }> = {}) {
  const added: any[] = [];
  const asked: string[] = [];
  return {
    added,
    asked,
    get(featureId: string, chunkKey: string, myModel: string) {
      asked.push(chunkKey);
      return hits[chunkKey]?.result;
    },
    add(featureId: string, chunkKey: string, model: string, result: any) {
      added.push({ featureId, chunkKey, model, result });
    },
  };
}
const base = { enabledFeatures: ['stub'], mode: 'openai' as const, config: { model: 'gpt-4o' } };

// A shared hit skips the analysis, is marked, and is not uploaded back.
{
  const c = chunk();
  const key = defaultCacheKey(c);
  const share = fakeShare({ [key]: { model: 'gpt-4o', result: verdict } });
  const before = calls;
  const [analysis] = await analyzeChunksParallel([c], PAGE, { ...base, shared: share });
  assert.equal(calls, before, 'the feature did not run');
  assert.equal(analysis.analyses[0].explanation, 'from the server');
  assert.equal((analysis.analyses[0].metadata as any).shared, true);
  assert.equal(share.added.length, 0, 'a result that came from the server is not sent back');

  // It is now in the local cache: the next view does not ask the server again.
  const again = fakeShare();
  await analyzeChunksParallel([{ ...c, xpath: '/elsewhere' }], PAGE, { ...base, shared: again });
  assert.equal(calls, before);
  assert.deepEqual(again.asked, []);
  assert.equal(again.added.length, 0);
}

// A miss runs the feature and queues the result, without per-user fields.
{
  const c = chunk();
  const share = fakeShare();
  const before = calls;
  await analyzeChunksParallel([c], PAGE, { ...base, shared: share });
  assert.equal(calls, before + 1);
  assert.equal(share.added.length, 1);
  assert.equal(share.added[0].chunkKey, defaultCacheKey(c));
  assert.equal(share.added[0].model, 'gpt-4o');
  assert.equal(share.added[0].result.explanation, 'analysed here');
  assert.ok(!('id' in share.added[0].result) && !('spanId' in share.added[0].result));
  assert.ok(!JSON.stringify(share.added).includes('Paragraph number'), 'no chunk text in the upload');
}

// Heuristic results are never queued.
{
  const share = fakeShare();
  await analyzeChunksParallel([chunk()], PAGE, { ...base, mode: 'heuristic', config: {}, shared: share });
  assert.equal(share.added.length, 0);
}

// An excluded chunk role is neither looked up nor uploaded.
{
  const share = fakeShare();
  await analyzeChunksParallel([chunk(['chunk-type:sidebar'])], PAGE, { ...base, shared: share });
  assert.deepEqual(share.asked, []);
  assert.equal(share.added.length, 0);
}

// --- private: no sharing, no trace, local model only ---

const spans: { name: string; parent: unknown }[] = [];
setTracerImpl({
  startSpan(name, opts) {
    const handle = { span: { name } };
    spans.push({ name, parent: opts.parent });
    return handle;
  },
  endSpan() {},
  setAttributes() {},
  recordSteps() {},
  ids: () => ({ traceId: 't', spanId: 's' }),
});

{
  const share = fakeShare();
  const [analysis] = await analyzeChunksParallel(
    [chunk(['chunk-type:post', 'private'])],
    PAGE,
    { ...base, config: { model: 'gpt-4o', googleFactCheckKey: 'g-key' }, shared: share }
  );
  assert.deepEqual(share.asked, []);
  assert.equal(share.added.length, 0, 'a private chunk is not shared');
  assert.equal(spans.length, 0, 'a private chunk opens no span, and no new root trace either');
  assert.equal(seenOptions.trace, NO_TRACE);
  assert.equal(analysis.traceId, undefined);
  assert.equal(seenOptions.mode, 'local', 'a remote provider is swapped for the local model');
  assert.equal(seenOptions.config.googleFactCheckKey, undefined, 'and the Google fact-check call is off');

  // Settings -> AI Model -> "Private content: local models only" switched off.
  await analyzeChunksParallel([chunk(['chunk-type:post', 'private'])], PAGE, { ...base, shared: share, privateLocalOnly: false });
  assert.equal(seenOptions.mode, 'openai');
  assert.equal(spans.length, 0, 'still untraced');
  assert.equal(share.added.length, 0, 'still not shared');
}

// A private page makes every chunk private.
{
  const share = fakeShare();
  await analyzeChunksParallel([chunk()], { ...PAGE, private: true }, { ...base, shared: share });
  assert.equal(spans.length, 0);
  assert.equal(share.added.length, 0);
  assert.equal(seenOptions.mode, 'local');
}

// An ordinary chunk beside them is traced as usual.
{
  await analyzeChunksParallel([chunk()], PAGE, base);
  assert.ok(spans.some((s) => s.name === 'betternet.analyze_chunk'));
  assert.equal(seenOptions.mode, 'openai');
}
setTracerImpl(null);

// --- marking a page private: stored locally, and queued feedback about it is dropped ---
{
  const url = 'https://forum.example.com/thread/9?page=2';
  assert.equal(await isMarkedPrivate(url), false);
  await chrome.storage.local.set({
    [FEEDBACK_QUEUE_KEY]: [
      { localId: 'a', pageUrl: 'https://forum.example.com/thread/9' },
      { localId: 'b', chunkUrl: url },
      { localId: 'c', pageUrl: 'https://forum.example.com/thread/10' },
    ],
  });
  await markPrivate(url);
  await dropQueuedFeedbackForPage(url);
  assert.equal(await isMarkedPrivate('https://forum.example.com/thread/9'), true, 'the mark ignores the query string');
  assert.equal(await isMarkedPrivate('https://forum.example.com/thread/10'), false);
  const { [FEEDBACK_QUEUE_KEY]: left } = await chrome.storage.local.get(FEEDBACK_QUEUE_KEY);
  assert.deepEqual(left.map((f) => f.localId), ['c']);
}

console.log('shared-analysis tests OK');
