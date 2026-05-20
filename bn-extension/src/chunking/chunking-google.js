/**
 * Custom chunker for Google Search results
 * Based on stopaganda-g.js selectors
 */

import { isElementHidden, generateXPath } from './chunking-utils.js';

/**
 * Extract chunks from Google Search results
 */
export function extractChunksGoogle(source, url, options = {}) {
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

  // Check which tab we're on
  const tabCheck = doc.getElementsByClassName('MgQdud');
  let isNewsTab = false;
  let isVideosTab = false;

  if (tabCheck.length > 0) {
    const tabText = tabCheck[0].textContent;
    if (tabText === 'News') {
      isNewsTab = true;
    } else if (tabText === 'Videos') {
      isVideosTab = true;
    }
  }

  if (isNewsTab) {
    // News tab - use .WlydOe selector
    const linkClass = '.WlydOe';
    const standard = doc.querySelectorAll(linkClass);
    
    for (const element of standard) {
      const chunk = extractGoogleChunk(element, linkRegex, url, { includeAds });
      if (chunk && chunk.text.length >= minTextLength) {
        chunks.push(chunk);
      }
    }
  } else if (isVideosTab) {
    // Videos tab - use .iUh30 selector
    const linkClass = '.iUh30';
    const vids = doc.querySelectorAll(linkClass);
    
    for (const element of vids) {
      const chunk = extractGoogleChunk(element, linkRegex, url, { includeAds });
      if (chunk && chunk.text.length >= minTextLength) {
        chunks.push(chunk);
      }
    }
  } else {
    // Default tab - standard links and cards
    // Use the main result container (.tF2Cxc) which contains the entire search result
    // Limit to first 100 containers to avoid performance issues
    const allContainers = doc.querySelectorAll('.tF2Cxc, .g');
    const resultContainers = Array.from(allContainers).slice(0, 100);
    
    for (const container of resultContainers) {
      // Early exit if we have enough chunks
      if (chunks.length >= maxChunks) {
        break;
      }
      
      // Check if this is actually a search result (has title and link)
      const hasTitle = container.querySelector('h3, h2, .LC20lb, .DKV0Md');
      const hasLink = container.querySelector('cite, .tjvcx.GvPZzd.cHaqb, a[href]');
      
      if (hasTitle && hasLink) {
        try {
          const chunk = extractGoogleChunk(container, linkRegex, url, { includeAds });
          if (chunk && chunk.text && chunk.text.length >= minTextLength) {
            chunks.push(chunk);
          }
        } catch (error) {
          // Skip chunks that cause errors during extraction
          console.warn('[BetterNet] [CHUNKING-GOOGLE] Error extracting chunk:', error.message);
        }
      }
    }
    
    // Also check for cards (limit to 50 to avoid performance issues)
    if (chunks.length < maxChunks) {
      const cardClass = '.WlydOe, .ddkIM.c30Ztd';
      const allCards = doc.querySelectorAll(cardClass);
      const cards = Array.from(allCards).slice(0, 50);
      for (const element of cards) {
        if (chunks.length >= maxChunks) {
          break;
        }
        const chunk = extractGoogleChunk(element, linkRegex, url, { includeAds });
        if (chunk && chunk.text.length >= minTextLength) {
          chunks.push(chunk);
        }
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
 * Extract a single chunk from a Google result element
 */
function extractGoogleChunk(element, linkRegex, pageUrl, options = {}) {
  const { includeAds } = options;

  if (!element || isElementHidden(element)) {
    return null;
  }

  const clone = element.cloneNode(true);
  
  // Remove unwanted elements
  const unwanted = clone.querySelectorAll('script, style, noscript, iframe, nav, header, footer');
  unwanted.forEach(el => el.remove());

  // Extract title
  const titleEl = clone.querySelector('h3, h2, .LC20lb, .DKV0Md');
  const title = titleEl ? titleEl.textContent.trim() : '';

  // Extract site name (VuuXrf)
  const siteNameEl = clone.querySelector('.VuuXrf');
  const siteName = siteNameEl ? siteNameEl.textContent.trim() : '';

  // Extract URL/link (cite element)
  const linkEl = clone.querySelector('cite, .tjvcx.GvPZzd.cHaqb, a[href]');
  let linkUrl = '';
  let linkText = '';
  if (linkEl) {
    linkUrl = linkEl.href || linkEl.textContent || '';
    linkText = linkEl.textContent.trim();
  }

  // Extract snippet/description
  const snippetEl = clone.querySelector('.VwiC3b, .yXK7lf, .s, .st');
  const snippet = snippetEl ? snippetEl.textContent.trim() : '';

  // Extract image alt text if present
  const imgEl = clone.querySelector('img[alt]');
  const imgAlt = imgEl ? imgEl.alt.trim() : '';

  // Extract related links
  const relatedLinks = Array.from(clone.querySelectorAll('.KTAFWb a, .qXOWAb'))
    .map(a => a.textContent.trim())
    .filter(Boolean);

  // Combine text - match expected format: title, site name, URL, snippet, image alt, related links
  // Use newlines to match expected format
  const textParts = [];
  if (title) textParts.push(title);
  if (siteName) textParts.push(siteName);
  if (linkText) textParts.push(linkText);
  if (snippet) textParts.push(snippet);
  if (imgAlt) textParts.push(imgAlt);
  if (relatedLinks.length > 0) textParts.push(...relatedLinks);
  
  const text = textParts.join('\n').trim();

  // Minimum text length check is done by caller, but ensure we have some content
  if (!text || text.length < 10) {
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
      platform: 'google',
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
  return adKeywords.some(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(text));
}

/**
 * Parse HTML string to DOM
 */
function parseHTML(html) {
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }
  // Fallback for environments without DOMParser
  return null;
}

