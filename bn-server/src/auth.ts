/**
 * Auth0 JWT verification. See bn-server/specs/feedback/feedback-read-api/spec.md.
 *
 * Writing feedback stays anonymous — only reading or deleting it needs an account, so this
 * guards those routes and nothing else.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getOrCreateUser, type BnUser } from './accounts.js';

export interface AuthedUser extends BnUser {}

/** Set by requireAuth so handlers do not re-verify. */
declare module 'fastify' {
	interface FastifyRequest {
		bnUser?: AuthedUser;
	}
}

/**
 * Auth0 access tokens carry no `email` — that claim lives on the ID token, which only the
 * webapp sees. A post-login Action copies it here, under a namespace because Auth0 silently
 * drops custom claims that are not namespaced. Without the Action the email is simply
 * absent, which is survivable: `sub` is the identity, and the email is only ever a label.
 */
const EMAIL_CLAIM = 'https://better-net.com/email';

function authConfig() {
	const domain = process.env.AUTH0_DOMAIN || '';
	const audience = process.env.AUTH0_AUDIENCE || '';
	return { domain, audience, issuer: domain ? `https://${domain}/` : '' };
}

/**
 * Cached across requests: the JWKS is fetched once and refreshed by jose on key rotation.
 * Rebuilt if the configured domain changes, which in practice only happens in tests.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksDomain = '';
function keyStore(domain: string) {
	if (!jwks || jwksDomain !== domain) {
		jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
		jwksDomain = domain;
	}
	return jwks;
}

/**
 * Tests inject a local key set rather than reaching Auth0. Production never calls this, and
 * the guard below refuses to run at all without AUTH0_DOMAIN, so an unconfigured server
 * cannot accidentally accept unverified tokens.
 */
let keyStoreOverride: Parameters<typeof jwtVerify>[1] | undefined;
export function setKeyStoreForTests(ks: Parameters<typeof jwtVerify>[1] | undefined): void {
	keyStoreOverride = ks;
}

export interface VerifiedToken {
	sub: string;
	email?: string;
}

/** `email` if the tenant ever sends one, else the namespaced claim the Action adds. */
function emailFrom(payload: Record<string, unknown>): string | undefined {
	if (typeof payload.email === 'string') return payload.email;
	const claim = payload[EMAIL_CLAIM];
	return typeof claim === 'string' ? claim : undefined;
}

/** @returns the token's subject, or null if it is missing, malformed, expired or not ours. */
export async function verifyBearer(authorization?: string): Promise<VerifiedToken | null> {
	const { domain, audience, issuer } = authConfig();
	const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
	if (!token) return null;
	if (!keyStoreOverride && !domain) return null;
	try {
		const { payload } = await jwtVerify(token, keyStoreOverride ?? keyStore(domain), {
			// Both checked: a valid token for a *different* Auth0 API must not work here.
			issuer: issuer || undefined,
			audience: audience || undefined,
		});
		if (!payload.sub) return null;
		return { sub: payload.sub, email: emailFrom(payload) };
	} catch {
		return null;
	}
}

/** 401 unless the request carries a valid token. Creates the user row on first sign-in. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> {
	const verified = await verifyBearer(request.headers.authorization);
	if (!verified) {
		reply.code(401).send({ error: 'Sign-in required' });
		return null;
	}
	const user = await getOrCreateUser(verified.sub, verified.email);
	request.bnUser = user;
	return user;
}

/** 403 for a signed-in non-staff caller, so the webapp can tell it apart from 401. */
export async function requireStaff(request: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | null> {
	const user = await requireAuth(request, reply);
	if (!user) return null;
	if (!user.isStaff) {
		reply.code(403).send({ error: 'Staff only' });
		return null;
	}
	return user;
}
