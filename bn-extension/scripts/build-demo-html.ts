/**
 * Write offline mirror HTML from DEMO_PAGES into demo/.
 * Run: npm run build:demo   then   npx serve -l 8080 --no-clean-urls demo/
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_PAGES, renderDemoPage } from '../src/analysis/demo-analysis.js';

const demoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo');
fs.mkdirSync(demoDir, { recursive: true });

for (const page of DEMO_PAGES) {
  const mirror = page.urls.find((u) => {
    try {
      const { hostname } = new URL(u);
      return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
      return false;
    }
  });
  if (!mirror) {
    console.warn(`No localhost mirror URL for "${page.title}" — skip`);
    continue;
  }
  const filename = path.basename(new URL(mirror).pathname);
  const out = path.join(demoDir, filename);
  fs.writeFileSync(out, renderDemoPage(page));
  console.log(`Wrote demo/${filename}`);
}
