/**
 * Utility functions for content script
 */

/** Stable fingerprint hash (browser-safe; no Node crypto). */
export function hash(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Wait for page JavaScript to render content
 * Waits for the page to be fully loaded and for content elements to appear
 * 
 * @param {number} maxWaitMs - Maximum time to wait in milliseconds (default: 3000)
 * @param {number} checkIntervalMs - How often to check for content in milliseconds (default: 200)
 * @returns {Promise<void>}
 */
export async function waitForContentRender(maxWaitMs = 3000, checkIntervalMs = 200) {
  // First, wait for page to be fully loaded
  if (document.readyState !== 'complete') {
    await new Promise(resolve => {
      if (document.readyState === 'complete') {
        resolve();
      } else {
        window.addEventListener('load', resolve, { once: true });
      }
    });
  }

  // Wait a bit for initial JS execution
  await new Promise(resolve => setTimeout(resolve, 100));

  // to handle any page -- see if the 100ms wait is enough in practice before implementing more complex logic
//   const startTime = Date.now();
//   const endTime = startTime + maxWaitMs;

//   // Common selectors that indicate content has been rendered
//   const contentSelectors = [
//     'article',
//     '[data-testid="result"]',
//     'main',
//     '.result',
//     '[role="main"]',
//     '.content',
//     '#content'
//   ];

//   // Check if content is present
//   const hasContent = () => {
//     // Check if any content selectors match
//     for (const selector of contentSelectors) {
//       try {
//         const elements = document.querySelectorAll(selector);
//         if (elements.length > 0) {
//           // Check if elements have meaningful text content
//           for (const el of elements) {
//             const text = el.textContent?.trim() || '';
//             if (text.length > 50) {
//               return true;
//             }
//           }
//         }
//       } catch (e) {
//         // Invalid selector, continue
//       }
//     }
//     return false;
//   };

//   // If content is already present, return immediately
//   if (hasContent()) {
//     return;
//   }

//   // Wait for content to appear
//   while (Date.now() < endTime) {
//     if (hasContent()) {
//       // Content appeared, wait a bit more for any additional rendering
//       await new Promise(resolve => setTimeout(resolve, 300));
//       return;
//     }
//     await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
//   }

//   // Timeout reached, but continue anyway
//   console.log('[BetterNet] [CONTENT] Timeout waiting for content render, proceeding anyway');
}

/**
 * Find an element by XPath
 * @param {string} xpath - XPath expression to find the element
 * @returns {Element|null} The found element or null if not found
 */
export function findElementByXPath(xpath) {
  try {
    // Try using native browser XPath API first (more reliable)
    if (document.evaluate) {
      try {
        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        if (result.singleNodeValue) {
          return result.singleNodeValue;
        }
      } catch (xpathError) {
        // If XPath evaluation fails, fall back to manual parsing
        console.warn('[BetterNet] [CONTENT] XPath evaluation failed, trying manual parsing:', xpathError.message);
      }
    }

    // Fallback: Manual XPath parsing
    // XPath format: /html/body/div[2]/article[1]
    const parts = xpath.split('/').filter(p => p);
    if (parts.length === 0) return null;

    let element = document;
    
    for (const part of parts) {
      if (!element) {
        console.warn('[BetterNet] [CONTENT] Element is null/undefined at part:', part);
        return null;
      }

      if (part === 'html') {
        element = element.documentElement || element;
      } else if (part === 'body') {
        element = element.body || element;
      } else {
        // Parse tag[index] format
        const match = part.match(/^(\w+)(?:\[(\d+)\])?$/);
        if (!match) {
          console.warn('[BetterNet] [CONTENT] Could not parse xpath part:', part);
          continue;
        }

        const tagName = match[1].toLowerCase();
        const index = match[2] ? parseInt(match[2], 10) - 1 : 0;

        // Get children - handle both element.children and childNodes
        let children = [];
        if (element.children) {
          children = Array.from(element.children);
        } else if (element.childNodes) {
          children = Array.from(element.childNodes).filter(
            node => node.nodeType === Node.ELEMENT_NODE
          );
        } else {
          console.warn('[BetterNet] [CONTENT] Element has no children property:', element);
          return null;
        }

        // Filter by tag name
        const matchingChildren = children.filter(
          el => el.tagName && el.tagName.toLowerCase() === tagName
        );

        if (matchingChildren[index]) {
          element = matchingChildren[index];
        } else {
          console.warn('[BetterNet] [CONTENT] Could not find child at index', index, 'for tag', tagName, 'in', element, 'matching children:', matchingChildren.length);
          return null;
        }
      }
    }

    return element;
  } catch (error) {
    console.error('Error finding element by xpath:'+xpath, error);
    return null;
  }
}

