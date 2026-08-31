#!/usr/bin/env node
/**
 * Save a real page into test-data/pages/ for the chunking tests.
 *
 *   node scripts/capture-page.js <url> [name]        fetch and save (headless Chromium)
 *   node scripts/capture-page.js --file <path> [name] clean up a page you saved by hand
 *
 * Scripts, SVG and preloads are stripped (they are ~half the bytes and the chunker never
 * reads them); stylesheets stay, because hidden-element checks depend on them. Sites that
 * block automation (x.com) have to be saved by hand — see test-data/pages/README.md.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(__dirname, '..', 'test-data', 'pages');

function slugFor(url) {
  const { hostname, pathname } = new URL(url);
  const tail = pathname.replace(/\/$/, '').split('/').filter(Boolean).pop() || 'home';
  return `${hostname.replace(/^www\./, '')}-${tail}`.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
}

/** Keep the structure and the styles; drop what only bloats the fixture. */
function sanitise(html) {
  const { window } = new JSDOM(html);
  const doc = window.document;
  for (const el of doc.querySelectorAll('script, noscript, template, link[rel="preload"]')) {
    el.remove();
  }
  for (const el of doc.querySelectorAll('svg')) el.replaceWith(doc.createElement('span'));
  for (const el of doc.querySelectorAll('[srcset]')) el.removeAttribute('srcset');
  for (const img of doc.querySelectorAll('img[src^="data:"]')) img.setAttribute('src', 'data:,');
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

async function capture(url) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  } catch {
    console.warn('Page never went idle; capturing what rendered.');
  }
  await page.waitForTimeout(2500);
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  await browser.close();
  return `<!DOCTYPE html>\n${html}`;
}

const args = process.argv.slice(2);
let html;
let name;

if (args[0] === '--file') {
  html = fs.readFileSync(args[1], 'utf-8');
  name = args[2] || path.basename(args[1]).replace(/\.html?$/i, '');
} else if (args[0]) {
  html = await capture(args[0]);
  name = args[1] || slugFor(args[0]);
} else {
  console.error('Usage: capture-page.js <url> [name] | --file <path> [name]');
  process.exit(1);
}

fs.mkdirSync(pagesDir, { recursive: true });
const outPath = path.join(pagesDir, `${name}.html`);
const cleaned = sanitise(html);
fs.writeFileSync(outPath, cleaned);
console.log(`Wrote ${path.relative(process.cwd(), outPath)} (${(cleaned.length / 1024).toFixed(0)}KB)`);

const expectedPath = path.join(pagesDir, `${name}.expected.json`);
if (!fs.existsSync(expectedPath)) {
  console.log(`Now add ${path.relative(process.cwd(), expectedPath)} — see pages/README.md`);
}
