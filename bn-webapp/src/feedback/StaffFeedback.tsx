/**
 * Staff view: everyone's feedback, submitters shown as stable pseudonyms.
 * The API never sends an email, so there is nothing to hide here
 * (bn-server/specs/feedback/feedback-read-api/spec.md).
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Container, Input, Spinner } from 'reactstrap';
import { useAuth0 } from '@auth0/auth0-react';
import { ApiError, feedbackApi, type FeedbackPage } from '../services/api';
import { FeedbackList } from './FeedbackList';
import { requireToken } from '../auth/token';

const TARGETS = ['', 'summary', 'module', 'chunk', 'chunker', 'page'];

export default function StaffFeedback() {
	const { isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();
	const [page, setPage] = useState<FeedbackPage | null>(null);
	const [target, setTarget] = useState('');
	const [forbidden, setForbidden] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);

	const load = useCallback(async () => {
		setLoaded(false);
		setError(null);
		setForbidden(false);
		try {
			const token = await requireToken(getAccessTokenSilently);
			setPage(await feedbackApi.allFeedback(token, { target: target || undefined, limit: 100 }));
		} catch (err: any) {
			// 403 is a signed-in non-staff user: a different message from a failure.
			if (err instanceof ApiError && err.status === 403) setForbidden(true);
			else setError(err?.message || 'Could not load feedback');
		} finally {
			setLoaded(true);
		}
	}, [getAccessTokenSilently, target]);

	useEffect(() => {
		if (isAuthenticated) void load();
	}, [isAuthenticated, load]);

	if (isLoading) return <Container className="py-4"><Spinner /></Container>;
	if (!isAuthenticated) return <Container className="py-4"><p>Sign in to continue.</p></Container>;
	if (forbidden) {
		return (
			<Container className="py-4">
				<h1 className="h4">All feedback</h1>
				<Alert color="secondary">This view is not available for your account.</Alert>
			</Container>
		);
	}

	return (
		<Container className="py-4">
			<h1 className="h4">All feedback</h1>
			<div className="mb-3" style={{ maxWidth: 240 }}>
				<Input type="select" value={target} onChange={(e) => setTarget(e.target.value)}>
					{TARGETS.map((t) => (
						<option key={t} value={t}>
							{t || 'All targets'}
						</option>
					))}
				</Input>
			</div>
			{error && <Alert color="danger">{error}</Alert>}
			{!loaded && <Spinner />}
			{loaded && page && (
				<>
					<p className="text-muted">{page.total} items</p>
					{page.rows.length === 0 ? <p>No feedback matches.</p> : <FeedbackList rows={page.rows} showSubmitter />}
				</>
			)}
		</Container>
	);
}
