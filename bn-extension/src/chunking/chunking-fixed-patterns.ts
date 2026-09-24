/**
 * Regex/Selector-based chunking strategy
 * Uses CSS selectors and semantic patterns to identify content chunks
 */

import {isElementHidden,
  generateXPath,
  isScreenReaderOnly,
  NON_CONTENT_SELECTOR, parseHTML} from './chunking-utils.js';
import { accessibleLinkName, findHeadlineLink } from './headline-link.js';
import { inferAdvert, TAG } from './chunk-tags.js';

/**
 * Extract content chunks using regex/selector-based strategy
 */
export function extractChunksRegex(source: Document | Element | string, url = '', options: any = {}) {
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
      const chunk = extractChunkFromElement(element, { includeAds, url });
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
        const chunk = extractChunkFromElement(element, { includeAds, url });
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
      const fallbackChunks = splitBySemanticBoundaries(mainContent, { minTextLength, url });
      chunks.push(...fallbackChunks);
    }
  }

  // Filter out duplicates and ads
  const uniqueChunks = deduplicateChunks(chunks);
  const filteredChunks = includeAds
    ? uniqueChunks
    : uniqueChunks.filter((chunk) => !inferAdvert(chunk, url));

  // Limit number of chunks
  return filteredChunks.slice(0, maxChunks);
}

/**
 * Extract content from a single element
 */
function extractChunkFromElement(element: Element, options: any = {}) {
  const { includeAds, url } = options;

  // Skip if element is hidden or too small
  if (isElementHidden(element) || getElementTextLength(element) < 50) {
    return null;
  }

  // Skip ads unless explicitly included
  if (!includeAds && isLikelyAdElement(element)) {
    return null;
  }

  const clone = element.cloneNode(true) as Element;
  
  // Remove unwanted elements
  const unwanted = clone.querySelectorAll(
    `${NON_CONTENT_SELECTOR}, iframe, nav, header, footer, aside, .ad, .advertisement, [class^="ad-"], [class*=" ad-"], [class*="-ad-"], [id^="ad-"], [id*=" ad-"], [id*="-ad-"]`
  );
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
    .map((a: Element) => {
      const href = a.getAttribute('href') || a.href || '';
      const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
      return {
        url: href,
        text: a.textContent.trim().substring(0, 100),
        // A card's story link wraps the image and has no text; its headline is the aria-label.
        label: accessibleLinkName(a).substring(0, 200),
        isExternal: href.startsWith('http') && origin && !href.startsWith(origin)
      };
    })
    .slice(0, 10);

  // Extract images
  const images = Array.from(clone.querySelectorAll('img'))
    .filter((img: HTMLImageElement) => img.src && !img.src.startsWith('data:'))
    .map((img: HTMLImageElement) => ({
      src: img.src,
      alt: img.alt || '',
      title: img.title || ''
    }))
    .slice(0, 5);

  const contentTag =
    ['article', 'main'].includes(metadata.elementType) ||
    element.matches?.('article, [role="article"]')
      ? TAG.ARTICLE
      : TAG.OTHER;

  const heading = element.querySelector('h1, h2, h3, h4, h5, h6')?.textContent?.trim() || '';

  return {
    id: generateChunkId(element),
    text,
    html: clone.innerHTML,
    metadata,
    links,
    // Resolved against the live element, not the pruned clone: a card's story anchor often
    // sits outside the heading, and picking the wrong one makes click-unbait describe a
    // different article.
    primaryLink: heading ? findHeadlineLink(element, heading, url) : null,
    images,
    tags: [contentTag],
    position: getElementPosition(element),
    xpath: generateXPath(element),
  };
}

/** Matches the per-chunk caps used when a whole element becomes a chunk. */
const MAX_CHUNK_LINKS = 10;
const MAX_CHUNK_IMAGES = 5;

/** Sections longer than this are a page region, not a story; they get split further. */
const MAX_SECTION_CHARS = 2000;

/** Layout the reader never reads as prose. */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'nav', 'header', 'footer', 'form',
]);

/**
 * Split content by semantic boundaries (headings, paragraphs, etc.).
 *
 * Text is collected from text nodes only. Collecting `textContent` from container
 * elements *and* their descendants counted every string once per nesting level — a BBC
 * headline list came out repeated four times, which then became the fact-check query.
 */
