/**
 * Custom chunker for DuckDuckGo Search results
 * Based on stopaganda-ddg.js selectors
 */

import { isElementHidden, generateXPath } from './chunking-utils.js';

/**
 * Extract chunks from DuckDuckGo Search results
 */
export function extractChunksDuckDuckGo(source, url, options = {}) {
	const {
		minTextLength = 100,
		maxChunks = 50,
		includeAds = false
	} = options;

	// Convert HTML string to DOM if needed
	const doc = typeof source === 'string' ? parseHTML(source) : source;
	if (!doc) {
		console.warn('[BetterNet] [CHUNKING] [DuckDuckGo] Failed to parse document');
		return [];
	}

	const chunks = [];
	const linkRegex = /(?:https?\:\/\/)?(?:www\.)?([A-Za-z0-9\_\-\.]+)\/?/;

	// Check which tab we're on
	const tab = doc.getElementsByClassName('SnptgjT2zdOhGYfNng6g');
	let isNewsTab = false;
	let isVideosTab = false;

	if (tab.length > 0) {
		const tabText = tab[0].textContent;
		if (tabText.indexOf('News') >= 0) {
			isNewsTab = true;
		} else if (tabText.indexOf('Videos') >= 0) {
			isVideosTab = true;
		}
	}

	if (isNewsTab) {
		// News tab
		const linkClass = '.result--news';
		const news = doc.querySelectorAll(linkClass);

		for (const element of news) {
			const chunk = extractDDGChunk(element, linkRegex, url, { includeAds });
			if (chunk && chunk.text.length >= minTextLength) {
				chunks.push(chunk);
			}
		}
	} else if (isVideosTab) {
		// Videos tab
		const linkClass = '.tile--vid';
		const vids = doc.querySelectorAll(linkClass);

		for (const element of vids) {
			const chunk = extractDDGChunk(element, linkRegex, url, { includeAds });
			if (chunk && chunk.text.length >= minTextLength) {
				chunks.push(chunk);
			}
		}
	} else {
		// Default tab - standard links and cards
		// Use article tags as primary selector (stable semantic HTML)
		// Prefer articles with data-testid="result" but fall back to any article in results area
		let resultArticles = doc.querySelectorAll('article[data-testid="result"]');
		console.log('[BetterNet] [CHUNKING] [DuckDuckGo] Found', resultArticles.length, 'articles with data-testid="result"');

		// If no results with data-testid, try all articles (DuckDuckGo uses article tags for results)
		if (resultArticles.length === 0) {
			// Look for articles within the results container to avoid matching unrelated articles
			const resultsContainer = doc.querySelector('[data-testid="links"], #links, .results, main');
			if (resultsContainer) {
				resultArticles = resultsContainer.querySelectorAll('article');
				console.log('[BetterNet] [CHUNKING] [DuckDuckGo] Found', resultArticles.length, 'articles in results container');
			}
		}
		if (resultArticles.length === 0) {
			// Last resort: all articles on page
			resultArticles = doc.querySelectorAll('article');
			const docSource = doc.documentElement.outerHTML;
			console.log('[BetterNet] [CHUNKING] [DuckDuckGo] Found', resultArticles.length, 'total articles on page', doc, docSource);
		}

		for (const element of resultArticles) {
			// Skip if this article doesn't look like a search result (no title/link)
			const hasTitle = element.querySelector('h2, h3, a[data-testid="result-title-a"]');
			const hasLink = element.querySelector('a[href]');
			if (!hasTitle || !hasLink) {
				continue;
			}

			const chunk = extractDDGChunk(element, linkRegex, url, { includeAds });
			if (chunk && chunk.text) {
				if (chunk.text.length >= minTextLength) {
					chunks.push(chunk);
				} else {
					console.log('[BetterNet] [CHUNKING] [DuckDuckGo] Chunk text too short:', chunk.text.length, 'chars (min:', minTextLength, ')');
				}
			} else {
				console.log('[BetterNet] [CHUNKING] [DuckDuckGo] Failed to extract chunk from element');
			}
		}

		// Also check for cards (fallback for older pages)
		const cardClass = '.module--carousel__item.has-image';
		const cards = doc.querySelectorAll(cardClass);
		console.log('[BetterNet] [CHUNKING] [DuckDuckGo] Found', cards.length, 'cards');
		for (const element of cards) {
			const chunk = extractDDGChunk(element, linkRegex, url, { includeAds });
			if (chunk && chunk.text && chunk.text.length >= minTextLength) {
				chunks.push(chunk);
			}
		}
	}

	console.log('[BetterNet] [CHUNKING] [DuckDuckGo] Extracted', chunks.length, 'chunks before filtering');

	// Filter out ads unless explicitly included
	const filteredChunks = includeAds
		? chunks
		: chunks.filter(chunk => !isLikelyAd(chunk));

	return filteredChunks.slice(0, maxChunks);
}

