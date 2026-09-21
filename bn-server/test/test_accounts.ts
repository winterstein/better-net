/**
 * Accounts, authenticated feedback reads, and delete.
 * See bn-extension/specs/accounts/user-identity/spec.md and
 * bn-server/specs/feedback/feedback-read-api/spec.md.
 *
 * Auth0 is stood in for by a local RSA keypair: the same jwtVerify path runs, so issuer,
 * audience, expiry and signature are all genuinely checked — only the key fetch is local.
 */

import tap from 'tap';
import Fastify, { FastifyInstance } from 'fastify';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import accountRoutes from '../src/routes/account.js';
import feedbackRoutes from '../src/routes/feedback.js';
import { setKeyStoreForTests } from '../src/auth.js';
import { db_init, db_close, db_get_client } from '../src/db.js';
import { submitterPseudonym } from '../src/accounts.js';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.test', override: true });

process.env.AUTH0_DOMAIN = 'test.auth0.local';
process.env.AUTH0_AUDIENCE = 'https://api.better-net.test';
process.env.BN_PSEUDONYM_SECRET = 'test-pseudonym-secret';

const ISSUER = 'https://test.auth0.local/';
let privateKey: CryptoKey;
let fastify: FastifyInstance | undefined;

async function initTest(): Promise<FastifyInstance> {
	await db_init();
	if (!fastify) {
		const pair = await generateKeyPair('RS256');
		privateKey = pair.privateKey as CryptoKey;
		const jwk = await exportJWK(pair.publicKey);
		jwk.alg = 'RS256';
		setKeyStoreForTests(createLocalJWKSet({ keys: [jwk] }));

		fastify = Fastify({ logger: false });
		fastify.register(accountRoutes, { prefix: '/api/account' });
		fastify.register(feedbackRoutes, { prefix: '/api/feedback' });
		await fastify.listen({ port: 0 });
	}
	return fastify;
}

interface TokenOpts {
	sub?: string;
	email?: string;
	audience?: string;
	issuer?: string;
	expiresIn?: string;
}

async function token(opts: TokenOpts = {}): Promise<string> {
	await initTest();
	return await new SignJWT({ email: opts.email ?? 'someone@example.com' })
		.setProtectedHeader({ alg: 'RS256' })
		.setSubject(opts.sub ?? 'auth0|test-user')
		.setIssuer(opts.issuer ?? ISSUER)
		.setAudience(opts.audience ?? 'https://api.better-net.test')
		.setIssuedAt()
		.setExpirationTime(opts.expiresIn ?? '5m')
		.sign(privateKey);
}

const uniq = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function get(url: string, jwt?: string) {
	const app = await initTest();
	return app.inject({
		method: 'GET',
		url,
		headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
	});
}

async function post(url: string, payload: Record<string, unknown>, jwt?: string) {
	const app = await initTest();
	return app.inject({
		method: 'POST',
		url,
		payload,
		headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
	});
}

/** Submit feedback the way the extension does: anonymous, owned by a local id. */
async function submitFeedback(ownerKey: string, extra: Record<string, unknown> = {}) {
	const res = await post('/api/feedback/', {
		localId: uniq('fb'),
		target: 'summary',
		thumbsUp: false,
		chunkFingerprint: uniq('fp'),
		chunkUrl: 'https://example.com/a',
		ownerKey,
		...extra,
	});
	if (res.statusCode >= 300) throw new Error(`feedback POST failed: ${res.statusCode} ${res.body}`);
	return res;
}

/**
 * Staff is granted in the database, as in production. Upserts, because the bnuser row is
 * only created by that account's first authenticated request and tests may grant first.
 */
async function setStaff(sub: string, isStaff: boolean) {
	const client = await db_get_client();
	try {
		await client.query(
			`INSERT INTO bnuser (sub, isStaff) VALUES ($1, $2)
			 ON CONFLICT (sub) DO UPDATE SET isStaff = EXCLUDED.isStaff`,
			[sub, isStaff]
		);
	} finally {
		client.release();
	}
}

