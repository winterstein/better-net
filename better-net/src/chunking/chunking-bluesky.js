/**
 * Custom chunker for Bluesky
 * Bluesky uses a similar structure to Twitter/Threads
 */

import { isElementHidden, generateXPath } from './chunking-utils.js';

/**
 * Extract chunks from Bluesky
 */
export function extractChunksBluesky(source, url, options = {}) {
  const {
    minTextLength = 100,
    maxChunks = 50,
    includeAds = false
  } = options;

  // Convert HTML string to DOM if needed
  const doc = typeof source === 'string' ? parseHTML(source) : source;
  if (!doc) {
    return [];
  }

  const chunks = [];

  // Bluesky posts are typically in article elements or have data-testid="post"
  const postSelectors = [
    'article[data-testid="post"]',
    'article[data-testid="feedItem"]',
    '[data-testid="post"]',
    '.post',
    'article'
  ];

  for (const selector of postSelectors) {
    const posts = doc.querySelectorAll(selector);
    
    for (const post of posts) {
      const chunk = extractBlueskyChunk(post, url, { includeAds });
      if (chunk && chunk.text.length >= minTextLength) {
        chunks.push(chunk);
      }
    }
  }

  // Filter out ads unless explicitly included
  const filteredChunks = includeAds 
    ? chunks 
    : chunks.filter(chunk => !isLikelyAd(chunk));

  return filteredChunks.slice(0, maxChunks);
}

/**
 * Extract a single chunk from a Bluesky post element
 */
function extractBlueskyChunk(element, pageUrl, options = {}) {
  const { includeAds } = options;

  if (!element || isElementHidden(element)) {
    return null;
  }

  const clone = element.cloneNode(true);
  
  // Remove unwanted elements
  const unwanted = clone.querySelectorAll('script, style, noscript, iframe, nav, header, footer');
  unwanted.forEach(el => el.remove());

  // Extract post text
  const postTextEl = clone.querySelector('[data-testid="postText"], .post-text, [data-testid="postText"]');
  const postText = postTextEl ? postTextEl.textContent.trim() : '';

  // Extract author
  const authorEl = clone.querySelector('[data-testid="authorName"], .author-name, [data-testid="userName"]');
  const author = authorEl ? authorEl.textContent.trim() : '';

  // Extract timestamp
  const timeEl = clone.querySelector('time, [data-testid="timestamp"]');
  const timestamp = timeEl ? timeEl.textContent.trim() : '';

  // Extract links in post
  const linkEls = clone.querySelectorAll('a[href]');
  const linkTexts = Array.from(linkEls)
    .map(a => a.textContent.trim())
    .filter(Boolean)
    .join(' ');

  // Combine text
  const textParts = [author, postText, linkTexts, timestamp].filter(Boolean);
  const text = textParts.join('\n').trim();

  if (!text || text.length < 50) {
    return null;
  }

  // Extract all links
  const links = Array.from(clone.querySelectorAll('a[href]'))
    .map(a => {
      const href = a.getAttribute('href') || a.href || '';
      const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
      return {
        url: href,
        text: a.textContent.trim().substring(0, 100),
        isExternal: href.startsWith('http') && origin && !href.startsWith(origin)
      };
    })
    .filter(link => link.url)
    .slice(0, 10);

  // Extract images
  const images = Array.from(clone.querySelectorAll('img'))
    .filter(img => img.src && !img.src.startsWith('data:'))
    .map(img => ({
      src: img.src,
      alt: img.alt || '',
      title: img.title || ''
    }))
    .slice(0, 5);

  return {
    url: pageUrl,
    text,
    html: clone.innerHTML,
    links,
    images,
    metadata: {
      platform: 'bluesky',
      elementType: element.tagName.toLowerCase(),
      classes: Array.from(element.classList)
    },
    xpath: generateXPath(element),
    isPrimary: false
  };
}


/**
 * Check if chunk is likely an ad
 */
function isLikelyAd(chunk) {
  const text = (chunk.text || '').toLowerCase();
  const adKeywords = ['advertisement', 'sponsored', 'promoted', 'ad'];
  return adKeywords.some(keyword => text.includes(keyword));
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

