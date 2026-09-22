/**
 * Auth0 sign-in for the webapp. The extension never needs an account; this app always does
 * (bn-webapp/specs/feedback/feedback-viewer/spec.md).
 *
 * Tenant better-net.eu.auth0.com. `VITE_AUTH0_AUDIENCE` must name the bn-server API, or
 * Auth0 issues an opaque token instead of a JWT and every API call comes back 401.
 */

import React from 'react';
import { Auth0Provider, type AppState } from '@auth0/auth0-react';
import { useNavigate } from 'react-router-dom';

const domain = (import.meta.env?.VITE_AUTH0_DOMAIN as string) || '';
const clientId = (import.meta.env?.VITE_AUTH0_CLIENT_ID as string) || '';
const audience = (import.meta.env?.VITE_AUTH0_AUDIENCE as string) || '';

export const authConfigured = Boolean(domain && clientId);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const navigate = useNavigate();

	if (!authConfigured) {
		// Better than a blank screen when the build is missing its Auth0 vars.
		return <>{children}</>;
	}

	/*
	 * Auth0 only ever returns to the origin — that is the one callback URL registered per
	 * environment — so without this, signing in from /feedback lands the user back on the
	 * pages list, wondering where their feedback went. `returnTo` is set by whichever button
	 * started the login (AuthStatus, MyFeedback).
	 */
	const onRedirectCallback = (appState?: AppState) => {
		navigate(appState?.returnTo || window.location.pathname, { replace: true });
	};

	return (
		<Auth0Provider
			domain={domain}
			clientId={clientId}
			onRedirectCallback={onRedirectCallback}
			authorizationParams={{
				redirect_uri: window.location.origin,
				// The audience is what makes Auth0 issue a token bn-server will accept.
				audience: audience || undefined,
			}}
		>
			{children}
		</Auth0Provider>
	);
}

/**
 * Start a login that comes back to the page it was started from.
 * A plain `loginWithRedirect()` would drop the user at the origin instead.
 */
export function returnHere(): { appState: { returnTo: string } } {
	return { appState: { returnTo: `${window.location.pathname}${window.location.search}` } };
}
