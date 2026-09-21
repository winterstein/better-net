/**
 * Options -> Account: the View / Delete my feedback controls
 * (src/options/account-feedback.ts). See specs/accounts/delete-my-data.md.
 *
 * What matters is that deletion cannot happen without the confirmation step, that the
 * confirmation states a number, and that failures say so instead of claiming success.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { setupAccountFeedback } from '../src/options/account-feedback.js';

const HTML = `<!DOCTYPE html><html><body>
  <button type="button" id="feedback-view">View my feedback</button>
  <p id="feedback-view-status"></p>
  <button type="button" id="feedback-delete">Delete my feedback</button>
  <div id="feedback-delete-confirm" class="hidden">
    <p id="feedback-delete-prompt"><strong></strong></p>
    <button type="button" id="feedback-delete-cancel">Cancel</button>
    <button type="button" id="feedback-delete-yes">Yes, delete</button>
  </div>
  <p id="feedback-delete-status"></p>
</body></html>`;

interface Harness {
	doc: Document;
	sent: { type: string }[];
	opened: string[];
	click: (id: string) => Promise<void>;
	text: (id: string) => string;
	confirmVisible: () => boolean;
	prompt: () => string;
}

function harness(replies: Record<string, any>): Harness {
	const dom = new JSDOM(HTML);
	const doc = dom.window.document as unknown as Document;
	const sent: { type: string }[] = [];
	const opened: string[] = [];
	setupAccountFeedback({
		doc,
		sendMessage: async (message) => {
			sent.push(message);
			const reply = replies[message.type];
			if (reply instanceof Error) throw reply;
			return reply;
		},
		openUrl: (url) => opened.push(url),
	});
	return {
		doc,
		sent,
		opened,
		async click(id) {
			(doc.getElementById(id) as HTMLButtonElement).click();
			// Handlers are async; let their microtasks settle before asserting.
			await new Promise((r) => setTimeout(r, 0));
		},
		text: (id) => doc.getElementById(id)?.textContent?.trim() ?? '',
		confirmVisible: () => !doc.getElementById('feedback-delete-confirm')!.classList.contains('hidden'),
		prompt: () => doc.getElementById('feedback-delete-prompt')?.textContent?.trim() ?? '',
	};
}

// --- view ------------------------------------------------------------------------------
{
	const h = harness({ BN_FEEDBACK_LINK: { ok: true, url: 'https://app.better-net.com/feedback#link=ABCD-2345' } });
	await h.click('feedback-view');
	assert.deepEqual(
		h.sent.map((m) => m.type),
		['BN_FEEDBACK_LINK'],
		'asks the background for a link code'
	);
	assert.deepEqual(h.opened, ['https://app.better-net.com/feedback#link=ABCD-2345'], 'opens the webapp');
}

{
	const h = harness({ BN_FEEDBACK_LINK: { ok: false, error: 'Could not reach the server' } });
	await h.click('feedback-view');
	assert.deepEqual(h.opened, [], 'nothing is opened on failure');
	assert.match(h.text('feedback-view-status'), /Could not reach the server/, 'and it says why');
}

{
	const h = harness({ BN_FEEDBACK_LINK: new Error('Background unreachable') });
	await h.click('feedback-view');
	assert.deepEqual(h.opened, []);
	assert.match(h.text('feedback-view-status'), /Background unreachable/, 'a thrown error is reported');
}

// --- delete needs the confirmation ------------------------------------------------------
{
	const h = harness({ BN_FEEDBACK_COUNT: { ok: true, count: 12 }, BN_FEEDBACK_DELETE: { ok: true, deleted: 12 } });

	// First press only counts. This is the important assertion: pressing Delete deletes nothing.
	await h.click('feedback-delete');
	assert.deepEqual(h.sent.map((m) => m.type), ['BN_FEEDBACK_COUNT'], 'no delete yet');
	assert.ok(h.confirmVisible(), 'the confirmation is shown');
	assert.match(h.prompt(), /12 items/, 'and states how much will go');
	assert.match(h.prompt(), /this browser/i, 'scoped to this browser, not "all my data"');
	assert.match(h.prompt(), /cannot be undone/i);
	assert.equal(
		h.doc.activeElement?.id,
		'feedback-delete-cancel',
		'Cancel holds focus, so a stray Enter does not delete'
	);

	await h.click('feedback-delete-yes');
	assert.deepEqual(
		h.sent.map((m) => m.type),
		['BN_FEEDBACK_COUNT', 'BN_FEEDBACK_DELETE'],
		'confirming is what deletes'
	);
	assert.match(h.text('feedback-delete-status'), /Deleted 12 items/);
	assert.ok(!h.confirmVisible(), 'the confirmation closes afterwards');
}

// Cancel deletes nothing.
{
	const h = harness({ BN_FEEDBACK_COUNT: { ok: true, count: 3 }, BN_FEEDBACK_DELETE: { ok: true, deleted: 3 } });
	await h.click('feedback-delete');
	await h.click('feedback-delete-cancel');
	assert.deepEqual(h.sent.map((m) => m.type), ['BN_FEEDBACK_COUNT'], 'cancelling sends no delete');
	assert.ok(!h.confirmVisible());
	assert.match(h.text('feedback-delete-status'), /Nothing was deleted/);
}

// Nothing to delete: say so rather than opening a confirmation for zero items.
{
	const h = harness({ BN_FEEDBACK_COUNT: { ok: true, count: 0 } });
	await h.click('feedback-delete');
	assert.ok(!h.confirmVisible(), 'no confirmation for an empty set');
	assert.match(h.text('feedback-delete-status'), /no feedback from this browser/i);
}

// One item reads as "1 item", not "1 items".
{
	const h = harness({ BN_FEEDBACK_COUNT: { ok: true, count: 1 }, BN_FEEDBACK_DELETE: { ok: true, deleted: 1 } });
	await h.click('feedback-delete');
	assert.match(h.prompt(), /\(1 item\)/);
	await h.click('feedback-delete-yes');
	assert.match(h.text('feedback-delete-status'), /Deleted 1 item\./);
}

// A failed count must not open a confirmation that would delete on a guess.
{
	const h = harness({ BN_FEEDBACK_COUNT: { ok: false, error: 'Could not reach the server' } });
	await h.click('feedback-delete');
	assert.ok(!h.confirmVisible());
	assert.match(h.text('feedback-delete-status'), /Could not reach the server/);
	assert.equal((h.doc.getElementById('feedback-delete') as HTMLButtonElement).disabled, false, 'and can be retried');
}

// A failed delete must not claim success.
{
	const h = harness({
		BN_FEEDBACK_COUNT: { ok: true, count: 5 },
		BN_FEEDBACK_DELETE: { ok: false, error: 'Could not reach the server' },
	});
	await h.click('feedback-delete');
	await h.click('feedback-delete-yes');
	assert.match(h.text('feedback-delete-status'), /Could not reach the server/);
	assert.doesNotMatch(h.text('feedback-delete-status'), /Deleted/);
}

console.log('✅ account feedback options tests passed');
