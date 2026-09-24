/**
 * "My feedback": the corrections this account's linked browsers have sent.
 * See bn-webapp/specs/feedback/feedback-viewer/spec.md.
 *
 * Arriving from the extension means a one-time link code in the fragment, which is redeemed
 * after sign-in and then removed from the URL.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Container, Spinner } from 'reactstrap';
import { useAuth0 } from '@auth0/auth0-react';
import { ApiError, feedbackApi, type FeedbackPage } from '../services/api';
import { takeLinkCode } from '../auth/link-code';
import { feedbackView } from './feedback-state';
import { requireToken } from '../auth/token';
import { returnHere } from '../auth/AuthProvider';
import { FeedbackList } from './FeedbackList';

export default function MyFeedback() {
	const { isAuthenticated, isLoading, loginWithRedirect, getAccessTokenSilently } = useAuth0();
	const [page, setPage] = useState<FeedbackPage | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [linking, setLinking] = useState(false);
	const [linkExpired, setLinkExpired] = useState(false);
	const [loaded, setLoaded] = useState(false);

	const load = useCallback(async () => {
		try {
			const token = await requireToken(getAccessTokenSilently);
			// The code arrives from the extension and was stashed at startup (main.tsx); redeem
			// it before loading, so a first visit shows the newly linked device's feedback
			// rather than an empty list.
			const code = takeLinkCode(window.sessionStorage);
			if (code) {
				setLinking(true);
				try {
					await feedbackApi.linkDevice(token, code);
				} catch (err) {
					// 410 is a stale or reused link, which is expected and not an error state.
					if (err instanceof ApiError && err.status === 410) setLinkExpired(true);
					else throw err;
				} finally {
					setLinking(false);
				}
			}
			setPage(await feedbackApi.myFeedback(token));
		} catch (err: any) {
			setError(err?.message || 'Could not load your feedback');
		} finally {
			setLoaded(true);
		}
	}, [getAccessTokenSilently]);

	useEffect(() => {
		if (isAuthenticated) void load();
	}, [isAuthenticated, load]);

	const view = feedbackView({
		isAuthenticated,
		isLoading: isLoading || (isAuthenticated && !loaded),
		linking,
		linkExpired,
		error,
		linkedDevices: page?.linkedDevices,
		rowCount: page?.rows.length,
	});

	return (
		<Container className="py-4">
			<h1 className="h4">My feedback</h1>

			{view.kind === 'loading' && <Spinner />}

			{view.kind === 'signin' && (
				<>
					<p>Sign in to see the feedback you have sent us.</p>
					<Button color="primary" onClick={() => void loginWithRedirect(returnHere())}>
						Sign in
					</Button>
				</>
			)}

			{view.kind === 'linking' && <p>Linking this browser…</p>}

			{view.kind === 'link-expired' && (
				<Alert color="warning">
					That link has expired. Open <strong>View my feedback</strong> again from the
					extension options page.
				</Alert>
			)}

			{linkExpired && view.kind === 'rows' && (
				<Alert color="warning">
					That link has expired. Showing feedback from browsers already linked to this account.
				</Alert>
			)}

			{view.kind === 'error' && <Alert color="danger">{view.message}</Alert>}

			{/* Not the same as "you have given no feedback" — say what to actually do. */}
			{view.kind === 'no-devices' && (
				<Alert color="info">
					No browsers linked to this account yet. Open <strong>View my feedback</strong> from
					the better:net options page in the browser you give feedback in.
				</Alert>
			)}

			{view.kind === 'empty' && (
				<p>
					No feedback yet. You can correct our labels from the Content Analysis panel on any
					page.
				</p>
			)}

			{view.kind === 'rows' && page && (
				<>
					<p className="text-muted">{page.total} items</p>
					<FeedbackList rows={page.rows} />
				</>
			)}
		</Container>
	);
}
