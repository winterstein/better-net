/**
 * Custom chunker for Facebook
 * Based on stopaganda-fb.js selectors
 */

import { isElementHidden, generateXPath } from './chunking-utils.js';

/**
 * Extract chunks from Facebook
 */
export function extractChunksFacebook(source, url, options = {}) {
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

  // Primary links - based on stopaganda-fb.js
  const linkTextClass = '.x1e56ztr.xtvhhri';
  const sources = doc.querySelectorAll(linkTextClass);
  
  for (const element of sources) {
    // Get the parent container that contains the full post
    const container = element.closest('[data-pagelet]') || 
                     element.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
    
    if (container) {
      const chunk = extractFacebookChunk(container, element, linkRegex, url, { includeAds });
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
 * Extract a single chunk from a Facebook post element
 */
function extractFacebookChunk(container, linkElement, linkRegex, pageUrl, options = {}) {
  const { includeAds } = options;

  if (!container || isElementHidden(container)) {
    return null;
  }

  const clone = container.cloneNode(true);
  
  // Remove unwanted elements
  const unwanted = clone.querySelectorAll('script, style, noscript, iframe, nav, header, footer');
  unwanted.forEach(el => el.remove());

  // Extract post text
  const postTextEl = clone.querySelector('[data-ad-preview="message"], [data-testid="post_message"], .userContent');
  const postText = postTextEl ? postTextEl.textContent.trim() : '';

  // Extract link information
  const linkText = linkElement ? linkElement.textContent.trim() : '';
  const linkUrl = linkElement?.closest('a')?.href || '';

  // Extract author
  const authorEl = clone.querySelector('[data-testid="story-subtitle"], .x1i10hfl');
  const author = authorEl ? authorEl.textContent.trim() : '';

  // Combine text
  const textParts = [author, postText, linkText].filter(Boolean);
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
      platform: 'facebook',
      elementType: container.tagName.toLowerCase(),
      classes: Array.from(container.classList)
    },
    xpath: generateXPath(container),
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

