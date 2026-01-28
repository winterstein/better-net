#!/usr/bin/env tsx

/**
 * Tool to fetch a URL, run it through chunking and analyzers, and save results to test-data
 * Usage: npx tsx test_integration/create_test_tool.ts <url> [output-filename]
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Window } from 'happy-dom';
import { getDefaultAnalysisEngine } from '../src/plugin-src/analyzers/AnalysisEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get URL from command line arguments
const url = process.argv[2];
const outputFilename = process.argv[3];

if (!url) {
  console.error('Usage: tsx test_integration/create_test_tool.ts <url> [output-filename]');
  console.error('Example: tsx test_integration/create_test_tool.ts https://example.com/article');
  process.exit(1);
}

// Generate output filename from URL if not provided
function generateFilename(url: string): string {
  if (outputFilename) {
    return outputFilename.endsWith('.json') ? outputFilename : `${outputFilename}.json`;
  }
  
  try {
    const urlObj = new URL(url);
    // Create filename from domain and path
    const domain = urlObj.hostname.replace(/\./g, '-');
    const pathParts = urlObj.pathname
      .split('/')
      .filter(p => p.length > 0)
      .slice(-2) // Take last 2 path segments
      .join('-')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .substring(0, 50); // Limit length
    
    const filename = pathParts 
      ? `${domain}-${pathParts}.json`
      : `${domain}.json`;
    
    return filename;
  } catch (e) {
    // Fallback if URL parsing fails
    return `test-${Date.now()}.json`;
  }
}

async function main() {
  try {
    console.log(`Fetching URL: ${url}`);
    
    // Fetch HTML from URL
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const htmlContent = await response.text();
    console.log(`Fetched ${htmlContent.length} characters of HTML`);
    
    // Parse HTML with happy-dom
    console.log('Parsing HTML with happy-dom...');
    const window = new Window({
      url: url,
      settings: {
        disableJavaScriptFileLoading: true,
        disableJavaScriptEvaluation: true,
        disableCSSFileLoading: true
      }
    });
    const document = window.document;
    document.write(htmlContent);
    
    // Set up global DOM environment for chunking functions
    (global as any).window = window;
    (global as any).document = document;
    (global as any).DOMParser = window.DOMParser;
    (global as any).Node = window.Node;
    (global as any).NodeFilter = window.NodeFilter;
    
    // Extract page metadata
    const pageMetadata = {
      url: url,
      title: document.title || '',
      domain: new URL(url).hostname,
      author: document.querySelector('meta[name="author"]')?.getAttribute('content') || 
               document.querySelector('meta[property="article:author"]')?.getAttribute('content') || '',
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') || 
                   document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
    };
    
    console.log('Page metadata:', pageMetadata);
    
    // Run analysis
    console.log('Running chunking and analysis...');
    const engine = getDefaultAnalysisEngine();
    const analysisResult = await engine.analyzePage(
      document,
      pageMetadata,
      {
        chunkingOptions: {
          minTextLength: 100,
          maxChunks: 5,
          includeAds: true
        },
        analysisOptions: {}
      }
    );
    
    console.log(`Analysis complete. Found ${analysisResult.chunks?.length || 0} chunks`);
    console.log(`Overall score: ${analysisResult.summary?.score || 0}`);
    console.log(`Status: ${analysisResult.summary?.overall || 'unknown'}`);
    
    // Prepare output data matching the test-data format
    const outputData = {
      inputs: {
        url: url
      },
      outputs: {
        pageMetadata: pageMetadata,
        analysisResult: analysisResult
      },
      stages: {
        chunking: {
          outputs: {
            chunks: analysisResult.chunks || [],
            chunkCount: analysisResult.chunks?.length || 0
          }
        },
        analysis: {
          outputs: {
            results: analysisResult.results || [],
            summary: analysisResult.summary || {},
            aggregated: analysisResult.aggregated || {}
          }
        }
      },
      timestamp: new Date().toISOString()
    };
    
    // Save to test-data directory
    const testDataDir = join(__dirname, '..', 'test-data');
    const filename = generateFilename(url);
    const outputPath = join(testDataDir, filename);
    
    console.log(`Writing results to: ${outputPath}`);
    writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
    
    console.log('Done!');
    console.log(`Output file: ${outputPath}`);
    console.log(`Total chunks: ${analysisResult.chunks?.length || 0}`);
    console.log(`Total text length: ${analysisResult.chunks?.reduce((sum: number, c: any) => sum + (c.textLength || 0), 0)} characters`);
    
  } catch (error) {
    console.error('Error processing URL:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

main();

