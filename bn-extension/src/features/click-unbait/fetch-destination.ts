/**
 * Fetch destination page text for click-unbait (quiet fail).
 * Regex extract — safe in MV3 service worker (no DOMParser).
 */

export interface DestinationContent {
	title: string;
	text: string;
	url: string;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_BODY_CHARS = 4_000;

export async function fetchDestinationText(
	url: string,
	opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<DestinationContent | null> {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const res = await fetchImpl(url, {
			signal: controller.signal,
			redirect: 'follow',
			credentials: 'omit',
		});
		clearTimeout(timer);
		if (!res.ok) return null;

		const ct = (res.headers.get('content-type') || '').toLowerCase();
		if (ct && !ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('xhtml')) {
			return null;
		}

		const html = await res.text();
		const extracted = extractTextFromHtml(html);
		if (!extracted.title && !extracted.text) return null;
		return { ...extracted, url };
	} catch {
		return null;
	}
}

export function extractTextFromHtml(html: string): { title: string; text: string } {
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	const title = decodeEntities(
		stripTags(titleMatch?.[1] || h1Match?.[1] || '')
	)
		.replace(/\s+/g, ' ')
		.trim();

	const body = decodeEntities(
		stripTags(
			html
				.replace(/<script[\s\S]*?<\/script>/gi, ' ')
				.replace(/<style[\s\S]*?<\/style>/gi, ' ')
				.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
		)
	)
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_BODY_CHARS);

	return { title, text: body };
}

function stripTags(s: string): string {
	return s.replace(/<[^>]+>/g, ' ');
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ');
}
