/**
 * Pages the user has marked private in the Content Analysis modal.
 *
 * Kept in chrome.storage.local only: saying "this page is private" must not itself be
 * something we send anywhere. Keyed on origin + path, so the mark survives a reload and a
 * changed query string. The effects are in sharing/share-rules.ts isPrivatePage.
 */

const PRIVATE_PAGES_KEY = 'bnPrivatePages';

/** Oldest marks are dropped past this. A list, not a history: nobody marks thousands. */
const MAX_PRIVATE_PAGES = 500;

/** Origin + path, or '' for something that is not a url. */
export function privatePageKey(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return '';
	}
}

async function readMarks(): Promise<string[]> {
	const { [PRIVATE_PAGES_KEY]: marks = [] } = await chrome.storage.local.get(PRIVATE_PAGES_KEY);
	return Array.isArray(marks) ? marks : [];
}

export async function isMarkedPrivate(url: string): Promise<boolean> {
	const key = privatePageKey(url);
	if (!key) return false;
	try {
		return (await readMarks()).includes(key);
	} catch {
		return false;
	}
}

export async function markPrivate(url: string): Promise<void> {
	const key = privatePageKey(url);
	if (!key) return;
	const marks = (await readMarks()).filter((m) => m !== key);
	marks.push(key);
	await chrome.storage.local.set({ [PRIVATE_PAGES_KEY]: marks.slice(-MAX_PRIVATE_PAGES) });
}
