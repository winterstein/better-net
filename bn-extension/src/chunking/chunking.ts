/**
 * HTML Chunking Module
 * Top-level function that tries different chunking strategies
 * Identifies and extracts discrete content chunks (posts, articles, adverts) from HTML
 * Browser-agnostic - works with DOM or HTML strings
 */

import { extractChunksRegex } from './chunking-fixed-patterns.js';
import { extractChunksLLM } from './chunking-llm.js';
import { extractChunksGoogle } from './chunking-google.js';
import { extractChunksDuckDuckGo } from './chunking-duckduckgo.js';
import { extractChunksFacebook } from './chunking-facebook.js';
import { extractChunksReddit } from './chunking-reddit.js';
import { extractChunksThreads } from './chunking-threads.js';
import { extractChunksBluesky } from './chunking-bluesky.js';
import { extractChunksX } from './chunking-x.js';
import { extractHeadlineChunks } from './chunking-headlines.js';
import { findElementByXPath } from '../utils/utils.js';
import { logit } from '../utils/logger.js';
import { finalizeChunks } from './chunk-tags.js';
import { NOOP_STEP_RECORDER } from '../tracing/trace-steps.js';
import type { StepRecorder } from '../tracing/trace-steps.js';

/**
 * Extract content chunks from HTML/DOM
 * Tries different chunking strategies in order:
 * 1. LLM-based chunking (if available and enabled)
 * 2. Regex/selector-based chunking (fallback)
 * 
 * @param {Document|string} source - DOM document or HTML string
 * @param {Object} options - Configuration options
 * @param {string} options.strategy - Preferred strategy: 'llm', 'regex', or 'auto' (default: 'auto')
 * @param {number} options.minTextLength - Minimum text length for a chunk (default: 100)
 * @param {number} options.maxChunks - Maximum number of chunks to return (default: 50)
 * @param {boolean} options.includeAds - Whether to include likely advertisements (default: false)
 * @param {StepRecorder} options.recorder - AIQA step recorder (tracing/trace-steps.ts)
 * @returns {Array<Object>} Array of content chunks with xpath field
 */
export async function extractChunks(source, url, options: any = {}) {
  logit('log','[BetterNet] [CHUNKING] Starting chunk extraction, URL:', url);
  
  const {
    strategy = 'auto',
    minTextLength = 100,
    maxChunks = 50,
    includeAds = false,
    // Teaser links (ticker, sidebar, related posts) are below minTextLength but are
    // exactly the fake headlines we want to label. See chunking-headlines.ts.
    includeHeadlines = true,
    recorder = NOOP_STEP_RECORDER
  } = options;

  const chunkingOptions = {
    minTextLength,
    maxChunks,
    includeAds
  };

  logit('log','[BetterNet] [CHUNKING] Options:', chunkingOptions);

  // If strategy=auto - Do we have a custom chunker for this page?
  // Detect platform and use custom chunker if available
  // Host alone, deliberately: this used to also require a DOM marker, but those markers
  // were hashed CSS class names (`.wLL07_0Xnd1QZpzpfR4W`) that change whenever the site is
  // redeployed, so DuckDuckGo results quietly fell through to the generic chunker. Guessing
  // wrong is cheap — the platform chunker finds nothing and we fall through below.
  const platform = detectPlatform(url);
  logit('log','[BetterNet] [CHUNKING] Detected platform:', platform);
  
  if (platform && strategy === 'auto') {
    try {
      logit('log','[BetterNet] [CHUNKING] Using custom chunker for platform:', platform);
      const customChunks = await recorder.step(
        'betternet.chunk.platform',
        { 'betternet.chunk.strategy': 'platform', 'betternet.chunk.platform': platform },
        async (step) => {
          const found = await extractChunksFromPlatform(source, url, platform, chunkingOptions);
          step.annotate({ 'betternet.chunk.count': found?.length ?? 0 });
          return found;
        }
      );
      if (customChunks && customChunks.length > 0) {
        logit('log','[BetterNet] [CHUNKING] Custom chunker found', customChunks.length, 'chunks');
        return finalizeChunks(withHeadlines(customChunks, source, url, includeHeadlines, maxChunks), { platform, url });
      } else {
        logit('log','[BetterNet] [CHUNKING] Custom chunker returned no chunks, falling back');
      }
    } catch (error) {
      logit('warn','[BetterNet] [CHUNKING] Custom chunker for', platform, 'failed, falling back:', error);
      // Fall through to other strategies
    }
  }

  // Try LLM strategy first if requested or auto
  if (strategy === 'llm' || strategy === 'auto') {
    try {
      logit('log','[BetterNet] [CHUNKING] Trying LLM chunking...');
      const llmChunks = await recorder.step(
        'betternet.chunk.llm',
        { 'betternet.chunk.strategy': 'llm' },
        async (step) => {
          const found = await extractChunksLLM(source, chunkingOptions);
          step.annotate({ 'betternet.chunk.count': found?.length ?? 0 });
          return found;
        }
      );
      if (llmChunks && llmChunks.length > 0) {
        logit('log','[BetterNet] [CHUNKING] LLM chunking found', llmChunks.length, 'chunks');
        return finalizeChunks(withHeadlines(llmChunks, source, url, includeHeadlines, maxChunks), { url });
      } else {
        logit('log','[BetterNet] [CHUNKING] LLM chunking returned no chunks, falling back');
      }
    } catch (error) {
      logit('warn','[BetterNet] [CHUNKING] LLM chunking failed, falling back to regex:', error);
      // Fall through to regex strategy
    }
  }

  // Fall back to regex/selector-based chunking
  if (strategy === 'regex' || strategy === 'auto' || strategy === 'llm') {
    logit('log','[BetterNet] [CHUNKING] Using regex/selector-based chunking...');
    const regexChunks = await recorder.step(
      'betternet.chunk.regex',
      { 'betternet.chunk.strategy': 'regex' },
      (step) => {
        const found = extractChunksRegex(source, url, chunkingOptions);
        step.annotate({ 'betternet.chunk.count': found.length });
        return found;
      }
    );
    logit('log','[BetterNet] [CHUNKING] Regex chunking found', regexChunks.length, 'chunks');
    return finalizeChunks(withHeadlines(regexChunks, source, url, includeHeadlines, maxChunks), { url });
  }

  // Unknown strategy - default to regex
  logit('warn','[BetterNet] [CHUNKING] Unknown chunking strategy:', strategy, ', using regex');
  const fallbackChunks = extractChunksRegex(source, url, chunkingOptions);
  logit('log','[BetterNet] [CHUNKING] Fallback regex chunking found', fallbackChunks.length, 'chunks');
  return finalizeChunks(withHeadlines(fallbackChunks, source, url, includeHeadlines, maxChunks), { url });
}

