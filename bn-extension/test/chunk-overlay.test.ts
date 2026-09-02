/**
 * Debug chunk overlay (src/content/chunk-overlay.ts).
 *
 * jsdom does no layout, so getBoundingClientRect is all zeros; the boxes are given sizes
 * here explicitly. What is worth testing without a real browser is the bookkeeping: one box
 * per resolvable chunk, a stable colour per id, labels that match the console, and a clean
 * teardown.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
     <main>
       <article id="one"><h2>First story</h2></article>
       <article id="two"><h2>Second story</h2></article>
     </main>
   </body></html>`,
  { url: 'https://example.com/' }
);
Object.assign(globalThis as any, {
  window: dom.window,
  document: dom.window.document,
  Node: dom.window.Node,
  // findElementByXPath reaches for the global XPathResult; without it, it silently falls
  // back to its hand-rolled path parser and the test would not exercise the real path.
  XPathResult: dom.window.XPathResult,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

// Give the two articles a size, as a browser would.
let top = 100;
for (const el of dom.window.document.querySelectorAll('article')) {
  const box = { top, left: 20, width: 600, height: 80, right: 620, bottom: top + 80, x: 20, y: top };
  (el as any).getBoundingClientRect = () => box;
  top += 200;
}

const { renderChunkOverlays, clearChunkOverlays } = await import('../src/content/chunk-overlay.js');

const chunks = [
  { id: 'chunk-aaa', xpath: '/html/body/main/article', tags: ['article'] },
  { id: 'chunk-bbb', xpath: '/html/body/main/article[2]', tags: ['article', 'sidebar'] },
  // Nothing on the page matches: it must be counted, not drawn, and not throw.
  { id: 'chunk-ccc', xpath: '/html/body/main/article[9]', tags: ['article'] },
];

renderChunkOverlays(chunks);

const boxes = () => [...dom.window.document.querySelectorAll('.betternet-chunk-overlay')];
assert.equal(boxes().length, 2, 'one box per chunk whose element resolves');

const [first, second] = boxes();
assert.equal((first as HTMLElement).style.top, '100px');
assert.equal((first as HTMLElement).style.width, '600px');

const labels = boxes().map((b) => b.querySelector('.betternet-chunk-overlay-label')?.textContent);
assert.deepEqual(labels, ['#0 chunk-aaa', '#1 chunk-bbb'], 'label carries the index and the id used in logs');
assert.match(
  first.querySelector('.betternet-chunk-overlay-label')?.getAttribute('title') ?? '',
  /tags: article/,
  'hover gives the tags and xpath'
);

// Distinct chunks get distinct colours, and a colour is a function of the id: a redraw on
// resize or re-analysis must not reshuffle them.
const colourOf = (el: Element) => (el as HTMLElement).style.color;
assert.notEqual(colourOf(first), colourOf(second));
const before = boxes().map(colourOf);
renderChunkOverlays(chunks);
assert.deepEqual(boxes().map(colourOf), before, 'same id, same colour on redraw');
assert.equal(boxes().length, 2, 'a redraw replaces the boxes rather than stacking them');

// The label text must never come back as page content: everything is under the betternet-
// prefix that chunking-utils excludes.
const { NON_CONTENT_SELECTOR } = await import('../src/chunking/chunking-utils.js');
for (const el of dom.window.document.querySelectorAll('[id^="betternet-"], [class^="betternet-"]')) {
  assert.ok(el.matches(NON_CONTENT_SELECTOR), `${el.className || el.id} is not excluded from chunking`);
}

clearChunkOverlays();
assert.equal(boxes().length, 0, 'clearing removes every box');
assert.equal(dom.window.document.getElementById('betternet-chunk-overlay-root'), null, 'and the root');

// No chunks at all is a no-op, not a crash.
renderChunkOverlays([]);
assert.equal(boxes().length, 0);

console.log('✅ chunk overlay tests passed');
