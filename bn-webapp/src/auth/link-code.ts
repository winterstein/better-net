/**
 * The one-time link code the extension hands over in the URL fragment.
 * See bn-extension/specs/accounts/user-identity/spec.md.
 *
 * A fragment, not a query string: fragments are never sent to the server, so the code stays
 * out of nginx access logs and Referer headers. It is removed from the URL once read, so it
 * is not left behind in browser history.
 */

const FRAGMENT_KEY = 'link';

/** @returns the code, or null if this visit did not come from the extension. */
export function readLinkCode(hash: string): string | null {
	const raw = hash.startsWith('#') ? hash.slice(1) : hash;
	if (!raw) return null;
	const code = new URLSearchParams(raw).get(FRAGMENT_KEY);
	return code ? code.trim().toUpperCase() : null;
}

/**
 * Take the code out of the address bar, keeping any other fragment keys. Uses replaceState
 * so the code does not survive in history or a page reload.
 */
export function stripLinkCode(win: {
	location: { hash: string; pathname: string; search: string };
	history: { replaceState: (data: unknown, unused: string, url: string) => void };
}): void {
	const raw = win.location.hash.startsWith('#') ? win.location.hash.slice(1) : win.location.hash;
	if (!raw) return;
	const params = new URLSearchParams(raw);
	if (!params.has(FRAGMENT_KEY)) return;
	params.delete(FRAGMENT_KEY);
	const rest = params.toString();
	const url = `${win.location.pathname}${win.location.search}${rest ? `#${rest}` : ''}`;
	win.history.replaceState(null, '', url);
}
