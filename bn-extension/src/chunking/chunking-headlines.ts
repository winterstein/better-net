/**
 * Headline chunks: the teaser links around an article — ticker strips, "editor's picks",
 * sidebar spotlights, related-post lists. A fake headline is exactly the thing we want to
 * label, but these are far shorter than the main chunker's minTextLength, so they were
 * dropped everywhere.
 *
 * Deliberately selector-free (link shape + text shape) so it carries across news sites
 * rather than being tuned to one theme.
 */

import { generateXPath, isElementHidden, visibleText, parseHTML } from './chunking-utils.js';
import { accessibleLinkName, findHeadlineLink } from './headline-link.js';
import { TAG } from './chunk-tags.js';

/** Long enough to be a headline, short enough not to be a paragraph. */
const MIN_HEADLINE_CHARS = 30;
const MAX_HEADLINE_CHARS = 220;
const MIN_HEADLINE_WORDS = 5;
/** A whole sidebar of teasers is not worth analysing; the top ones are. */
const MAX_HEADLINES = 15;

/** Links that are site furniture rather than stories. */
const FURNITURE = 'nav, header, footer, form, aside nav, [role="navigation"], .menu, .slicknav_menu';

/** Archive and utility destinations that carry headline-length link text. */
const NON_STORY_HREF = /\/(category|tag|author|page|search|feed|comments?)\/|\/(19|20)\d\d\/\d\d\/?$|^mailto:|^javascript:|#/i;

interface HeadlineOptions {
  maxHeadlines?: number;
  /** Elements of chunks already found. Anything inside one of them is already analysed. */
  coveredElements?: Element[];
  /** Fallback when the chunk elements could not be resolved: their text. */
  coveredText?: string[];
}

/** Spotlight and "latest video" teasers are a bare heading with no link. */
const HEADINGS = 'h2, h3, h4, h5';

