/**
 * The optional account link shown in the popup and the options page
 * (src/accounts/account-link-view.ts, account-link-ui.ts).
 * See specs/accounts/user-identity/spec.md.
 *
 * What matters is the product position: an unlinked browser is never nagged, a server that
 * cannot be reached is never reported as "not linked", and a linked browser says which
 * account holds it — on a shared computer that is the difference that matters.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { accountLinkState, accountLinkView } from '../src/accounts/account-link-view.js';
import { setupAccountLink } from '../src/accounts/account-link-ui.js';

const HTML = `<!DOCTYPE html><html><body>
  <button type="button" id="account-link">Link this browser to an account</button>
  <p id="account-link-status"></p>
</body></html>`;

interface Harness {
	doc: Document;
	sent: { type: string }[];
	opened: string[];
	click: () => Promise<void>;
	status: () => string;
	label: () => string;
}

async function harness(replies: Record<string, any>): Promise<Harness> {
	const dom = new JSDOM(HTML);
	const doc = dom.window.document as unknown as Document;
	const sent: { type: string }[] = [];
	const opened: string[] = [];
	await setupAccountLink({
		doc,
		sendMessage: async (message) => {
			sent.push(message);
			const reply = replies[message.type];
			if (reply instanceof Error) throw reply;
			return reply;
		},
		openUrl: (url) => opened.push(url),
		ids: { button: 'account-link', status: 'account-link-status' },
	});
	return {
		doc,
		sent,
		opened,
		async click() {
			(doc.getElementById('account-link') as HTMLButtonElement).click();
			// Handlers are async; let their microtasks settle before asserting.
			await new Promise((r) => setTimeout(r, 0));
		},
		status: () => doc.getElementById('account-link-status')?.textContent?.trim() ?? '',
		label: () => doc.getElementById('account-link')?.textContent?.trim() ?? '',
	};
}

function run(name: string, fn: () => void | Promise<void>) {
	return Promise.resolve()
		.then(fn)
		.then(
			() => console.log(`  ok - ${name}`),
			(err) => {
				console.error(`  FAIL - ${name}`);
				throw err;
			}
		);
}

async function main() {
	console.log('account-link');

	// --- the pure view ---

	await run('a reply that did not reach the server is "unavailable", not "unlinked"', () => {
		assert.deepEqual(accountLinkState(null), { kind: 'unavailable' });
		assert.deepEqual(accountLinkState({ ok: false }), { kind: 'unavailable' });
		// The distinction the spec cares about: never guess at "not linked".
		assert.notEqual(accountLinkState({ ok: false }).kind, 'unlinked');
	});

	await run('ok replies map to linked / unlinked', () => {
		assert.deepEqual(accountLinkState({ ok: true, linked: false }), { kind: 'unlinked' });
		assert.deepEqual(accountLinkState({ ok: true, linked: true, email: 'a@b.com' }), {
			kind: 'linked',
			email: 'a@b.com',
		});
	});

	await run('unlinked is offered a link, and told nothing is wrong', () => {
		const view = accountLinkView({ kind: 'unlinked' });
		assert.ok(view.showLink);
		// No nagging: the copy has to say the account is optional.
		assert.match(view.status, /does not need to be/i);
	});

	await run('linked names the account, so a shared computer is obvious', () => {
		const view = accountLinkView({ kind: 'linked', email: 'sam@example.com' });
		assert.match(view.status, /sam@example\.com/);
		// Re-linking is how a device moves account, so the control stays available.
		assert.ok(view.showLink);
		assert.match(view.linkLabel, /different account/i);
	});

	await run('linked with no email on file still reads as linked', () => {
		const view = accountLinkView({ kind: 'linked' });
		assert.match(view.status, /linked/i);
		assert.doesNotMatch(view.status, /undefined/);
	});

	await run('unavailable says nothing rather than guessing', () => {
		const view = accountLinkView({ kind: 'unavailable' });
		assert.equal(view.status, '');
		assert.ok(view.showLink);
	});

	// --- the wiring ---

	await run('renders the linked account on setup', async () => {
		const h = await harness({ BN_ACCOUNT_STATUS: { ok: true, linked: true, email: 'sam@example.com' } });
		assert.match(h.status(), /sam@example\.com/);
		assert.match(h.label(), /different account/i);
	});

	await run('an unreachable server leaves the button usable and the status blank', async () => {
		const h = await harness({ BN_ACCOUNT_STATUS: new Error('offline') });
		assert.equal(h.status(), '');
		assert.equal((h.doc.getElementById('account-link') as HTMLButtonElement).disabled, false);
	});

	await run('clicking opens the webapp link url', async () => {
		const h = await harness({
			BN_ACCOUNT_STATUS: { ok: true, linked: false },
			BN_FEEDBACK_LINK: { ok: true, url: 'https://app.better-net.com/feedback#link=K7QP-2F' },
		});
		await h.click();
		assert.deepEqual(h.opened, ['https://app.better-net.com/feedback#link=K7QP-2F']);
		// The linking finishes in the other tab, so this window must not claim success.
		assert.match(h.status(), /finish signing in/i);
	});

	await run('a failed link request says so instead of opening nothing', async () => {
		const h = await harness({
			BN_ACCOUNT_STATUS: { ok: true, linked: false },
			BN_FEEDBACK_LINK: { ok: false, error: 'No server endpoint is configured' },
		});
		await h.click();
		assert.deepEqual(h.opened, []);
		assert.match(h.status(), /No server endpoint is configured/);
	});

	await run('a thrown link request is reported, and the button is re-enabled', async () => {
		const h = await harness({
			BN_ACCOUNT_STATUS: { ok: true, linked: false },
			BN_FEEDBACK_LINK: new Error('offline'),
		});
		await h.click();
		assert.match(h.status(), /offline/);
		assert.equal((h.doc.getElementById('account-link') as HTMLButtonElement).disabled, false);
	});

	console.log('account-link: all passed');
}

void main().catch((err) => {
	console.error(err);
	process.exit(1);
});
