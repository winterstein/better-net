/**
 * Heuristic chunk title from HTML headings or plain text.
 */

const HEADING_TAGS = ['h1', 'h2', 'h3'] as const;

/** Strip tags and collapse whitespace (for regex HTML fallback). */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * First h1, else first h2, else first h3 (document order within each level).
 */
export function titleFromHtml(html: string): string | undefined {
  if (!html?.trim()) return undefined;

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const tag of HEADING_TAGS) {
        const el = doc.querySelector(tag);
        const text = el?.textContent?.replace(/\s+/g, ' ').trim();
        if (text) return text;
      }
    } catch {
      // fall through to regex
    }
  }

  for (const tag of HEADING_TAGS) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = html.match(re);
    if (match) {
      const text = stripTags(match[1]);
      if (text) return text;
    }
  }

  return undefined;
}

/**
 * First sentence ending in . ! or ?; otherwise first line (trimmed).
 */
export function titleFromText(text: string): string | undefined {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  const sentence = normalized.match(/^(.+?[.!?])(?:\s+|$)/);
  if (sentence?.[1]) return sentence[1].trim();

  const line = normalized.split('\n').map((s) => s.trim()).find(Boolean);
  return line || normalized;
}

/**
 * Infer title: existing title, headings in html, metadata.heading, then first sentence.
 */
export function inferChunkTitle(chunk: {
  title?: string;
  html?: string;
  text?: string;
  metadata?: { heading?: string };
}): string | undefined {
  const existing = chunk.title?.replace(/\s+/g, ' ').trim();
  if (existing) return existing;

  const fromHtml = chunk.html ? titleFromHtml(chunk.html) : undefined;
  if (fromHtml) return fromHtml;

  const fromMeta = chunk.metadata?.heading?.replace(/\s+/g, ' ').trim();
  if (fromMeta) return fromMeta;

  return chunk.text ? titleFromText(chunk.text) : undefined;
}

/** Set chunk.title when missing. */
export function ensureChunkTitle(chunk: {
  title?: string;
  html?: string;
  text?: string;
  metadata?: { heading?: string };
}): string | undefined {
  const title = inferChunkTitle(chunk);
  if (title) chunk.title = title;
  return title;
}
