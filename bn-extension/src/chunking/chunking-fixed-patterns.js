/**
 * Regex/Selector-based chunking strategy
 * Uses CSS selectors and semantic patterns to identify content chunks
 */

import { isElementHidden, generateXPath } from './chunking-utils.js';

/**
 * Extract content chunks using regex/selector-based strategy
 */
export function extractChunksRegex(source, options = {}) {
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

  // Strategy 1: Identify article/post elements
  const articleSelectors = [
    'article',
    '[role="article"]',
    '.post',
    '.article',
    '.entry',
    '.story',
    '.content-item',
    '[data-post-id]',
    '[data-article-id]'
  ];

  for (const selector of articleSelectors) {
    const elements = doc.querySelectorAll(selector);
    for (const element of elements) {
      const chunk = extractChunkFromElement(element, { includeAds });
      if (chunk && chunk.text.length >= minTextLength) {
        chunks.push(chunk);
      }
    }
  }

  // Strategy 2: Identify by common patterns (social media, forums, etc.)
  if (chunks.length === 0) {
    const socialPatterns = [
      '[data-testid*="post"]',
      '[data-testid*="tweet"]',
      '.status',
      '.comment',
      '.reply',
      '.thread'
    ];

    for (const selector of socialPatterns) {
      const elements = doc.querySelectorAll(selector);
      for (const element of elements) {
        const chunk = extractChunkFromElement(element, { includeAds });
        if (chunk && chunk.text.length >= minTextLength) {
          chunks.push(chunk);
        }
      }
    }
  }

  // Strategy 3: Fallback - split main content by semantic boundaries
  if (chunks.length === 0) {
    const mainContent = doc.querySelector('main, [role="main"], .content, #content, .main');
    if (mainContent) {
      const fallbackChunks = splitBySemanticBoundaries(mainContent, { minTextLength });
      chunks.push(...fallbackChunks);
    }
  }

  // Filter out duplicates and ads
  const uniqueChunks = deduplicateChunks(chunks);
  const filteredChunks = includeAds 
    ? uniqueChunks 
    : uniqueChunks.filter(chunk => !isLikelyAd(chunk));

  // Limit number of chunks
  return filteredChunks.slice(0, maxChunks);
}

/**
 * Extract content from a single element
 */
function extractChunkFromElement(element, options = {}) {
  const { includeAds } = options;

  // Skip if element is hidden or too small
  if (isElementHidden(element) || getElementTextLength(element) < 50) {
    return null;
  }

  // Skip ads unless explicitly included
  if (!includeAds && isLikelyAdElement(element)) {
    return null;
  }

  const clone = element.cloneNode(true);
  
  // Remove unwanted elements
  const unwanted = clone.querySelectorAll('script, style, noscript, iframe, nav, header, footer, aside, .ad, .advertisement, [class*="ad-"], [id*="ad-"]');
  unwanted.forEach(el => el.remove());

  const text = clone.textContent.trim();
  if (!text) {
    return null;
  }

  // Extract metadata
  const metadata = {
    elementType: element.tagName.toLowerCase(),
    classes: Array.from(element.classList),
    id: element.id || null,
    dataAttributes: extractDataAttributes(element)
  };

  // Extract links
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
    id: generateChunkId(element),
    text,
    html: clone.innerHTML,
    metadata,
    links,
    images,
    position: getElementPosition(element),
    xpath: generateXPath(element)
  };
}

/**
 * Split content by semantic boundaries (headings, paragraphs, etc.)
 */
