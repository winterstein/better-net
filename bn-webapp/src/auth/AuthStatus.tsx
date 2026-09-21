/** Sign in / out, and the staff link — shown only to staff, so nobody is invited into a 403. */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, NavItem } from 'reactstrap';
import { useAuth0 } from '@auth0/auth0-react';
import { feedbackApi } from '../services/api';
import { requireToken } from './token';

export function AuthStatus() {
	const { isAuthenticated, isLoading, user, loginWithRedirect, logout } = useAuth0();
	if (isLoading) return null;
	if (!isAuthenticated) {
		return (
			<Button size="sm" color="primary" onClick={() => void loginWithRedirect()}>
				Sign in
			</Button>
		);
	}
	return (
		<div className="d-flex align-items-center gap-2">
			<small className="text-muted">{user?.email}</small>
			<Button
				size="sm"
				color="link"
				onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
			>
				Sign out
			</Button>
		</div>
	);
}

export function StaffNavItem({ onNavigate }: { onNavigate?: () => void }) {
	const { isAuthenticated, getAccessTokenSilently } = useAuth0();
	const [isStaff, setIsStaff] = useState(false);

	useEffect(() => {
		if (!isAuthenticated) {
			setIsStaff(false);
			return;
		}
		let live = true;
		(async () => {
			try {
				const me = await feedbackApi.me(await requireToken(getAccessTokenSilently));
				if (live) setIsStaff(me.isStaff);
			} catch {
				// Not staff, or the call failed: either way, do not show the link.
				if (live) setIsStaff(false);
			}
		})();
		return () => {
			live = false;
		};
	}, [isAuthenticated, getAccessTokenSilently]);

	if (!isStaff) return null;
	return (
		<NavItem>
			<Link to="/staff/feedback" className="nav-link" onClick={onNavigate}>
				All feedback
			</Link>
		</NavItem>
	);
}
