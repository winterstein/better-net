/**
 * Account routes: linking a browser's local id to the signed-in Auth0 account.
 * See bn-extension/specs/accounts/user-identity/spec.md.
 *
 * Two halves, deliberately authorised differently:
 * - the extension asks for a link code, proving only that it holds the local id
 * - the webapp redeems it with a JWT, which is what says *whose* account to link it to
 *
 * That split is why the long-lived local id never has to reach the webapp.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accountForDevice, createLinkCode, deviceCount, redeemLinkCode } from '../accounts.js';
import { requireAuth } from '../auth.js';

/** An email is guessable; a local id is not. Refusing one is a cheap guard against misuse. */
function looksLikeEmail(value: string): boolean {
	return value.includes('@');
}

/** @returns the local id from the body, or null if it is missing or obviously not one. */
function readLocalId(body?: { localId?: string }): string | null {
	const localId = body?.localId?.trim();
	if (!localId || localId.length < 16 || looksLikeEmail(localId)) return null;
	return localId;
}

async function accountRoutes(fastify: FastifyInstance) {
	// From the extension. No JWT: possession of the local id is the credential.
	fastify.post<{ Body: { localId?: string } }>('/link-code', async (
		request: FastifyRequest<{ Body: { localId?: string } }>,
		reply: FastifyReply
	) => {
		const localId = readLocalId(request.body);
		if (!localId) return reply.code(400).send({ error: 'A local id is required' });
		const { code, expires } = await createLinkCode(localId);
		return reply.code(201).send({ code, expires: expires.toISOString() });
	});

	// From the webapp, after sign-in.
	fastify.post<{ Body: { code?: string } }>('/link', async (
		request: FastifyRequest<{ Body: { code?: string } }>,
		reply: FastifyReply
	) => {
		const user = await requireAuth(request, reply);
		if (!user) return reply;
		const code = request.body?.code?.trim().toUpperCase();
		if (!code) return reply.code(400).send({ error: 'A code is required' });
		const linkedDevices = await redeemLinkCode(code, user.sub);
		if (linkedDevices === null) {
			// Expired or already used. 410 rather than 400: the request was well formed.
			return reply.code(410).send({ error: 'That link has expired' });
		}
		return reply.send({ linkedDevices });
	});

	/**
	 * Is this browser linked, and to which account? Drives the extension's popup and options
	 * page, which show either a Link button or the linked status
	 * (bn-extension/specs/accounts/user-identity/spec.md).
	 *
	 * POST, not GET, so the local id stays in a request body rather than a query string —
	 * it is a credential, and query strings land in access logs.
	 */
	fastify.post<{ Body: { localId?: string } }>('/device-status', async (
		request: FastifyRequest<{ Body: { localId?: string } }>,
		reply: FastifyReply
	) => {
		const localId = readLocalId(request.body);
		if (!localId) return reply.code(400).send({ error: 'A local id is required' });
		const account = await accountForDevice(localId);
		// An account with no email on file is still linked, so report the two separately.
		return reply.send({ linked: account !== null, email: account?.email });
	});

	/** What the webapp needs to decide which empty state to show. */
	fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
		const user = await requireAuth(request, reply);
		if (!user) return reply;
		return reply.send({
			email: user.email,
			isStaff: user.isStaff,
			linkedDevices: await deviceCount(user.sub),
		});
	});
}

export default accountRoutes;
