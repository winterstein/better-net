/**
 * Format click-unbait display text: `[honest summary] original title`
 * Truncate the original when over budget; full original stays on hover.
 */

export const ELLIPSIS = '…';
/** Soft cap for on-page link text (summary kept; original truncated). */
export const DEFAULT_MAX_DISPLAY_LEN = 90;

export interface UnbaitTitleFormat {
	displayText: string;
	/** Full original title for hover (`title` attribute) */
	hoverTitle: string;
	rewritten: boolean;
}

export function formatUnbaitTitle(
	honestSummary: string,
	originalTitle: string,
	maxLen = DEFAULT_MAX_DISPLAY_LEN
): UnbaitTitleFormat {
	const summary = String(honestSummary || '')
		.trim()
		.replace(/^\[+|\]+$/g, '')
		.trim();
	const original = String(originalTitle || '').replace(/\s+/g, ' ').trim();

	if (!summary || !original) {
		return { displayText: original, hoverTitle: original, rewritten: false };
	}

	const prefix = `[${summary}] `;
	const full = prefix + original;
	if (full.length <= maxLen) {
		return { displayText: full, hoverTitle: original, rewritten: true };
	}

	const room = Math.max(0, maxLen - prefix.length - ELLIPSIS.length);
	const truncated =
		room > 0 ? original.slice(0, room).trimEnd() + ELLIPSIS : ELLIPSIS;
	return {
		displayText: prefix + truncated,
		hoverTitle: original,
		rewritten: true,
	};
}
