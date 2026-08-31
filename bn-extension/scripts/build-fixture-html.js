#!/usr/bin/env node
/**
 * Build minimal HTML fixture pages from *.chunking.json in test-data/.
 * Used by unit chunking tests and Playwright e2e fixtures.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataDir = path.join(__dirname, '..', 'test-data');

/**
 * Snapshots store the chunk's *inner* HTML, so the element it came from (usually
 * `<article>`) was being dropped — the rebuilt page then had no article for the chunker to
 * find, and the story got split at its headings instead. Put the recorded element back.
 */
function wrapInRecordedElement(chunk) {
  const html = chunk.html || '';
  const tag = chunk.metadata?.elementType;
  if (!tag || html.trim().toLowerCase().startsWith(`<${tag}`)) return html;
  const classes = (chunk.metadata.classes || []).join(' ');
  const id = chunk.metadata.id ? ` id="${chunk.metadata.id}"` : '';
  return `<${tag}${id}${classes ? ` class="${classes}"` : ''}>${html}</${tag}>`;
}

function buildHtml(chunks, baseName) {
  const canonical = chunks[0]?.url || '';
  const title = baseName.replace(/\./g, ' / ');
  const body = chunks.map(wrapInRecordedElement).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
</head>
<body>
<main id="content">
${body}
</main>
</body>
</html>
`;
}

const jsonFiles = fs.readdirSync(testDataDir).filter((f) => f.endsWith('.chunking.json'));
if (jsonFiles.length === 0) {
  console.error('No *.chunking.json files in test-data/');
  process.exit(1);
}

for (const jsonFile of jsonFiles) {
  const baseName = jsonFile.replace('.chunking.json', '');
  const htmlPath = path.join(testDataDir, `${baseName}.html`);
  const chunks = JSON.parse(fs.readFileSync(path.join(testDataDir, jsonFile), 'utf-8'));
  fs.writeFileSync(htmlPath, buildHtml(chunks, baseName));
  console.log(`Wrote ${path.relative(process.cwd(), htmlPath)} (${chunks.length} chunk(s))`);
}
