/**
 * Auth0 sign-in for the webapp. The extension never needs an account; this app always does
 * (bn-webapp/specs/feedback/feedback-viewer/spec.md).
 */

import React from 'react';
import { Auth0Provider } from '@auth0/auth0-react';

const domain = (import.meta.env?.VITE_AUTH0_DOMAIN as string) || '';
const clientId = (import.meta.env?.VITE_AUTH0_CLIENT_ID as string) || '';
const audience = (import.meta.env?.VITE_AUTH0_AUDIENCE as string) || '';

export const authConfigured = Boolean(domain && clientId);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	if (!authConfigured) {
		// Better than a blank screen when the build is missing its Auth0 vars.
		return <>{children}</>;
	}
	return (
		<Auth0Provider
			domain={domain}
			clientId={clientId}
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
