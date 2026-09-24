/**
 * Custom chunker for X (twitter.com / x.com).
 *
 * X renders a React tree with generated class names, so the generic chunker finds nothing
 * (0 chunks on a post permalink). The `data-testid` hooks below are the stable handles X
 * exposes for its own tests, and are what every X scraper keys on.
 */

import {isElementHidden, generateXPath, NON_CONTENT_SELECTOR, parseHTML} from './chunking-utils.js';
import { TAG } from './chunk-tags.js';

/** Post container, most specific first. */
const POST_SELECTORS = [
  'article[data-testid="tweet"]',
  '[data-testid="cellInnerDiv"] article',
  'article[role="article"]',
];

/** Promoted posts carry X's ad placement wrapper. */
const AD_SELECTOR = '[data-testid="placementTracking"]';

export function extractChunksX(source: Document | Element | string, url, options: any = {}) {
  const { minTextLength = 100, maxChunks = 50, includeAds = false } = options;

  const doc = typeof source === 'string' ? parseHTML(source) : source;
  if (!doc) return [];

  const chunks = [];
  const seen = new Set<Element>();

  for (const selector of POST_SELECTORS) {
    for (const post of doc.querySelectorAll(selector)) {
      if (seen.has(post)) continue;
      seen.add(post);
      const chunk = extractXChunk(post, url);
      if (!chunk) continue;
      if (!includeAds && chunk.tags.includes(TAG.ADVERT)) continue;
      if (chunk.text.length >= minTextLength) chunks.push(chunk);
    }
  }

  return chunks.slice(0, maxChunks);
}

function extractXChunk(element: Element, pageUrl) {
  if (!element || isElementHidden(element)) return null;

  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(NON_CONTENT_SELECTOR).forEach((el) => el.remove());

  const postText = textOf(clone, '[data-testid="tweetText"]');
  const author = textOf(clone, '[data-testid="User-Name"]');
  // The link card holds the headline of a shared article, which the post text may not.
  const card = textOf(clone, '[data-testid="card.wrapper"], [data-testid="card.layoutLarge.detail"]');
  const timestamp = textOf(clone, 'time');

  const text = [author, postText, card, timestamp].filter(Boolean).join('\n').trim();
  if (!text || text.length < 50) return null;

  const links = Array.from(clone.querySelectorAll('a[href]'))
    .map((a: Element) => ({
      url: a.getAttribute('href') || '',
      text: a.textContent.trim().substring(0, 100),
      // X shortens outbound links through t.co, so the display text is the readable part.
      isExternal: (a.getAttribute('href') || '').startsWith('http'),
    }))
    .filter((link) => link.url)
    .slice(0, 10);

  const images = Array.from(clone.querySelectorAll('img'))
    .filter((img: HTMLImageElement) => img.src && !img.src.startsWith('data:'))
    .map((img: HTMLImageElement) => ({ src: img.src, alt: img.alt || '', title: img.title || '' }))
    .slice(0, 5);

  const isAd = !!element.querySelector(AD_SELECTOR) || !!element.closest?.(AD_SELECTOR);

  return {
    url: pageUrl,
    text,
    html: clone.innerHTML,
    links,
    images,
    metadata: {
      platform: 'x',
      elementType: element.tagName.toLowerCase(),
      classes: Array.from(element.classList),
      author,
    },
    tags: isAd ? [TAG.POST, TAG.ADVERT] : [TAG.POST],
    xpath: generateXPath(element),
    isPrimary: false,
  };
}

function textOf(root: Element, selector: string): string {
  const el = root.querySelector(selector);
  return el ? el.textContent.trim() : '';
}
