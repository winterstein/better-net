/**
 * Detect sponsored posts in the Facebook feed.
 * Uses Comet ad DOM attributes, aria-label, plain/obfuscated "Sponsored" labels.
 */

export const BN_BLOCKED_ATTR = 'data-bn-ad-blocked';
export const BN_PREVIEW_ATTR = 'data-bn-ad-preview';

const FEED_POST_SELECTORS = [
  '[role="article"]',
  'div[data-pagelet^="FeedUnit_"]',
  'div[id^="hyperfeed_story_id_"]',
];

const AD_DOM_MARKERS =
  '[data-ad-rendering-role], [data-ad-preview], [data-ad-comet-preview], [data-ad-video]';

/**
 * @param {string} hostname
 */
export function isFacebookHost(hostname) {
  const host = (hostname || '').replace(/^www\./, '').toLowerCase();
  return host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.com';
}

/**
 * @param {Element} el
 */
function isAdPostContainer(el) {
  if (!el?.querySelector || el === document.body || el === document.documentElement) {
    return false;
  }
  const profiles = el.querySelectorAll('[data-ad-rendering-role="profile_name"]');
  if (profiles.length !== 1) return false;
  const hasBody =
    el.querySelector('[data-ad-rendering-role="story_message"]') ||
    el.querySelector('[data-ad-preview="message"]') ||
    el.querySelector('[data-ad-comet-preview="message"]') ||
    el.querySelector('[data-ad-video]');
  return Boolean(hasBody);
}

/**
 * @param {Element | null} el
 * @returns {Element | null}
 */
export function findFacebookFeedPostRoot(el) {
  if (!el) return null;

  for (const selector of FEED_POST_SELECTORS) {
    const root = el.closest(selector);
    if (root) return root;
  }

  let node = el;
  for (let depth = 0; depth < 40 && node; depth++) {
    if (isAdPostContainer(node)) return node;

    const parent = node.parentElement;
    if (parent?.matches?.('[role="feed"]')) return node;

    for (const selector of FEED_POST_SELECTORS) {
      if (node.matches?.(selector)) return node;
    }
    node = parent;
  }

  return el.closest('[data-pagelet]');
}

/**
 * Letters split across flex child spans (e.g. s + p + o + n + s + o + r + e + d).
 * @param {Element} element
 */
