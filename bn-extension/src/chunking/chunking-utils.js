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
    }
  } catch (e) {
    // ignore
  }

  return false;
}