export function extractHeadlineChunks(source: Document | Element | string, url, options: HeadlineOptions = {}) {
  const { maxHeadlines = MAX_HEADLINES, coveredElements = [], coveredText = [] } = options;
  const doc = typeof source === 'string' ? parseHTML(source) : source;
  if (!doc) return [];

  const covered = coveredText.map(compareKey).filter(Boolean);
  const seen = new Set<string>();
  const chunks = [];

  for (const candidate of doc.querySelectorAll(`a[href], ${HEADINGS}`)) {
    if (chunks.length >= maxHeadlines) break;
    const link = candidate.matches('a[href]') ? candidate : null;
    const headline = link ? headlineText(link, url) : headingText(candidate);
    if (!headline) continue;

    const key = compareKey(headline);
    if (seen.has(key)) continue;
    // Coverage is checked on the headline, not the element text: a thumbnail link carries
    // its headline in the title attribute and has no text of its own.
    if (isCovered(candidate, key, coveredElements, covered)) continue;

    // The candidate, before climbing: headlineCard walks up to a visible wrapper, so
    // checking only the card lets a screen-reader-only heading through. On a page that has
    // not rendered there is nothing else on it to stop the climb, which is how X's "To view
    // keyboard shortcuts, press question mark" heading became the only chunk of a post.
    if (isElementHidden(candidate)) continue;
    const element = headlineCard(candidate, headline.length);
    if (!element || isElementHidden(element) || inRotatingStrip(element)) continue;
    // Only once we are keeping it: a candidate dropped for being in a ticker must not
    // block the copy of the same headline in the sidebar.
    seen.add(key);

    chunks.push({
      url,
      text: headline,
      html: (element as Element).innerHTML,
      links: link
        ? [{
            url: link.getAttribute('href') || '',
            text: (link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
            label: accessibleLinkName(link).slice(0, 200),
            isExternal: false,
          }]
        : [],
      // A bare heading teaser has no link of its own; its story anchor is on the card
      // around it, which findHeadlineLink climbs to.
      primaryLink: link
        ? { url: link.getAttribute('href') || '', text: headline, label: headline }
        : findHeadlineLink(element as Element, headline, url),
      images: [],
      metadata: {
        headline: true,
        elementType: (element as Element).tagName.toLowerCase(),
        classes: Array.from((element as Element).classList),
      },
      tags: inAside(element) ? [TAG.ARTICLE, TAG.SIDEBAR] : [TAG.ARTICLE],
      xpath: generateXPath(element),
      isPrimary: false,
    });
  }

  return chunks;
}

/** The `title` attribute is the clean headline; link text often carries date and category. */
function headlineText(link: Element, pageUrl: string): string | null {
  if (link.closest?.(FURNITURE)) return null;
  const href = link.getAttribute('href') || '';
  if (!href || NON_STORY_HREF.test(href)) return null;

  // Same site only: an off-site link with headline-length text is a share or follow
  // button ("Follow Sean Adl-Tabatabai on Facebook"), not a story on this page.
  if (!isSameSite(href, pageUrl)) return null;

  const candidates = [link.getAttribute('title'), visibleText(link)]
    .map((text) => (text || '').replace(/\s+/g, ' ').trim())
    .filter((text) => text.length >= MIN_HEADLINE_CHARS && text.length <= MAX_HEADLINE_CHARS);

  // Shortest in-range candidate: the title attribute over the noisier link text.
  const headline = candidates.sort((a, b) => a.length - b.length)[0];
  if (!headline) return null;
  return headline.split(' ').length >= MIN_HEADLINE_WORDS ? headline : null;
}

function isSameSite(href: string, pageUrl: string): boolean {
  if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return true;
  try {
    return new URL(href, pageUrl).host === new URL(pageUrl).host;
  } catch {
    return false;
  }
}

/** A heading is a teaser only outside the story: inside it, it is a section title. */
function headingText(heading: Element): string | null {
  if (heading.closest?.(FURNITURE)) return null;
  const text = visibleText(heading);
  if (text.length < MIN_HEADLINE_CHARS || text.length > MAX_HEADLINE_CHARS) return null;
  return text.split(' ').length >= MIN_HEADLINE_WORDS ? text : null;
}

/** Inside a chunk we already have (an in-article link, the story's own title) it would be
 *  analysed and labelled twice. DOM containment when we could resolve the chunk elements,
 *  text otherwise — a sidebar teaser repeating an in-article heading is its own chunk. */
function isCovered(candidate: Element, key: string, coveredElements: Element[], coveredKeys: string[]): boolean {
  if (coveredElements.some((element) => element !== candidate && element.contains?.(candidate))) {
    return true;
  }
  return !!key && coveredKeys.some((text) => text.includes(key));
}

/** The card wrapping the link (list item, teaser div), not the whole sidebar: stop as soon
 *  as the ancestor holds much more than the headline itself. */
function headlineCard(link: Element, headlineLength: number): Element {
  let card: Element = link;
  for (let depth = 0; depth < 3; depth++) {
    const parent = card.parentElement;
    if (!parent) break;
    const parentLength = (parent.textContent || '').replace(/\s+/g, ' ').trim().length;
    if (parentLength > headlineLength * 3) break;
    card = parent;
  }
  return card;
}

/**
 * Ticker and carousel items cannot carry an honest label: the strip is shorter than the
 * item and clips the badge, and it cycles, so a label left behind would sit over whichever
 * headline is showing. Detected by shape (an ancestor that clips a taller child), not by
 * theme class.
 */
function inRotatingStrip(element: Element): boolean {
  if (typeof getComputedStyle !== 'function') return false;
  const height = (element as HTMLElement).offsetHeight ?? 0;
  if (!height) return false;
  let node: Element | null = element.parentElement;
  for (let depth = 0; depth < 4 && node; depth++) {
    const style = getComputedStyle(node);
    const clips = style.overflow !== 'visible' && style.overflowY !== 'visible';
    if (clips && (node as HTMLElement).clientHeight > 0 && (node as HTMLElement).clientHeight < height) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function inAside(element: Element): boolean {
  return !!element.closest?.('aside, [role="complementary"], .sidebar, .widget');
}

/** Letters and digits only, for "is this headline already inside a chunk" comparisons. */
function compareKey(text: string): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
