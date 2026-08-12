/**
 * Apply click-unbait rewrite to a chunk element on the page.
 */

import { findAnalysisByModule } from '../types/AspectAnalysis.js';
import type { AspectAnalysis } from '../types/AspectAnalysis.js';
import type { ChunkAnalysis } from '../types/ChunkAnalysis.js';

export function applyClickUnbaitFromAnalysis(
	chunkEl: Element,
	combinedResults: ChunkAnalysis
): boolean {
	const analysis = findAnalysisByModule(
		combinedResults.analyses ?? [],
		'clickUnbait'
	);
	return applyClickUnbaitRewrite(chunkEl, analysis);
}

export function applyClickUnbaitRewrite(
	chunkEl: Element,
	analysis: AspectAnalysis | undefined
): boolean {
	const meta = analysis?.metadata;
	if (!meta?.displayTitle || !meta?.originalTitle) return false;
	if (chunkEl.getAttribute('data-betternet-unbaited') === '1') return false;

	const displayTitle = String(meta.displayTitle);
	const originalTitle = String(meta.originalTitle);
	const hoverTitle = String(meta.hoverTitle || originalTitle);

	const target = findTitleTarget(chunkEl, originalTitle);
	if (!target) return false;

	target.textContent = displayTitle;
	target.setAttribute('title', hoverTitle);
	chunkEl.setAttribute('data-betternet-unbaited', '1');
	return true;
}

function findTitleTarget(root: Element, originalTitle: string): Element | null {
	const normalized = originalTitle.replace(/\s+/g, ' ').trim().toLowerCase();
	const links = Array.from(root.querySelectorAll('a[href]'));

	for (const a of links) {
		const t = (a.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
		if (!t) continue;
		if (
			t === normalized ||
			normalized.includes(t) ||
			t.includes(normalized.slice(0, Math.min(40, normalized.length)))
		) {
			return a;
		}
	}

	for (const h of root.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
		const t = (h.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
		if (
			t &&
			(t === normalized ||
				t.includes(normalized.slice(0, Math.min(40, normalized.length))))
		) {
			return h;
		}
	}

	return links.find((a) => (a.textContent || '').trim().length > 10) || null;
}
