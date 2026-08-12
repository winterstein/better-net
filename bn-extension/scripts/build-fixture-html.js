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

function buildHtml(chunks, baseName) {
  const canonical = chunks[0]?.url || '';
  const title = baseName.replace(/\./g, ' / ');
  const body = chunks.map((c) => c.html).join('\n');
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
