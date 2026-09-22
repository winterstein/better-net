/**
 * The Link / linked-status control, shared by the popup and the options page
 * (specs/accounts/user-identity/spec.md). One module because the behaviour is identical and
 * only the markup differs; the element ids are passed in.
 *
 * All server work happens in the background worker (background/feedback-manager.ts); this
 * only drives the DOM.
 */

import { accountLinkState, accountLinkView } from './account-link-view.js';

export interface AccountLinkDeps {
	/** Send a message to the background worker and await its reply. */
	sendMessage: (message: { type: string }) => Promise<any>;
	/** Open the webapp. Separate so tests do not need a real browser. */
	openUrl: (url: string) => void;
	/** Element ids, since the popup and the options page have their own markup. */
	ids: { button: string; status: string };
	doc?: Document;
}

/**
 * Render the current state and wire the button.
 *
 * @returns once the first status render has happened, so tests need no timers.
 */
export async function setupAccountLink(deps: AccountLinkDeps): Promise<void> {
	const doc = deps.doc ?? document;
	const button = doc.getElementById(deps.ids.button) as HTMLButtonElement | null;
	const statusEl = doc.getElementById(deps.ids.status);
	if (!button && !statusEl) return;

	const setStatus = (text: string) => {
		if (statusEl) statusEl.textContent = text;
	};

	const render = async () => {
		let reply: any = null;
		try {
			reply = await deps.sendMessage({ type: 'BN_ACCOUNT_STATUS' });
		} catch {
			// Treated as unavailable below, which shows the button and says nothing.
		}
		const view = accountLinkView(accountLinkState(reply));
		setStatus(view.status);
		if (button) {
			button.textContent = view.linkLabel;
			button.classList.toggle('hidden', !view.showLink);
		}
	};

	button?.addEventListener('click', async () => {
		button.disabled = true;
		setStatus('Opening…');
		try {
			const res = await deps.sendMessage({ type: 'BN_FEEDBACK_LINK' });
			if (res?.ok && res.url) {
				deps.openUrl(res.url);
				// The linking itself finishes in the tab that just opened, so this window
				// cannot report success — say what happens next instead of guessing.
				setStatus('Finish signing in on the page that just opened.');
			} else {
				setStatus(res?.error || 'Could not start linking.');
			}
		} catch (err: any) {
			setStatus(err?.message || 'Could not start linking.');
		} finally {
			button.disabled = false;
		}
	});

	await render();
}
