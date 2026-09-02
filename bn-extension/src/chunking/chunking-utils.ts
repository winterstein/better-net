/**
 * Shared utility functions for chunking modules
 */

/**
 * Generate XPath for an element
 * 
 * @param {Element} element - The element to generate XPath for
 * @returns {string|null} XPath string or null if element is invalid
 */
export function generateXPath(element) {
  if (!element || !element.ownerDocument) {
    return null;
  }

  const parts = [];
  let current = element;
  const ELEMENT_NODE = 1;
  let depth = 0;

  while (current && current.nodeType === ELEMENT_NODE && depth < 64) {
    depth++;
    let index = 1;
    let sibling = current.previousElementSibling;
    
    while (sibling) {
      if (sibling.nodeName === current.nodeName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    const tagName = current.nodeName.toLowerCase();
    const xpathIndex = index > 1 ? `[${index}]` : '';
    parts.unshift(`${tagName}${xpathIndex}`);

    current = current.parentElement;
  }

  return parts.length > 0 ? '/' + parts.join('/') : null;
}

/**
 * Check if element is hidden
 * Only checks computed style if element is in the live DOM.
 * For cloned elements or parsed HTML, skips this check.
 * 
 * @param {Element} element - The element to check
 * @returns {boolean} True if element is hidden or doesn't exist
 */
export function isElementHidden(element) {
  if (!element) return true;

  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
    return true;
  }

  const inlineDisplay = element.style?.display;
  if (inlineDisplay === 'none' || inlineDisplay === 'hidden') {
    return true;
  }

  // getComputedStyle is unreliable for saved HTML / happy-dom (often reports display:none)
  try {
    const view = element.ownerDocument?.defaultView;
    if (view?.getComputedStyle && element.ownerDocument?.body?.contains(element)) {
      const style = view.getComputedStyle(element);
      if (style?.visibility === 'hidden' || style?.opacity === '0') {
        return true;
      }
      if (style?.display === 'none' && style?.visibility === 'hidden') {
        return true;
      }
      // The clip-rect pattern: a 1px box, clipped, positioned out of flow. Bootstrap's
      // .sr-only, X's `r-*` utilities and GOV.UK all do this, with class names we cannot
      // enumerate — X's "To view keyboard shortcuts, press question mark" heading was being
      // chunked as a story. Shape is the reliable signal.
      const tiny = parseFloat(style?.width) <= 1 && parseFloat(style?.height) <= 1;
      const clipped =
        (style?.clip && style.clip !== 'auto') ||
        (style?.clipPath && style.clipPath !== 'none') ||
        style?.overflow === 'hidden';
      if (tiny && clipped && (style?.position === 'absolute' || style?.position === 'fixed')) {
        return true;
      }
    }
  } catch (e) {
    // ignore
  }

  return false;
}


/**
 * Text that exists only for screen readers. BBC renders "Attribution", "Comments" and
 * "Video, 00:01:03" this way; sighted users never see it, and pulling it into chunk text
 * corrupts both the analysis prompt and the fact-check query.
 * Class names are the usual conventions, not one site's markup.
 */
export const SCREEN_READER_ONLY_SELECTOR = [
  '.visually-hidden',
  '.visuallyhidden',
  '.visually-hidden-focusable',
  '.sr-only',
  '.screen-reader-text',
  '.screen-reader-only',
  '.a11y-hidden',
  '.hidden-visually',
  '[aria-hidden="true"]',
].join(', ');

/**
 * Our own injected UI. After an SPA navigation the page is chunked again with the previous
 * run's nutrient labels still in the DOM, so "Safe ×" would be read back as page content.
 */
export const OWN_UI_SELECTOR = '[class^="betternet-"], [class*=" betternet-"], [id^="betternet-"]';

/** Never part of the readable content of a chunk. */
export const NON_CONTENT_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  OWN_UI_SELECTOR,
  SCREEN_READER_ONLY_SELECTOR,
].join(', ');

export function isScreenReaderOnly(element: Element): boolean {
  return !!element?.matches?.(SCREEN_READER_ONLY_SELECTOR);
}

/**
 * Element text as a sighted reader sees it: screen-reader-only spans dropped. BBC teasers
 * carry a hidden copy of the headline ("Video, 00:01:03<headline>"), which otherwise lands
 * in the chunk twice.
 */
export function visibleText(element: Element): string {
  if (!element) return '';
  const clean = (text: string) => (text || '').replace(/\s+/g, ' ').trim();
  if (!element.querySelector?.(NON_CONTENT_SELECTOR)) return clean(element.textContent);
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(NON_CONTENT_SELECTOR).forEach((el) => el.remove());
  return clean(clone.textContent);
}