/**
 * Extract a single chunk from a DuckDuckGo result element
 */
function extractDDGChunk(element, linkRegex, pageUrl, options = {}) {
	const { includeAds } = options;

	if (!element || isElementHidden(element)) {
		return null;
	}

	const clone = element.cloneNode(true);

	// Remove unwanted elements
	const unwanted = clone.querySelectorAll('script, style, noscript, iframe, nav, header, footer');
	unwanted.forEach(el => el.remove());

	// Extract title
	const titleEl = clone.querySelector('h2, h3, a[data-testid="result-title-a"]');
	const title = titleEl ? titleEl.textContent.trim() : '';

	// Extract URL/link
	// Try to find link in original element first (for proper href resolution)
	const linkElOriginal = element.querySelector('a[href], .xS2NxE06pIznLuh2xjH0, [data-link]');
	const linkEl = clone.querySelector('a[href], .xS2NxE06pIznLuh2xjH0, [data-link]');
	let linkUrl = '';
	let linkText = '';
	if (linkEl) {
		// Use original element's href if available (properly resolved), otherwise use attribute
		if (linkElOriginal && linkElOriginal.href) {
			linkUrl = linkElOriginal.href;
		} else {
			linkUrl = linkEl.getAttribute('href') || linkEl.getAttribute('data-link') || linkEl.textContent || '';
			// Make relative URLs absolute if we have a base URL
			if (linkUrl && !linkUrl.startsWith('http') && typeof window !== 'undefined' && window.location) {
				try {
					linkUrl = new URL(linkUrl, window.location.origin).href;
				} catch (e) {
					// Invalid URL, keep as is
				}
			}
		}
		linkText = linkEl.textContent.trim();
	}

	// Extract snippet/description
	const snippetEl = clone.querySelector('[data-result="snippet"], .E2eLOJr8HctVnDOTM8fs, .OgdwYG6KE2qthn9XQWFC');
	const snippet = snippetEl ? snippetEl.textContent.trim() : '';

	// Extract site name
	const siteEl = clone.querySelector('.OQ_6vPwNhCeusNiEDcGp, .pAgARfGNTRe_uaK72TAD');
	const siteName = siteEl ? siteEl.textContent.trim() : '';

	// Combine text
	const textParts = [siteName, linkText, title, snippet].filter(Boolean);
	const text = textParts.join('\n').trim();

	if (!text || text.length < 50) {
		return null;
	}

	// Extract all links
	const links = Array.from(clone.querySelectorAll('a[href]'))
		.map(a => {
			const href = a.getAttribute('href') || a.href || '';
			const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
			return {
				url: href,
				text: a.textContent.trim().substring(0, 100),
				isExternal: href.startsWith('http') && origin && !href.startsWith(origin)
			};
		})
		.filter(link => link.url)
		.slice(0, 10);

	// Extract images
	const images = Array.from(clone.querySelectorAll('img'))
		.filter(img => img.src && !img.src.startsWith('data:'))
		.map(img => ({
			src: img.src,
			alt: img.alt || '',
			title: img.title || ''
		}))
		.slice(0, 5);

	return {
		url: pageUrl,
		text,
		html: clone.innerHTML,
		links,
		images,
		metadata: {
			platform: 'duckduckgo',
			elementType: element.tagName.toLowerCase(),
			classes: Array.from(element.classList)
		},
		xpath: generateXPath(element),
		isPrimary: false
	};
}


/**
 * Check if chunk is likely an ad
 */
function isLikelyAd(chunk) {
	const text = (chunk.text || '').toLowerCase();
	const adKeywords = ['advertisement', 'sponsored', 'promoted', 'ad'];
	return adKeywords.some(keyword => text.includes(keyword));
}

/**
 * Parse HTML string to DOM
 */
function parseHTML(html) {
	if (typeof DOMParser !== 'undefined') {
		const parser = new DOMParser();
		return parser.parseFromString(html, 'text/html');
	}
	return null;
}