function hasObfuscatedSponsoredLabel(element) {
  for (const group of element.querySelectorAll(
    'span[style*="display: flex"], span[style*="display:flex"]'
  )) {
    const letters = [...group.children]
      .filter((child) => child.tagName === 'SPAN')
      .map((span) => (span.textContent || '').trim())
      .join('')
      .replace(/\s+/g, '');
    if (/^sponsored/i.test(letters)) return true;
  }

  for (const labelled of element.querySelectorAll('[aria-labelledby]')) {
    const text = (labelled.textContent || '').replace(/\s+/g, '');
    if (text.length > 0 && text.length <= 24 && /^sponsored/i.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {Element} element — feed post container or subtree
 */
export function isFacebookSponsoredPost(element) {
  if (!element?.querySelector) return false;

  if (element.querySelector(AD_DOM_MARKERS)) {
    return true;
  }

  if (element.querySelector('[aria-label="Sponsored"]')) {
    return true;
  }

  for (const span of element.querySelectorAll('span')) {
    const text = span.textContent?.trim() || '';
    if (text === 'Sponsored' || text.startsWith('Sponsored ')) {
      return true;
    }
  }

  if (hasObfuscatedSponsoredLabel(element)) {
    return true;
  }

  for (const hidden of element.querySelectorAll('b[style*="display: none"]')) {
    const span = hidden.closest('span');
    if (span?.textContent?.trim().startsWith('Sponsored')) {
      return true;
    }
  }

  return false;
}

/**
 * Plain "Sponsored" section title (right rail), not a feed post subtitle.
 * @param {Element} el
 */
function isSponsoredSidebarHeading(el) {
  if (el.textContent?.trim() !== 'Sponsored') return false;
  if (el.closest('[role="feed"]')) return false;
  if (el.closest('[data-ad-rendering-role="profile_name"]')) return false;
  return true;
}

/**
 * @param {Element} heading
 * @returns {Element | null}
 */
function findSponsoredSidebarRoot(heading) {
  let node = heading.parentElement;
  for (let depth = 0; depth < 18 && node; depth++) {
    if (node.matches?.('[role="complementary"]')) return node;
    if (node.id === 'rightCol') return node;

    const pagelet = node.getAttribute?.('data-pagelet') || '';
    if (/ego|right.?rail|RightRail/i.test(pagelet)) return node;

    const adLinks = node.querySelectorAll(
      'a[href*="l.facebook.com/l.php"], a[href*="l.facebook.com/l.php?"]'
    );
    if (adLinks.length >= 1 && depth >= 2) return node;

    node = node.parentElement;
  }

  return heading.closest('[role="complementary"]') || heading.parentElement?.parentElement;
}

/**
 * Right-hand "Sponsored" ad column (outside the main feed).
 * @param {ParentNode} [root]
 * @returns {Element[]}
 */
export function findSponsoredSidebarRoots(root = document) {
  const panels = new Set();

  for (const region of root.querySelectorAll('[role="complementary"]')) {
    if (region.closest('[role="feed"]')) continue;
    const heading = [...region.querySelectorAll('span')].find((s) =>
      isSponsoredSidebarHeading(s)
    );
    if (heading) {
      const panel = findSponsoredSidebarRoot(heading);
      if (panel) panels.add(panel);
    }
  }

  for (const span of root.querySelectorAll('span')) {
    if (!isSponsoredSidebarHeading(span)) continue;
    const panel = findSponsoredSidebarRoot(span);
    if (panel && !panel.closest('[role="feed"]')) {
      panels.add(panel);
    }
  }

  return dedupeNestedElements([...panels]);
}

/**
 * Keep outermost nodes when one panel wraps another.
 * @param {Element[]} elements
 */
function dedupeNestedElements(elements) {
  return elements.filter(
    (el) => !elements.some((other) => other !== el && other.contains(el))
  );
}

/**
 * @param {Element[]} elements
 */
function hideElements(elements) {
  let blocked = 0;
  for (const el of elements) {
    if (el.getAttribute(BN_BLOCKED_ATTR)) continue;
    el.setAttribute(BN_BLOCKED_ATTR, '1');
    el.style.setProperty('display', 'none', 'important');
    blocked++;
  }
  return blocked;
}

/**
 * @param {ParentNode} root
 * @param {Set<Element>} posts
 */
function addPostFromMarker(root, marker, posts) {
  const post = findFacebookFeedPostRoot(marker);
  if (post && isFacebookSponsoredPost(post)) {
    posts.add(post);
  }
}

/**
 * Feed post roots that contain sponsored markers.
 * @param {ParentNode} [root]
 * @returns {Element[]}
 */
export function findSponsoredFacebookFeedPosts(root = document) {
  const posts = new Set();

  for (const marker of root.querySelectorAll(AD_DOM_MARKERS)) {
    addPostFromMarker(root, marker, posts);
  }

  for (const marker of root.querySelectorAll('[aria-label="Sponsored"]')) {
    addPostFromMarker(root, marker, posts);
  }

  for (const span of root.querySelectorAll('span')) {
    const text = span.textContent?.trim() || '';
    if (text !== 'Sponsored' && !text.startsWith('Sponsored ')) continue;
    if (isSponsoredSidebarHeading(span)) continue;
    addPostFromMarker(root, span, posts);
  }

  for (const flex of root.querySelectorAll(
    'span[style*="display: flex"], span[style*="display:flex"]'
  )) {
    if (hasObfuscatedSponsoredLabel(flex)) {
      addPostFromMarker(root, flex, posts);
    }
  }

  return [...posts];
}

/**
 * Hide sponsored feed units and right-rail sidebar. Returns number newly blocked.
 * @param {ParentNode} [root]
 */
export function blockSponsoredFacebookFeedPosts(root = document) {
  return (
    hideElements(findSponsoredFacebookFeedPosts(root)) +
    hideElements(findSponsoredSidebarRoots(root))
  );
}