tap.teardown(async () => {
	setKeyStoreForTests(undefined);
	if (fastify) await fastify.close();
	await db_close();
});

// --- writing feedback stays anonymous -------------------------------------------------
tap.test('Feedback_POST_needs_no_account', async (t) => {
	const res = await submitFeedback(uniq('owner'));
	t.equal(res.statusCode, 201, 'no JWT required to give feedback');
});

// --- the JWT is really verified -------------------------------------------------------
tap.test('Auth_rejects_bad_tokens', async (t) => {
	t.equal((await get('/api/feedback/mine')).statusCode, 401, 'no token');
	t.equal((await get('/api/feedback/mine', 'not-a-jwt')).statusCode, 401, 'garbage');
	t.equal(
		(await get('/api/feedback/mine', await token({ expiresIn: '-1m' }))).statusCode,
		401,
		'expired'
	);
	// The one that matters: a perfectly valid token for another Auth0 API must not work here.
	t.equal(
		(await get('/api/feedback/mine', await token({ audience: 'https://other-api.example' })))
			.statusCode,
		401,
		'wrong audience'
	);
	t.equal(
		(await get('/api/feedback/mine', await token({ issuer: 'https://evil.example/' }))).statusCode,
		401,
		'wrong issuer'
	);
	t.equal((await get('/api/feedback/mine', await token())).statusCode, 200, 'a good token works');
});

// --- first sign-in creates the user, without staff ------------------------------------
tap.test('Account_me_creates_user_without_staff', async (t) => {
	const sub = uniq('auth0|new');
	const res = await get('/api/account/me', await token({ sub, email: 'new@example.com' }));
	t.equal(res.statusCode, 200);
	const me = res.json() as any;
	t.equal(me.email, 'new@example.com');
	t.equal(me.isStaff, false, 'staff is never granted by signing in');
	t.equal(me.linkedDevices, 0, 'nothing linked yet');
});

// --- linking --------------------------------------------------------------------------
tap.test('Link_code_is_single_use_and_links_the_device', async (t) => {
	const ownerKey = uniq('owner-link');
	await submitFeedback(ownerKey);

	const codeRes = await post('/api/account/link-code', { localId: ownerKey });
	t.equal(codeRes.statusCode, 201, 'the extension needs no JWT for this');
	const { code } = codeRes.json() as any;
	t.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/, 'short and typeable');

	const sub = uniq('auth0|linker');
	const jwt = await token({ sub });
	t.equal((await post('/api/account/link', { code })).statusCode, 401, 'redeeming needs a JWT');

	const linked = await post('/api/account/link', { code }, jwt);
	t.equal(linked.statusCode, 200);
	t.equal((linked.json() as any).linkedDevices, 1);

	const reused = await post('/api/account/link', { code }, jwt);
	t.equal(reused.statusCode, 410, 'a code works once');

	const mine = await get('/api/feedback/mine', jwt);
	t.equal((mine.json() as any).total, 1, 'the linked device feedback is now visible');
});

tap.test('Link_code_rejects_an_email_as_the_local_id', async (t) => {
	const res = await post('/api/account/link-code', { localId: 'someone@example.com' });
	t.equal(res.statusCode, 400, 'an email is guessable and is not a local id');
});

tap.test('Relinking_moves_a_device_between_accounts', async (t) => {
	const ownerKey = uniq('owner-move');
	await submitFeedback(ownerKey);
	const subA = uniq('auth0|a');
	const subB = uniq('auth0|b');
	const jwtA = await token({ sub: subA });
	const jwtB = await token({ sub: subB });

	const first = await post('/api/account/link-code', { localId: ownerKey });
	await post('/api/account/link', { code: (first.json() as any).code }, jwtA);
	t.equal((await get('/api/feedback/mine', jwtA)).json().total, 1, 'A sees it');

	// Same device, linked again from a different account: it moves rather than duplicating.
	const second = await post('/api/account/link-code', { localId: ownerKey });
	const moved = await post('/api/account/link', { code: (second.json() as any).code }, jwtB);
	t.equal(moved.statusCode, 200);
	t.equal((moved.json() as any).linkedDevices, 1, 'B has one device');
	t.equal((await get('/api/feedback/mine', jwtB)).json().total, 1, 'B sees it now');
	t.equal((await get('/api/feedback/mine', jwtA)).json().total, 0, 'and A no longer does');
});

