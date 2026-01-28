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

  while (current && current.nodeType === Node.ELEMENT_NODE) {
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
  
  // Only check computed style if element is in the live DOM
  // For cloned elements or parsed HTML, skip this check
  try {
    if (element.ownerDocument && element.ownerDocument.defaultView && 
        element.ownerDocument.body && element.ownerDocument.body.contains(element)) {
      const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
        return true;
      }
    }
  } catch (e) {
    // If getComputedStyle fails (element not in DOM), continue
  }
  
  return false;
}

