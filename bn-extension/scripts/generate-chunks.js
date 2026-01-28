#!/usr/bin/env node

/**
 * Script to generate chunks from HTML file
 * Usage: node scripts/generate-chunks.js <html-file> <output-json-file>
 */

import { readFileSync, writeFileSync } from 'fs';
import { Window } from 'happy-dom';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractChunks } from '../src/chunking/chunking.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get file paths from command line arguments
const htmlFile = process.argv[2];
const outputFile = process.argv[3];

if (!htmlFile || !outputFile) {
  console.error('Usage: node scripts/generate-chunks.js <html-file> <output-json-file>');
  process.exit(1);
}

(async () => {
try {
  console.log(`Reading HTML file: ${htmlFile}`);
  const htmlContent = readFileSync(htmlFile, 'utf-8');
  
  console.log('Parsing HTML with happy-dom...');
  // Extract URL from HTML file name or use default
  let pageUrl = 'https://duckduckgo.com/?origin=funnel_home_website&t=h_&q=hello&ia=web';
  if (htmlFile.includes('duckduckgo.com.hello')) {
    pageUrl = 'https://duckduckgo.com/?origin=funnel_home_website&t=h_&q=hello&ia=web';
  }
  
  // Create a Window instance with happy-dom and set the URL
  const window = new Window({
    url: pageUrl,
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      disableCSSFileLoading: true
    }
  });
  const document = window.document;
  document.write(htmlContent);
  
  // Make DOMParser available globally for the chunking module
  global.DOMParser = window.DOMParser;
  global.window = window;
  global.document = document;
  global.Node = window.Node;
  global.NodeFilter = window.NodeFilter;
  
  // Try to extract URL from HTML if not already set
  try {
    const baseElement = document.querySelector('base[href]');
    if (baseElement) {
      const baseUrl = baseElement.getAttribute('href');
      if (baseUrl) {
        pageUrl = baseUrl;
      }
    } else {
      // Try to extract from meta tags or other sources
      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl) {
        const metaUrl = ogUrl.getAttribute('content');
        if (metaUrl) {
          pageUrl = metaUrl;
        }
      }
    }
  } catch (e) {
    // Use default URL
  }
  
  console.log(`Using URL: ${pageUrl}`);
  console.log('Extracting chunks...');
  const chunks = await extractChunks(document, pageUrl, {
    minTextLength: 100,
    maxChunks: 50,
    includeAds: false
  });
  
  console.log(`Found ${chunks.length} chunks`);
  
  // Convert chunks to the format expected by Chunk class
  // Chunk class expects: {url, html, text, images, links, metadata, xpath}
  const formattedChunks = chunks.map(chunk => ({
    url: pageUrl,
    html: chunk.html || '',
    text: chunk.text || '',
    images: chunk.images || [],
    links: chunk.links || [],
    metadata: {
      ...chunk.metadata,
      chunkId: chunk.id,
      position: chunk.position
    },
    xpath: chunk.xpath || null
  }));
  
  console.log(`Writing ${formattedChunks.length} chunks to ${outputFile}`);
  writeFileSync(outputFile, JSON.stringify(formattedChunks, null, 2), 'utf-8');
  
  console.log('Done!');
  console.log(`Total chunks: ${formattedChunks.length}`);
  console.log(`Total text length: ${formattedChunks.reduce((sum, c) => sum + c.text.length, 0)} characters`);
  
} catch (error) {
  console.error('Error processing HTML file:', error);
  process.exit(1);
}
})();

