/**
 * Format click-unbait display text: `[honest summary] original title`
 *
 * The whole original headline is kept. An ellipsis where the headline used to be is its own
 * small curiosity gap — the reader cannot tell whether the cut-off part mattered, which is
 * the problem we are supposed to be solving — so truncation is a guard against runaway
 * headlines, not a layout budget. The cap applies to the original alone, which also means a
 * longer honest summary never eats into the headline.
 */

export const ELLIPSIS = '…';

/** Cap on the original headline. Real headlines run to about 110 characters; past this we
 *  are looking at a standfirst, or a whole paragraph used as link text. Full original stays
 *  on hover either way. */
export const DEFAULT_MAX_TITLE_LEN = 140;

export interface UnbaitTitleFormat {
	displayText: string;
	/** Full original title for hover (`title` attribute) */
	hoverTitle: string;
	rewritten: boolean;
}

export function formatUnbaitTitle(
	honestSummary: string,
	originalTitle: string,
	maxTitleLen = DEFAULT_MAX_TITLE_LEN
): UnbaitTitleFormat {
	const summary = String(honestSummary || '')
		.trim()
		.replace(/^\[+|\]+$/g, '')
		.trim();
	const original = String(originalTitle || '').replace(/\s+/g, ' ').trim();

	if (!summary || !original) {
		return { displayText: original, hoverTitle: original, rewritten: false };
	}

	return {
		displayText: `[${summary}] ${truncateAtWord(original, maxTitleLen)}`,
		hoverTitle: original,
		rewritten: true,
	};
}

/** Cut back to the last word break, so a truncated headline never ends in half a word. */
function truncateAtWord(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	const cut = text.slice(0, maxLen);
	const lastSpace = cut.lastIndexOf(' ');
	// No word break within reach (a URL, a run-on): cut flat rather than lose the lot.
	const kept = lastSpace > maxLen / 2 ? cut.slice(0, lastSpace) : cut;
	return kept.replace(/[\s,;:.–—-]+$/, '') + ELLIPSIS;
}
