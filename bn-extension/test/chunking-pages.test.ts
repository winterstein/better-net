/**
 * Chunking against real saved pages (test-data/pages/*.html).
 *
 * The older test-data fixtures build their HTML from the expected chunks, so they cannot
 * reproduce the things that actually break chunking: teaser lists, tickers, nav furniture,
 * screen-reader spans. These pages are saved verbatim from the browser.
 *
 * Expectations are quality statements ("this headline must be chunked", "this boilerplate
 * must not appear"), not a snapshot: a snapshot of a page this size would be unreadable and
 * would go stale on any harmless change.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import { extractChunks } from '../src/chunking/chunking.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(__dirname, '..', 'test-data', 'pages');

/** A chunk carrying the same sentence twice is the nesting bug this suite exists to catch. */
const MAX_REPEAT_FRACTION = 0.15;
/** No single chunk should swallow a whole page region. */
const MAX_CHUNK_CHARS = 20_000;

const failures: string[] = [];

function check(page: string, ok: boolean, message: string) {
  if (ok) return;
  failures.push(`${page}: ${message}`);
  console.error(`  ❌ ${message}`);
}

function normalise(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * The nesting bug repeated whole teaser lists with no sentence punctuation anywhere, so
 * sentence-level dedup missed it. Any 60-character run appearing twice in one chunk is a
 * duplication bug: prose does not repeat that much verbatim inside a single chunk.
 */
const REPEATED_RUN_CHARS = 60;

function repeatedRun(text: string): string | null {
  const flat = normalise(text).toLowerCase();
  if (flat.length < REPEATED_RUN_CHARS * 2) return null;
  for (let i = 0; i + REPEATED_RUN_CHARS <= flat.length; i += 20) {
    const run = flat.slice(i, i + REPEATED_RUN_CHARS);
    if (flat.indexOf(run, i + REPEATED_RUN_CHARS) !== -1) return run;
  }
  return null;
}

/** Fraction of a chunk's sentences that are duplicates of an earlier one. */
function repeatFraction(text: string): number {
  const segments = normalise(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .filter((s) => s.length > 25);
  if (segments.length < 2) return 0;
  const seen = new Set<string>();
  let repeats = 0;
  for (const segment of segments) {
    if (seen.has(segment)) repeats++;
    seen.add(segment);
  }
  return repeats / segments.length;
}

async function chunkPage(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const { window } = dom;
  Object.assign(globalThis as any, {
    window,
    document: window.document,
    DOMParser: window.DOMParser,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
  const chunks = await extractChunks(window.document, url);
  return { chunks, document: window.document };
}

async function runPage(name: string) {
  console.log(`\nTesting page: ${name}`);
  const expected = JSON.parse(readFileSync(join(pagesDir, `${name}.expected.json`), 'utf-8'));
  const html = readFileSync(join(pagesDir, `${name}.html`), 'utf-8');

  // A page pasted straight out of the browser still has the site's own scripts. Loaded for
  // real they boot the site's router, wipe the saved markup and navigate away — the page
  // then chunks to nothing for reasons that have nothing to do with the chunker.
  check(
    name,
    !/<script[\s>]/i.test(html.replace(/<!--[\s\S]*?-->/g, '')),
    'still contains <script> tags — run `node scripts/capture-page.js --file <path> ' + name + '`'
  );
  const { chunks, document } = await chunkPage(html, expected.url);

  console.log(`  ${chunks.length} chunks`);

  const bounds = expected.chunks || {};
  if (bounds.min !== undefined) {
    check(name, chunks.length >= bounds.min, `expected at least ${bounds.min} chunks, got ${chunks.length}`);
  }
  if (bounds.max !== undefined) {
    check(name, chunks.length <= bounds.max, `expected at most ${bounds.max} chunks, got ${chunks.length}`);
  }

  const texts = chunks.map((c) => normalise(c.text));

  for (const wanted of expected.mustChunk || []) {
    check(name, texts.some((t) => t.includes(wanted)), `no chunk contains "${wanted}"`);
  }

  for (const unwanted of expected.mustNotAppear || []) {
    const offender = texts.findIndex((t) => t.includes(unwanted));
    check(
      name,
      offender === -1,
      `"${unwanted}" should never reach chunk text (chunk ${offender}: "${texts[offender]?.slice(0, 90)}…")`
    );
  }

  if (expected.primaryChunk) {
    const { contains, minLength = 0 } = expected.primaryChunk;
    const primary = chunks.find((c) => normalise(c.text).includes(contains));
    check(name, !!primary, `no chunk holds the main story ("${contains}")`);
    if (primary) {
      check(
        name,
        normalise(primary.text).length >= minLength,
        `main story chunk is ${normalise(primary.text).length} chars, expected >= ${minLength} — the story is being split up`
      );
    }
  }

  // Invariants that hold for every page.
  chunks.forEach((chunk, i) => {
    const text = normalise(chunk.text);
    check(name, text.length > 0, `chunk ${i} has no text`);
    check(name, text.length <= MAX_CHUNK_CHARS, `chunk ${i} is ${text.length} chars — a page region, not a story`);
    const repeats = repeatFraction(text);
    check(
      name,
      repeats <= MAX_REPEAT_FRACTION,
      `chunk ${i} repeats ${(repeats * 100).toFixed(0)}% of its own sentences ("${text.slice(0, 80)}…")`
    );
    const run = repeatedRun(text);
    check(name, !run, `chunk ${i} contains the same text twice: "${run}…"`);
    // A label can only be placed if the xpath still finds the element.
    const resolved = chunk.xpath
      ? document.evaluate(chunk.xpath, document, null, 9 /* FIRST_ORDERED_NODE_TYPE */, null).singleNodeValue
      : null;
    check(name, !!resolved, `chunk ${i} xpath does not resolve: ${chunk.xpath}`);
  });
}

const pages = readdirSync(pagesDir)
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, ''))
  .filter((name) => existsSync(join(pagesDir, `${name}.expected.json`)));

if (pages.length === 0) {
  console.error('No pages with expectations in test-data/pages/');
  process.exit(1);
}

for (const page of pages) {
  await runPage(page);
}

if (failures.length) {
  console.error(`\n❌ ${failures.length} chunking expectation(s) failed`);
  process.exit(1);
}
console.log(`\n✅ ${pages.length} page(s) chunked as expected`);
