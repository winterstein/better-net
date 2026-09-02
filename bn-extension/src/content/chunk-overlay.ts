/**
 * Debug overlay: draws a transparent, labelled box over every chunk the page produced.
 *
 * Chunk boundaries are otherwise invisible — you can only infer them from console text —
 * and most chunking bugs are spatial: the wrong element, a box round a whole page region,
 * two chunks over the same headline, a teaser that was never chunked at all. Seeing them
 * on the page makes those obvious at a glance.
 *
 * Off unless Settings -> Advanced -> "Show chunk overlay" is on.
 */

import { findElementByXPath } from '../utils/utils.js';
import { logit } from '../utils/logger.js';

const OVERLAY_ROOT_ID = 'betternet-chunk-overlay-root';
const OVERLAY_CLASS = 'betternet-chunk-overlay';
const STYLE_ID = 'betternet-chunk-overlay-styles';

/** Below the nutrient labels (999998), above the page. */
const OVERLAY_Z_INDEX = 999900;

let redrawHandler: (() => void) | null = null;
let lastChunks: any[] = [];

/**
 * Colour from the chunk id rather than Math.random: the same chunk keeps its colour when
 * the overlay is redrawn on resize or re-analysis, so you can follow one box while the page
 * changes. Fixed saturation and lightness keep every box readable over any background.
 */
function colourFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 85% 45%)`;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ROOT_ID} {
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: ${OVERLAY_Z_INDEX};
      pointer-events: none;
    }
    .${OVERLAY_CLASS} {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid currentColor;
      border-radius: 3px;
      pointer-events: none;
    }
    .${OVERLAY_CLASS}-fill {
      position: absolute;
      inset: 0;
      background: currentColor;
      opacity: 0.12;
    }
    .${OVERLAY_CLASS}-label {
      position: absolute;
      top: 0;
      left: 0;
      max-width: 100%;
      padding: 1px 4px;
      /* Background is set per box in JS: a currentColor background cannot work here,
         because the rule below sets this element's own colour to white, which would make
         currentColor white on white. */
      color: #fff;
      font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function overlayRoot(): HTMLElement {
  let root = document.getElementById(OVERLAY_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = OVERLAY_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

/** Page coordinates, so the boxes stay put while scrolling without a scroll listener. */
function documentRect(element: Element) {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    width: rect.width,
    height: rect.height,
  };
}

export function clearChunkOverlays() {
  document.getElementById(OVERLAY_ROOT_ID)?.remove();
  if (redrawHandler) {
    window.removeEventListener('resize', redrawHandler);
    redrawHandler = null;
  }
  lastChunks = [];
}

/**
 * @param chunks the chunks as sent for analysis, in order — the index shown is the index
 *        the console logs and the popup use.
 */
export function renderChunkOverlays(chunks: any[] = []) {
  clearChunkOverlays();
  if (!chunks.length || !document.body) return;
  lastChunks = chunks;

  injectStyles();
  const root = overlayRoot();
  let drawn = 0;
  let unresolved = 0;

  chunks.forEach((chunk, index) => {
    const found = chunk?.xpath ? findElementByXPath(chunk.xpath) : null;
    const element = found && (found as Node).nodeType === 1 ? (found as Element) : null;
    if (!element) {
      unresolved++;
      return;
    }
    const rect = documentRect(element);
    // A collapsed box would be an invisible marker and a confusing one.
    if (rect.width < 1 || rect.height < 1) {
      unresolved++;
      return;
    }

    const id = String(chunk.id ?? chunk.fingerprint ?? `chunk-${index}`);
    const colour = colourFor(id);
    const box = document.createElement('div');
    box.className = OVERLAY_CLASS;
    box.style.color = colour;
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const fill = document.createElement('div');
    fill.className = `${OVERLAY_CLASS}-fill`;

    const label = document.createElement('div');
    label.className = `${OVERLAY_CLASS}-label`;
    label.style.background = colour;
    label.textContent = `#${index} ${id}`;
    // The tags and xpath are what you actually need next when a box looks wrong.
    label.title = `${id}\ntags: ${(chunk.tags || []).join(', ') || 'none'}\n${chunk.xpath || ''}`;

    box.append(fill, label);
    root.appendChild(box);
    drawn++;
  });

  logit('log', '[BetterNet] [CONTENT] Chunk overlay:', drawn, 'drawn,', unresolved, 'without a visible element');

  // Reflow moves everything; the boxes are absolute and would otherwise drift.
  redrawHandler = debounce(() => renderChunkOverlays(lastChunks), 200);
  window.addEventListener('resize', redrawHandler);
}

function debounce(fn: () => void, ms: number) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
