/**
 * Custom chunker for Reddit
 * Based on stopaganda-r.js selectors
 */

import { isElementHidden, generateXPath } from './chunking-utils.js';

/**
 * Detect Reddit layout type
 */
function detectRedditLayout(doc) {
  if (doc.querySelectorAll('.post-link').length > 0) {
    return 'card';
  } else if (doc.querySelectorAll('div[slot=overflow-menu-bar]').length > 0) {
    return 'compact';
  } else if (doc.getElementById('header-bottom-left') != null) {
    return 'old';
  } else if (doc.querySelectorAll('.styled-outbound-link').length > 0) {
    return 'new';
  }
  return 'unknown';
}

/**
 * Extract chunks from Reddit
 */
export function extractChunksReddit(source, url, options = {}) {
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
  const linkRegex = /(?:https?\:\/\/)?(?:www\.)?([A-Za-z0-9\_\-\.]+)\/?/;
  const layoutType = detectRedditLayout(doc);

  let selectors = [];
  
  if (layoutType === 'old') {
    // Old Reddit
    selectors = ['p.title'];
  } else if (layoutType === 'card') {
    // Card view
    selectors = ['.post-link'];
  } else if (layoutType === 'compact') {
    // Compact view
    selectors = ['shreddit-post'];
  } else {
    // New Reddit (default)
    selectors = ['.styled-outbound-link'];
  }

  for (const selector of selectors) {
    const elements = doc.querySelectorAll(selector);
    
    for (const element of elements) {
      const chunk = extractRedditChunk(element, linkRegex, url, layoutType, { includeAds });
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
 * Extract a single chunk from a Reddit post element
 */
function extractRedditChunk(element, linkRegex, pageUrl, layoutType, options = {}) {
  const { includeAds } = options;

  if (!element || isElementHidden(element)) {
    return null;
  }

  const clone = element.cloneNode(true);
  
  // Remove unwanted elements
  const unwanted = clone.querySelectorAll('script, style, noscript, iframe, nav, header, footer');
  unwanted.forEach(el => el.remove());

  // Extract title
  let title = '';
  if (layoutType === 'old') {
    const titleEl = clone.querySelector('a');
    title = titleEl ? titleEl.textContent.trim() : '';
  } else if (layoutType === 'card') {
    title = clone.textContent.trim();
  } else if (layoutType === 'compact') {
    const titleEl = clone.querySelector('a, [content-href]');
    title = titleEl ? titleEl.textContent.trim() : '';
  } else {
    title = clone.textContent.trim();
  }

  // Extract link URL
  let linkUrl = '';
  if (layoutType === 'old') {
    const linkEl = clone.querySelector('a');
    linkUrl = linkEl ? linkEl.href : '';
  } else if (layoutType === 'compact') {
    linkUrl = element.getAttribute('content-href') || '';
  } else {
    const linkEl = clone.querySelector('a');
    linkUrl = linkEl ? linkEl.href : '';
  }

  // Extract subreddit
  const subredditEl = clone.querySelector('[data-click-id=subreddit], .subreddit, span.relative a span');
  const subreddit = subredditEl ? subredditEl.textContent.trim() : '';

  // Extract post text/content
  const postTextEl = clone.querySelector('[data-testid="post-content"], .usertext-body, .md');
  const postText = postTextEl ? postTextEl.textContent.trim() : '';

  // Combine text
  const textParts = [subreddit, title, postText].filter(Boolean);
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
      platform: 'reddit',
      layoutType,
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