// --- my feedback ----------------------------------------------------------------------
tap.test('Mine_is_scoped_to_linked_devices', async (t) => {
	const mineKey = uniq('owner-mine');
	const otherKey = uniq('owner-other');
	await submitFeedback(mineKey);
	await submitFeedback(otherKey);

	const sub = uniq('auth0|scoped');
	const jwt = await token({ sub });
	const code = (await post('/api/account/link-code', { localId: mineKey })).json() as any;
	await post('/api/account/link', { code: code.code }, jwt);

	const res = await get('/api/feedback/mine', jwt);
	const body = res.json() as any;
	t.equal(body.total, 1, 'only my linked device');
	t.equal(body.rows[0].ownerKey, mineKey, 'own data is not redacted');
});

tap.test('Mine_with_nothing_linked_is_empty_not_everything', async (t) => {
	await submitFeedback(uniq('owner-someone-else'));
	const res = await get('/api/feedback/mine', await token({ sub: uniq('auth0|unlinked') }));
	t.equal(res.statusCode, 200, 'not an error');
	const body = res.json() as any;
	t.same(body.rows, [], 'an unlinked account sees no feedback at all');
	t.equal(body.linkedDevices, 0, 'so the webapp can say why');
});

// --- staff ----------------------------------------------------------------------------
tap.test('All_needs_staff_and_hides_the_submitter', async (t) => {
	const ownerKey = uniq('owner-staff');
	await submitFeedback(ownerKey, { userId: 'private@example.com', message: 'a note' });

	const sub = uniq('auth0|staffer');
	const jwt = await token({ sub, email: 'staffer@example.com' });
	t.equal((await get('/api/feedback/all')).statusCode, 401, 'anonymous cannot');
	t.equal((await get('/api/feedback/all', jwt)).statusCode, 403, 'a signed-in user cannot');

	await setStaff(sub, true);
	const res = await get('/api/feedback/all', jwt);
	t.equal(res.statusCode, 200, 'staff can');

	const raw = res.body;
	t.notMatch(raw, /private@example.com/, 'no submitter email anywhere in the response');
	t.notMatch(raw, new RegExp(ownerKey), 'and no owner key either');
	t.notMatch(raw, /"userId"/, 'the email label field is not serialised at all');

	const row = (res.json() as any).rows.find((r: any) => r.message === 'a note');
	t.ok(row, 'the feedback itself is there');
	t.equal(row.submitter, submitterPseudonym(ownerKey), 'shown as a stable pseudonym');
});

tap.test('Staff_can_group_by_submitter', async (t) => {
	const busy = uniq('owner-busy');
	const quiet = uniq('owner-quiet');
	// Messages are unique per run: the test database is not reset between runs, so matching
	// on fixed text would pick up rows from earlier ones.
	const first = uniq('msg');
	const second = uniq('msg');
	const third = uniq('msg');
	await submitFeedback(busy, { message: first });
	await submitFeedback(busy, { message: second });
	await submitFeedback(quiet, { message: third });

	const sub = uniq('auth0|staff2');
	const jwt = await token({ sub });
	await setStaff(sub, true);
	// Newest first, so this run's rows are at the front of the page.
	const rows = (await get('/api/feedback/all?limit=200', jwt)).json().rows as any[];
	const mine = rows.filter((r) => [first, second, third].includes(r.message));
	t.equal(mine.length, 3, 'all three of this run\'s rows came back');

	const busyRows = mine.filter((r) => [first, second].includes(r.message));
	t.equal(busyRows.length, 2);
	t.equal(busyRows[0].submitter, busyRows[1].submitter, 'one person reads as one person');
	t.equal(busyRows[0].submitter, submitterPseudonym(busy), 'under their stable pseudonym');
	const quietRow = mine.find((r) => r.message === third);
	t.not(quietRow.submitter, busyRows[0].submitter, 'a different person reads as different');
});