/**
 * Add the page's teaser headlines to whatever the main chunker found. Passing the chunk
 * text through means a link inside an article is not chunked a second time.
 */
function withHeadlines(chunks, source, url, includeHeadlines, maxChunks) {
  if (!includeHeadlines) return chunks;
  try {
    const covered = chunkCoverage(chunks);
    const headlines = extractHeadlineChunks(source, url, {
      coveredElements: covered.elements,
      coveredText: covered.unresolvedText,
      maxHeadlines: Math.max(0, maxChunks - chunks.length),
    });
    if (headlines.length) {
      logit('log','[BetterNet] [CHUNKING] Headline chunks found:', headlines.length);
    }
    return [...chunks, ...headlines];
  } catch (error) {
    logit('warn','[BetterNet] [CHUNKING] Headline chunking failed:', error);
    return chunks;
  }
}

/**
 * What the main chunker already covers. Position beats text: a sidebar teaser repeating an
 * in-article heading is its own chunk, while a link inside the story is not. Chunks whose
 * xpath will not resolve fall back to text matching.
 */
function chunkCoverage(chunks) {
  const elements = [];
  const unresolvedText = [];
  for (const chunk of chunks) {
    let element = null;
    if (chunk?.xpath) {
      try {
        element = findElementByXPath(chunk.xpath);
      } catch {
        element = null;
      }
    }
    if (element) elements.push(element);
    else if (chunk?.text) unresolvedText.push(chunk.text);
  }
  return { elements, unresolvedText };
}

/**
 * A page that has not rendered yet, dressed up as a result. On an SPA the platform chunker
 * finds nothing and the headline chunker picks up whatever furniture is on screen, so a
 * result made only of teasers means "too early" rather than "chunked", and the caller
 * should wait and chunk again. Restricted to sites we have a platform chunker for: on an
 * ordinary news homepage the teasers really are the content.
 */
export function looksUnrendered(chunks, url: string): boolean {
  if (!chunks?.length) return true;
  if (!detectPlatform(url)) return false;
  return chunks.every((chunk) => chunk?.metadata?.headline);
}

/**
 * Detect which platform we're on based on URL and DOM structure
 */
function detectPlatform(url: string): string | null {
  if (!url) return null;

  const urlLower = url.toLowerCase();

  // Google
  if (urlLower.includes('google.com/search') || urlLower.includes('google.com/webhp')) return 'google';
  if (urlLower.includes('duckduckgo.com')) return 'duckduckgo';
  if (urlLower.includes('facebook.com') || urlLower.includes('fb.com')) return 'facebook';
  if (urlLower.includes('reddit.com')) return 'reddit';
  if (urlLower.includes('threads.net')) return 'threads';
  if (urlLower.includes('x.com') || urlLower.includes('twitter.com')) return 'x';
  if (urlLower.includes('bsky.app') || urlLower.includes('bluesky.social')) return 'bluesky';

  return null;
}

/**
 * Extract chunks using platform-specific chunker
 */
async function extractChunksFromPlatform(source: Document | Element | string, url, platform, options) {
  switch (platform) {
    case 'google':
      return extractChunksGoogle(source, url, options);
    case 'duckduckgo':
      return extractChunksDuckDuckGo(source, url, options);
    case 'facebook':
      return extractChunksFacebook(source, url, options);
    case 'reddit':
      return extractChunksReddit(source, url, options);
    case 'threads':
      return extractChunksThreads(source, url, options);
    case 'bluesky':
      return extractChunksBluesky(source, url, options);
    case 'x':
      return extractChunksX(source, url, options);
    default:
      return null;
  }
}

/**
 * Parse HTML string to DOM
 */
function parseHTML(html) {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }
  return null;
}

