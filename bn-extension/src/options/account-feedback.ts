/**
 * Options -> Account: view and delete the feedback this browser has sent.
 * See specs/accounts/user-identity.md and specs/accounts/delete-my-data.md.
 *
 * Its own module rather than more of options.ts, so the confirmation flow can be tested
 * without the rest of the settings page. All server work happens in the background worker
 * (background/feedback-manager.ts); this only drives the DOM.
 */

export interface AccountFeedbackDeps {
	/** Send a message to the background worker and await its reply. */
	sendMessage: (message: { type: string }) => Promise<any>;
	/** Open the webapp. Separate so tests do not need a real browser. */
	openUrl: (url: string) => void;
	doc?: Document;
}

const VIEW_BUTTON = 'feedback-view';
const VIEW_STATUS = 'feedback-view-status';
const DELETE_BUTTON = 'feedback-delete';
const DELETE_CONFIRM = 'feedback-delete-confirm';
const DELETE_PROMPT = 'feedback-delete-prompt';
const DELETE_YES = 'feedback-delete-yes';
const DELETE_CANCEL = 'feedback-delete-cancel';
const DELETE_STATUS = 'feedback-delete-status';

export function setupAccountFeedback(deps: AccountFeedbackDeps): void {
	const doc = deps.doc ?? document;
	const el = (id: string) => doc.getElementById(id);

	const viewButton = el(VIEW_BUTTON) as HTMLButtonElement | null;
	const deleteButton = el(DELETE_BUTTON) as HTMLButtonElement | null;
	const confirmBox = el(DELETE_CONFIRM);
	const prompt = el(DELETE_PROMPT)?.querySelector('strong') ?? null;
	const yesButton = el(DELETE_YES) as HTMLButtonElement | null;
	const cancelButton = el(DELETE_CANCEL) as HTMLButtonElement | null;

	const setStatus = (id: string, text: string) => {
		const node = el(id);
		if (node) node.textContent = text;
	};

	const hideConfirm = () => {
		confirmBox?.classList.add('hidden');
		if (deleteButton) deleteButton.disabled = false;
	};

	viewButton?.addEventListener('click', async () => {
		viewButton.disabled = true;
		setStatus(VIEW_STATUS, 'Opening…');
		try {
			const res = await deps.sendMessage({ type: 'BN_FEEDBACK_LINK' });
			if (res?.ok && res.url) {
				deps.openUrl(res.url);
				setStatus(VIEW_STATUS, '');
			} else {
				setStatus(VIEW_STATUS, res?.error || 'Could not open your feedback.');
			}
		} catch (err: any) {
			setStatus(VIEW_STATUS, err?.message || 'Could not open your feedback.');
		} finally {
			viewButton.disabled = false;
		}
	});

	/*
	 * Deleting takes two steps. The first only asks the server how much there is, so the
	 * confirmation can name a number instead of being a blind "delete everything" — and
	 * nothing is deleted if the user stops here.
	 */
	deleteButton?.addEventListener('click', async () => {
		deleteButton.disabled = true;
		setStatus(DELETE_STATUS, '');
		let count: number | undefined;
		try {
			const res = await deps.sendMessage({ type: 'BN_FEEDBACK_COUNT' });
			if (!res?.ok) {
				setStatus(DELETE_STATUS, res?.error || 'Could not reach the server.');
				deleteButton.disabled = false;
				return;
			}
			count = res.count;
		} catch (err: any) {
			setStatus(DELETE_STATUS, err?.message || 'Could not reach the server.');
			deleteButton.disabled = false;
			return;
		}

		if (count === 0) {
			setStatus(DELETE_STATUS, 'There is no feedback from this browser to delete.');
			deleteButton.disabled = false;
			return;
		}

		if (prompt) {
			const items = count === 1 ? '1 item' : `${count} items`;
			prompt.textContent = `Permanently delete the feedback sent from this browser (${items})? This cannot be undone.`;
		}
		confirmBox?.classList.remove('hidden');
		// Cancel takes focus, so a stray Enter does not delete anything.
		cancelButton?.focus();
	});

	cancelButton?.addEventListener('click', () => {
		hideConfirm();
		setStatus(DELETE_STATUS, 'Nothing was deleted.');
	});

	yesButton?.addEventListener('click', async () => {
		if (yesButton) yesButton.disabled = true;
		setStatus(DELETE_STATUS, 'Deleting…');
		try {
			const res = await deps.sendMessage({ type: 'BN_FEEDBACK_DELETE' });
			if (res?.ok) {
				const items = res.deleted === 1 ? '1 item' : `${res.deleted} items`;
				setStatus(DELETE_STATUS, `Deleted ${items}.`);
			} else {
				setStatus(DELETE_STATUS, res?.error || 'Could not delete your feedback.');
			}
		} catch (err: any) {
			setStatus(DELETE_STATUS, err?.message || 'Could not delete your feedback.');
		} finally {
			if (yesButton) yesButton.disabled = false;
			hideConfirm();
		}
	});
}
