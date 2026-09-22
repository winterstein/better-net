/**
 * What the popup and options page show about this browser's account link.
 *
 * A pure function, kept apart from the DOM so the wording — which is the whole point of the
 * feature — can be tested. See specs/accounts/user-identity/spec.md.
 *
 * The extension never requires an account, so nothing here ever nags: an unlinked browser is
 * offered a button and told nothing is wrong, because nothing is.
 */

export type AccountLinkState =
	| { kind: 'unlinked' }
	| { kind: 'linked'; email?: string }
	/** The server could not be reached, which is not the same as "not linked". */
	| { kind: 'unavailable' };

export interface AccountLinkView {
	/** A line of status, or '' to show nothing. */
	status: string;
	showLink: boolean;
	linkLabel: string;
}

/** The reply from BN_ACCOUNT_STATUS, mapped to a state. */
export function accountLinkState(reply: {
	ok?: boolean;
	linked?: boolean;
	email?: string;
} | null | undefined): AccountLinkState {
	if (!reply?.ok) return { kind: 'unavailable' };
	if (!reply.linked) return { kind: 'unlinked' };
	return { kind: 'linked', email: reply.email };
}

export function accountLinkView(state: AccountLinkState): AccountLinkView {
	switch (state.kind) {
		case 'linked':
			return {
				// Naming the account is the point: "linked" alone leaves the user wondering
				// linked to what, especially on a shared computer.
				status: state.email
					? `This browser is linked to ${state.email}.`
					: 'This browser is linked to your better:net account.',
				// Still offered, because linking again is how you move a device to another
				// account — there is no separate unlink (specs/accounts/user-identity).
				showLink: true,
				linkLabel: 'Link to a different account',
			};
		case 'unlinked':
			return {
				status: 'This browser is not linked to an account. It does not need to be.',
				showLink: true,
				linkLabel: 'Link this browser to an account',
			};
		case 'unavailable':
			// Deliberately silent rather than claiming "not linked", which would be a guess,
			// or showing an error for something the user did not ask for.
			return { status: '', showLink: true, linkLabel: 'Link this browser to an account' };
	}
}
