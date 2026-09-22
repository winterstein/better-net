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

/**
 * Where the code waits while the user is away at Auth0.
 *
 * Signing in is a full-page redirect to Auth0 and back, and the fragment does not survive
 * the round trip — so a first visit from the extension would arrive with a code, lose it at
 * the sign-in step, and then show "no browsers linked" to someone who had just linked one.
 * Stashing it first is what makes the very flow the code exists for actually work.
 *
 * sessionStorage, not localStorage: the code is single-use and short-lived, so it should die
 * with the tab rather than linger for the next visit.
 */
const STASH_KEY = 'bn.linkCode';

/**
 * Take the code out of the URL and hold it until someone asks for it. Safe to call on every
 * render — it is a no-op once the fragment has been stripped.
 */
export function stashLinkCode(win: Parameters<typeof stripLinkCode>[0], store?: Storage): void {
	const code = readLinkCode(win.location.hash);
	if (!code) return;
	try {
		store?.setItem(STASH_KEY, code);
	} catch {
		// Private mode, or storage full. The code is still in the fragment for this render,
		// so a user who is already signed in is unaffected; only the redirect case is lost.
	}
	stripLinkCode(win);
}

/** @returns the stashed code, removing it — single-use, so a failed redeem is not retried. */
export function takeLinkCode(store?: Storage): string | null {
	try {
		const code = store?.getItem(STASH_KEY) ?? null;
		if (code) store?.removeItem(STASH_KEY);
		return code;
	} catch {
		return null;
	}
}
