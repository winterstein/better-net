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
 * @returns {Array<Object>} Array of content chunks with xpath field
 */
export async function extractChunks(source, url, options = {}) {
  console.log('[BetterNet] [CHUNKING] Starting chunk extraction, URL:', url);
  
  const {
    strategy = 'auto',
    minTextLength = 100,
    maxChunks = 50,
    includeAds = false
  } = options;

  const chunkingOptions = {
    minTextLength,
    maxChunks,
    includeAds
  };

  console.log('[BetterNet] [CHUNKING] Options:', chunkingOptions);

  // If strategy=auto - Do we have a custom chunker for this page?
  // Detect platform and use custom chunker if available
  const platform = detectPlatform(source, url);
  console.log('[BetterNet] [CHUNKING] Detected platform:', platform);
  
  if (platform && strategy === 'auto') {
    try {
      console.log('[BetterNet] [CHUNKING] Using custom chunker for platform:', platform);
      const customChunks = await extractChunksFromPlatform(source, url, platform, chunkingOptions);
      if (customChunks && customChunks.length > 0) {
        console.log('[BetterNet] [CHUNKING] Custom chunker found', customChunks.length, 'chunks');
        return customChunks;
      } else {
        console.log('[BetterNet] [CHUNKING] Custom chunker returned no chunks, falling back');
      }
    } catch (error) {
      console.warn('[BetterNet] [CHUNKING] Custom chunker for', platform, 'failed, falling back:', error);
      // Fall through to other strategies
    }
  }

  // Try LLM strategy first if requested or auto
  if (strategy === 'llm' || strategy === 'auto') {
    try {
      console.log('[BetterNet] [CHUNKING] Trying LLM chunking...');
      const llmChunks = await extractChunksLLM(source, chunkingOptions);
      if (llmChunks && llmChunks.length > 0) {
        console.log('[BetterNet] [CHUNKING] LLM chunking found', llmChunks.length, 'chunks');
        return llmChunks;
      } else {
        console.log('[BetterNet] [CHUNKING] LLM chunking returned no chunks, falling back');
      }
    } catch (error) {
      console.warn('[BetterNet] [CHUNKING] LLM chunking failed, falling back to regex:', error);
      // Fall through to regex strategy
    }
  }

  // Fall back to regex/selector-based chunking
  if (strategy === 'regex' || strategy === 'auto' || strategy === 'llm') {
    console.log('[BetterNet] [CHUNKING] Using regex/selector-based chunking...');
    const regexChunks = extractChunksRegex(source, chunkingOptions);
    console.log('[BetterNet] [CHUNKING] Regex chunking found', regexChunks.length, 'chunks');
    return regexChunks;
  }

  // Unknown strategy - default to regex
  console.warn('[BetterNet] [CHUNKING] Unknown chunking strategy:', strategy, ', using regex');
  const fallbackChunks = extractChunksRegex(source, chunkingOptions);
  console.log('[BetterNet] [CHUNKING] Fallback regex chunking found', fallbackChunks.length, 'chunks');
  return fallbackChunks;
}

/**
 * Detect which platform we're on based on URL and DOM structure
 */
function detectPlatform(source, url) {
  if (!url) return null;

  const urlLower = url.toLowerCase();
  const doc = typeof source === 'string' ? parseHTML(source) : source;
  if (!doc) return null;

  // Google
  if (urlLower.includes('google.com/search') || urlLower.includes('google.com/webhp')) {
    // Check for Google-specific elements
    if (doc.querySelector('.tjvcx.GvPZzd.cHaqb') || doc.querySelector('.WlydOe') || doc.querySelector('.MgQdud')) {
      return 'google';
    }
  }

  // DuckDuckGo
  if (urlLower.includes('duckduckgo.com')) {
    if (doc.querySelector('.wLL07_0Xnd1QZpzpfR4W') || doc.querySelector('.SnptgjT2zdOhGYfNng6g')) {
      return 'duckduckgo';
    }
  }

  // Facebook
  if (urlLower.includes('facebook.com') || urlLower.includes('fb.com')) {
    if (doc.querySelector('.x1e56ztr.xtvhhri') || doc.querySelector('[data-pagelet]')) {
      return 'facebook';
    }
  }

  // Reddit
  if (urlLower.includes('reddit.com')) {
    if (doc.querySelector('.post-link') || doc.querySelector('shreddit-post') || 
        doc.querySelector('.styled-outbound-link') || doc.getElementById('header-bottom-left')) {
      return 'reddit';
    }
  }

  // Threads
  if (urlLower.includes('threads.net')) {
    if (doc.querySelector('.x1j9u4d2') || doc.querySelector('.x1lliihq.x193iq5w.x6ikm8r.x10wlt62.xlyipyv.xuxw1ft')) {
      return 'threads';
    }
  }

  // Bluesky
  if (urlLower.includes('bsky.app') || urlLower.includes('bluesky.social')) {
    if (doc.querySelector('[data-testid="post"]') || doc.querySelector('article[data-testid="feedItem"]')) {
      return 'bluesky';
    }
  }

  return null;
}

/**
 * Extract chunks using platform-specific chunker
 */
async function extractChunksFromPlatform(source, url, platform, options) {
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

