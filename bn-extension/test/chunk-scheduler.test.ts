/**
 * Chunk scheduling (src/content/chunk-scheduler.ts): priority order, and holding back
 * chunks that are off screen until they scroll into view.
 *
 * jsdom does no layout and has no IntersectionObserver, so both are supplied here: the
 * measurements come from the injected `measure`, and the observer is a fake whose callback
 * this test fires to stand in for a scroll.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
     <main>
       <article id="lead"><h2>Lead story</h2></article>
       <article id="second"><h2>Second story</h2></article>
       <article id="below"><h2>Below the fold</h2></article>
       <article id="far"><h2>Far below</h2></article>
     </main>
   </body></html>`,
  { url: 'https://example.com/' }
);

/** One observer per test run is enough: the module creates it at schedule time. */
class FakeIntersectionObserver {
  static last: FakeIntersectionObserver | null = null;
  observed: Element[] = [];
  disconnected = false;
  constructor(public callback: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
    FakeIntersectionObserver.last = this;
  }
  observe(el: Element) { this.observed.push(el); }
  unobserve(el: Element) { this.observed = this.observed.filter((o) => o !== el); }
  disconnect() { this.disconnected = true; this.observed = []; }
  /** Stand in for a scroll bringing `selector` into view. */
  scrollTo(selector: string) {
    const target = dom.window.document.querySelector(selector);
    this.callback([{ target, isIntersecting: true }]);
  }
}

Object.assign(globalThis as any, {
  window: dom.window,
  document: dom.window.document,
  Node: dom.window.Node,
  XPathResult: dom.window.XPathResult,
  IntersectionObserver: FakeIntersectionObserver,
});
(dom.window as any).scrollY = 0;
(dom.window as any).innerHeight = 800;

const { planChunks, chunkPriority, scheduleDeferredChunks, measureChunk } = await import(
  '../src/content/chunk-scheduler.js'
);

const chunk = (id: string, text: string) => ({
  id,
  xpath: `/html/body/main/article[@id="${id}"]`,
  text,
  url: 'https://example.com/',
  fingerprint: id,
});

// Page layout: two stories on screen, two below the fold (viewport 800, margin 600).
const tops: Record<string, number> = { lead: 100, second: 500, below: 1800, far: 4000 };
const measure = (c: any) => ({
  element: dom.window.document.getElementById(c.id),
  top: tops[c.id],
  height: 200,
  textLength: c.text.length,
});

// --- priority: bigger and higher up first ---

{
  const long = chunkPriority(4000, 0, 800);
  const short = chunkPriority(400, 0, 800);
  assert.ok(long > short, 'a long article outranks a short teaser at the same height');

  const top = chunkPriority(1000, 0, 800);
  const lower = chunkPriority(1000, 2400, 800);
  assert.ok(top > lower, 'between equals, the one higher up the page goes first');

  // Length matters, but not enough to send a huge chunk at the bottom of the page first.
  assert.ok(chunkPriority(600, 0, 800) > chunkPriority(6000, 8000, 800));
}

// --- planChunks: on screen first, then priority, and the rest deferred ---

{
  const chunks = [
    chunk('second', 'b'.repeat(600)),
    chunk('below', 'c'.repeat(5000)),
    chunk('lead', 'a'.repeat(4000)),
    chunk('far', 'd'.repeat(300)),
  ];
  const plan = planChunks(chunks as any, { measure, viewportHeight: 800 });

  assert.deepEqual(
    plan.ordered.map((c: any) => c.id),
    ['lead', 'second', 'below', 'far'],
    'on-screen chunks first (lead before second: bigger), then the deferred ones by priority'
  );
  assert.equal(plan.analyseNow, 2, 'only the two on-screen chunks are analysed now');
  assert.deepEqual(plan.deferred.map((c: any) => c.id), ['below', 'far']);
}

// --- gating off: whole page at once, still in priority order ---

{
  const chunks = [chunk('below', 'c'.repeat(5000)), chunk('lead', 'a'.repeat(4000))];
  const plan = planChunks(chunks as any, { measure, gate: false, viewportHeight: 800 });
  assert.equal(plan.analyseNow, 2);
  assert.deepEqual(plan.deferred, []);
  assert.deepEqual(plan.ordered.map((c: any) => c.id), ['lead', 'below']);
}

// --- a chunk with no element on the page is never held back ---

{
  const orphan = { id: 'gone', xpath: '/html/body/main/article[9]', text: 'x'.repeat(200) };
  const plan = planChunks([orphan] as any, { viewportHeight: 800 });
  assert.equal(plan.analyseNow, 1, 'nothing to observe, so analyse it now');
  assert.equal(measureChunk(orphan as any).element, null);
}

// --- nothing on screen: analyse the top-priority chunk anyway ---

{
  const chunks = [chunk('below', 'c'.repeat(900)), chunk('far', 'd'.repeat(300))];
  const plan = planChunks(chunks as any, { measure, viewportHeight: 800 });
  assert.equal(plan.analyseNow, 1, 'an analysis that starts with nothing queued looks broken');
  assert.deepEqual(plan.ordered.map((c: any) => c.id), ['below', 'far']);
}

// --- deferred chunks are released as they scroll into view ---

{
  const deferred = [chunk('below', 'c'.repeat(5000)), chunk('far', 'd'.repeat(300))];
  const released: string[] = [];
  const schedule = scheduleDeferredChunks(deferred as any, (batch) => {
    released.push(...batch.map((c: any) => c.id));
  });

  const observer = FakeIntersectionObserver.last;
  assert.equal(observer.observed.length, 2, 'both deferred chunks are observed');
  assert.equal(schedule.pending(), 2);
  assert.deepEqual(released, [], 'nothing released before a scroll');

  observer.scrollTo('#below');
  // Releases are debounced into one message per burst of scrolling.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(released, ['below']);
  assert.equal(schedule.pending(), 1);
  assert.equal(observer.observed.length, 1, 'a released chunk is not watched again');

  schedule.releaseAll();
  assert.deepEqual(released, ['below', 'far'], 'releaseAll hands over the rest at once');
  assert.equal(schedule.pending(), 0);
  assert.equal(observer.disconnected, true);
}

// --- stop() drops everything: the page has navigated away ---

{
  const released: string[] = [];
  const schedule = scheduleDeferredChunks([chunk('far', 'd'.repeat(300))] as any, (batch) =>
    released.push(...batch.map((c: any) => c.id))
  );
  const observer = FakeIntersectionObserver.last;
  schedule.stop();
  assert.equal(observer.disconnected, true);
  assert.equal(schedule.pending(), 0);
  observer.callback([{ target: dom.window.document.getElementById('far'), isIntersecting: true }]);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(released, [], 'a stopped schedule releases nothing');
}

console.log('✅ chunk-scheduler tests passed');