function splitBySemanticBoundaries(element, options = {}) {
  const { minTextLength = 100 } = options;
  const chunks = [];

  // Split by headings (h1-h6)
  const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6');
  
  if (headings.length > 0) {
    let currentSection = [];
    let currentHeading = null;

    const walker = element.ownerDocument.createTreeWalker(
      element,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            return NodeFilter.FILTER_ACCEPT;
          }
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            if (['p', 'div', 'section', 'article'].includes(tag)) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE && /^h[1-6]$/i.test(node.tagName)) {
        // Save previous section if it has enough content
        if (currentSection.length > 0) {
          const text = currentSection.join(' ').trim();
          if (text.length >= minTextLength) {
            chunks.push({
              id: generateChunkId(node),
              text,
              metadata: { heading: currentHeading },
              links: [],
              images: [],
              position: null,
              xpath: generateXPath(node)
            });
          }
        }
        currentSection = [];
        currentHeading = node.textContent.trim();
      } else if (node.textContent) {
        currentSection.push(node.textContent.trim());
      }
    }

    // Handle last section
    if (currentSection.length > 0) {
      const text = currentSection.join(' ').trim();
      if (text.length >= minTextLength) {
        chunks.push({
          id: generateChunkId(element),
          text,
          metadata: { heading: currentHeading },
          links: [],
          images: [],
          position: null,
          xpath: generateXPath(element)
        });
      }
    }
  } else {
    // Fallback: split by paragraphs
    const paragraphs = element.querySelectorAll('p');
    let currentText = [];
    
    for (const p of paragraphs) {
      const text = p.textContent.trim();
      if (text) {
        currentText.push(text);
        
        // Create chunk when we have enough text
        if (currentText.join(' ').length >= minTextLength * 2) {
          chunks.push({
            id: generateChunkId(p),
            text: currentText.join(' ').trim(),
            metadata: {},
            links: [],
            images: [],
            position: null,
            xpath: generateXPath(p)
          });
          currentText = [];
        }
      }
    }

    // Handle remaining text
    if (currentText.length > 0) {
      const text = currentText.join(' ').trim();
      if (text.length >= minTextLength) {
        chunks.push({
          id: generateChunkId(element),
          text,
          metadata: {},
          links: [],
          images: [],
          position: null,
          xpath: generateXPath(element)
        });
      }
    }
  }

  return chunks;
}

/**
 * Check if element is likely an advertisement
 */
export function isLikelyAdElement(element) {
  // Check class names - use word boundaries to avoid false positives
  // e.g., "adtqdayogch0dyrgtrx6" shouldn't match "ad"
  const adClasses = ['ad', 'advertisement', 'advert', 'sponsored', 'promo', 'promotion'];
  const classes = Array.from(element.classList).map(c => c.toLowerCase());
  const hasAdClass = classes.some(c => {
    // Check if class exactly matches an ad keyword, or contains it as a whole word
    // (e.g., "ad-banner", "advertisement-box", but not "adtqdayogch0dyrgtrx6")
    return adClasses.some(ad => {
      // Exact match
      if (c === ad) return true;
      // Word boundary match (with separator like -, _, or at start/end)
      const wordBoundaryRegex = new RegExp(`(^|[^a-z])${ad}([^a-z]|$)`, 'i');
      return wordBoundaryRegex.test(c);
    });
  });
  
  // Check IDs - also use word boundaries
  const id = (element.id || '').toLowerCase();
  const hasAdId = adClasses.some(ad => {
    if (id === ad) return true;
    const wordBoundaryRegex = new RegExp(`(^|[^a-z])${ad}([^a-z]|$)`, 'i');
    return wordBoundaryRegex.test(id);
  });
  
  // Check data attributes
  const isSponsored = element.getAttribute('data-sponsored') === 'true' ||
                     element.getAttribute('data-ad') === 'true';
  
  // Check parent - use word boundaries here too
  let parent = element.parentElement;
  let depth = 0;
  while (parent && depth < 3) {
    const parentClasses = Array.from(parent.classList || []).map(c => c.toLowerCase());
    const parentHasAdClass = parentClasses.some(c => {
      return adClasses.some(ad => {
        if (c === ad) return true;
        const wordBoundaryRegex = new RegExp(`(^|[^a-z])${ad}([^a-z]|$)`, 'i');
        return wordBoundaryRegex.test(c);
      });
    });
    if (parentHasAdClass) {
      return true;
    }
    parent = parent.parentElement;
    depth++;
  }
  
  return hasAdClass || hasAdId || isSponsored;
}