function splitBySemanticBoundaries(element: Element, options: any = {}) {
  const { minTextLength = 100 } = options;
  const chunks = [];

  // Split by headings (h1-h6)
  const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6');

  if (headings.length > 0) {
    /** Anchor and title come from the heading that *opens* the section. */
    let sectionHeading: Element | null = null;
    let parts: string[] = [];
    let links = [];
    let images = [];

    const flush = () => {
      const text = collapseRepeats(parts.join(' '));
      const sectionLinks = links.slice(0, MAX_CHUNK_LINKS);
      const sectionImages = images.slice(0, MAX_CHUNK_IMAGES);
      parts = [];
      links = [];
      images = [];
      if (text.length < minTextLength) return;
      const anchor = sectionHeading || element;
      const heading = sectionHeading ? sectionHeading.textContent.trim() : '';
      chunks.push({
        id: generateChunkId(anchor),
        text,
        // Same shape as a chunk taken from a whole element, so consumers do not have to
        // care which strategy produced the chunk.
        metadata: {
          heading: heading || null,
          elementType: anchor.tagName.toLowerCase(),
          classes: Array.from(anchor.classList),
          id: anchor.id || null,
          dataAttributes: extractDataAttributes(anchor),
        },
        links: sectionLinks,
        // The section's links are collected in document order, which on a card grid files
        // the *next* card's story anchor under this heading. Resolve the heading's own
        // link from the DOM instead, so click-unbait cannot summarise the neighbour.
        primaryLink: heading ? findHeadlineLink(anchor, heading, options.url) : null,
        images: sectionImages,
        tags: [TAG.ARTICLE],
        position: null,
        xpath: generateXPath(anchor),
      });
    };

    const walker = element.ownerDocument.createTreeWalker(
      element,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            const tag = el.tagName.toLowerCase();
            // REJECT prunes the subtree: no text from hidden or non-content branches.
            if (SKIP_TAGS.has(tag) || isScreenReaderOnly(el) || isElementHidden(el)) {
              return NodeFilter.FILTER_REJECT;
            }
            // Headings are boundaries; links and images are collected for the section.
            // Their text still arrives separately as text-node children.
            const wanted = /^h[1-6]$/.test(tag) || tag === 'img' || (tag === 'a' && el.hasAttribute('href'));
            return wanted ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
          return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        const tag = el.tagName.toLowerCase();
        if (tag === 'a') {
          links.push(describeLink(el));
          continue;
        }
        if (tag === 'img') {
          const image = describeImage(el as HTMLImageElement);
          if (image) images.push(image);
          continue;
        }
        flush();
        sectionHeading = el;
        continue;
      }
      parts.push(node.textContent.trim());
      // A region with no inner headings (a whole teaser list) would otherwise become one
      // unanalysable chunk.
      if (parts.join(' ').length >= MAX_SECTION_CHARS) flush();
    }

    flush();
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
            tags: [TAG.ARTICLE],
            position: null,
            xpath: generateXPath(p),
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
          tags: [TAG.ARTICLE],
          position: null,
          xpath: generateXPath(element),
        });
      }
    }
  }

  return chunks;
}

/**
 * Teaser cards repeat their headline in the link text, the image caption and the
 * "read more" label, so the same sentence lands in one chunk several times over. Keep the
 * first occurrence of each run of words; a genuine repeat inside prose is rare and harmless
 * to lose from a chunk used for scoring.
 */
export function collapseRepeats(text: string): string {
  const normalised = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalised) return '';
  const segments = normalised.split(/(?<=[.!?])\s+|\s*[|·•]\s*/);
  const seen = new Set<string>();
  const kept = [];
  for (const segment of segments) {
    const key = segment.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(segment.trim());
  }
  return kept.join(' ');
}

function describeLink(anchor: Element) {
  const href = anchor.getAttribute('href') || (anchor as HTMLAnchorElement).href || '';
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  return {
    url: href,
    text: (anchor.textContent || '').trim().substring(0, 100),
    // A card's story link wraps the image and has no text; its headline is the aria-label.
    label: accessibleLinkName(anchor).substring(0, 200),
    isExternal: href.startsWith('http') && !!origin && !href.startsWith(origin),
  };
}

function describeImage(img: HTMLImageElement) {
  const src = img.getAttribute('src') || img.src || '';
  if (!src || src.startsWith('data:')) return null;
  return { src, alt: img.alt || '', title: img.title || '' };
}

/**
 * Check if element is likely an advertisement
 */
export function isLikelyAdElement(element) {
  // Check class names - use word boundaries to avoid false positives
  // e.g., "adtqdayogch0dyrgtrx6" shouldn't match "ad"
  const adClasses = ['ad', 'advertisement', 'advert', 'sponsored', 'promo', 'promotion'];
  const classes = Array.from(element.classList).map((c: string) => c.toLowerCase());
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
    const parentClasses = Array.from(parent.classList || []).map((c: string) => c.toLowerCase());
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
  const clone = element.cloneNode(true) as Element;
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