tap.test('All_filters_and_paginates', async (t) => {
	const ownerKey = uniq('owner-filter');
	await submitFeedback(ownerKey, {
		target: 'module',
		moduleId: 'clickUnbait',
		tag: 'clickbait',
		tagOn: false,
		thumbsUp: undefined,
	});
	const sub = uniq('auth0|staff3');
	const jwt = await token({ sub });
	await setStaff(sub, true);

	const filtered = (await get('/api/feedback/all?target=module&moduleId=clickUnbait', jwt)).json() as any;
	t.ok(filtered.total >= 1);
	t.ok(
		filtered.rows.every((r: any) => r.target === 'module' && r.moduleId === 'clickUnbait'),
		'only matching rows'
	);

	const paged = (await get('/api/feedback/all?limit=1', jwt)).json() as any;
	t.equal(paged.rows.length, 1, 'limit is honoured');
	t.ok(paged.total >= 1, 'total counts beyond the page');
});

// --- delete ---------------------------------------------------------------------------
tap.test('Delete_mine_removes_only_that_device', async (t) => {
	const mineKey = uniq('owner-del');
	const keepKey = uniq('owner-keep');
	await submitFeedback(mineKey, { message: 'delete me' });
	await submitFeedback(mineKey, { message: 'and me' });
	await submitFeedback(keepKey, { message: 'not me' });

	const counted = await post('/api/feedback/count-mine', { localId: mineKey });
	t.equal((counted.json() as any).count, 2, 'the count the dialog shows');

	const res = await post('/api/feedback/delete-mine', { localId: mineKey });
	t.equal(res.statusCode, 200);
	t.equal((res.json() as any).deleted, 2);

	t.equal((await post('/api/feedback/count-mine', { localId: mineKey })).json().count, 0, 'gone');
	t.equal(
		(await post('/api/feedback/count-mine', { localId: keepKey })).json().count,
		1,
		"another device's feedback is untouched"
	);
});

tap.test('Delete_mine_with_nothing_to_delete_is_not_an_error', async (t) => {
	const res = await post('/api/feedback/delete-mine', { localId: uniq('owner-empty') });
	t.equal(res.statusCode, 200);
	t.equal((res.json() as any).deleted, 0);
});

tap.test('Feedback_after_a_delete_still_upserts', async (t) => {
	const ownerKey = uniq('owner-again');
	const localId = uniq('fb-again');
	const payload = {
		localId,
		target: 'summary',
		thumbsUp: false,
		chunkFingerprint: uniq('fp'),
		chunkUrl: 'https://example.com/again',
		ownerKey,
	};
	t.equal((await post('/api/feedback/', payload)).statusCode, 201);
	await post('/api/feedback/delete-mine', { localId: ownerKey });
	t.equal((await post('/api/feedback/', payload)).statusCode, 201, 'inserts again after deletion');
	t.equal((await post('/api/feedback/', payload)).statusCode, 200, 'and upserts as normal after that');
});

tap.test('Delete_leaves_the_chunk_and_page_rows', async (t) => {
	const ownerKey = uniq('owner-chunkkeep');
	const fingerprint = uniq('fp-keep');
	await submitFeedback(ownerKey, { chunkFingerprint: fingerprint, pageUrl: 'https://example.com/keep' });
	await post('/api/feedback/delete-mine', { localId: ownerKey });

	const client = await db_get_client();
	try {
		const chunk = await client.query(`SELECT COUNT(*)::int AS n FROM chunk WHERE fingerprint = $1`, [
			fingerprint,
		]);
		t.equal(chunk.rows[0].n, 1, 'the chunk describes a public page, so it stays');
	} finally {
		client.release();
	}
});