/**
 * Check if chunk is likely an ad
 */
function isLikelyAd(chunk) {
  // Create a minimal element-like object for checking
  const fakeElement = {
    classList: chunk.metadata.classes || [],
    id: chunk.metadata.id || '',
    getAttribute: () => null, // Return null for data attributes when checking chunks
    parentElement: null
  };
  return isLikelyAdElement(fakeElement);
}

/**
 * Check if element is hidden
 */
// isElementHidden is now imported from chunking-utils.js
// Keeping this stub for backwards compatibility if needed, but it should use the imported version
// The original implementation is below for reference:
/*
function isElementHidden(element) {
  const style = window?.getComputedStyle?.(element);
  if (style) {
    // Check explicit CSS properties that indicate hiding
    if (style.display === 'none' || 
        style.visibility === 'hidden' || 
        style.opacity === '0') {
      return true;
    }
    
    // Only check dimensions if we're in a real browser environment
    // In test environments (like happy-dom), offsetHeight/offsetWidth may be 0
    // even for visible elements, so we need to be more lenient
    // Check if we can reliably determine visibility via dimensions
    // Only consider hidden if BOTH dimensions are 0 AND we have a computed style
    // (meaning the element is actually in the DOM and styled)
    if (element.offsetHeight === 0 && element.offsetWidth === 0) {
      // Additional check: if the element has no content at all, it might be hidden
      // But if it has text content, it's likely just not rendered in test environment
      const hasText = element.textContent && element.textContent.trim().length > 0;
      if (!hasText) {
        return true; // No content = likely hidden
      }
      // If it has text but 0 dimensions, assume it's a test environment quirk
      // and don't filter it out
    }
  }
  return false;
}
*/

/**
 * Get text length of element
 */
function getElementTextLength(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
  return clone.textContent.trim().length;
}

/**
 * Extract data attributes from element
 */
function extractDataAttributes(element) {
  const attrs = {};
  for (const attr of element.attributes || []) {
    if (attr.name.startsWith('data-')) {
      attrs[attr.name] = attr.value;
    }
  }
  return attrs;
}

/**
 * Get element position in document
 */
function getElementPosition(element) {
  if (typeof window === 'undefined' || !element.getBoundingClientRect) {
    return null;
  }
  
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    height: rect.height,
    width: rect.width
  };
}

/**
 * Generate unique ID for chunk
 */
function generateChunkId(element) {
  if (element.id) {
    return `chunk-${element.id}`;
  }
  if (element.getAttribute && element.getAttribute('data-id')) {
    return `chunk-${element.getAttribute('data-id')}`;
  }
  return `chunk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Remove duplicate chunks
 */
function deduplicateChunks(chunks) {
  const seen = new Set();
  const unique = [];

  for (const chunk of chunks) {
    // Create a signature based on text content
    const signature = chunk.text.substring(0, 200).toLowerCase().trim();
    const hash = simpleHash(signature);
    
    if (!seen.has(hash)) {
      seen.add(hash);
      unique.push(chunk);
    }
  }

  return unique;
}

/**
 * Simple hash function
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
}

/**
 * Parse HTML string to DOM (for Node.js environments)
 */
function parseHTML(html) {
  // Try DOMParser first (available in browsers and Chrome extension service workers)
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      // Check for parsing errors
      const parserError = doc.querySelector('parsererror');
      if (!parserError) {
        return doc;
      }
    } catch (error) {
      console.warn('DOMParser failed, trying alternative:', error);
    }
  }
  
  // Fallback: try document if available (for direct DOM passing)
  if (typeof document !== 'undefined' && html === document) {
    return html;
  }
  
  // Node.js environment - would need jsdom or similar
  throw new Error('HTML parsing requires DOMParser (browser) or jsdom (Node.js). For Node.js: const { JSDOM } = require("jsdom"); new JSDOM(html).window.document');
}

