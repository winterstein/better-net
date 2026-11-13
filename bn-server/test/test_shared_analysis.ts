/**
 * Shared analysis: upload, lookup, dedupe, best model, what is refused, the site list,
 * and removing a contributor. See specs/shared-analysis/spec.md and build-plan.md.
 */

import tap from 'tap';
import Fastify, { FastifyInstance } from 'fastify';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import sharedAnalysisRoutes, { LIMITS, contributorPseudonym } from '../src/routes/shared-analysis.js';
import { setKeyStoreForTests } from '../src/auth.js';
import { db_init, db_close, db_get_client } from '../src/db.js';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.test', override: true });

process.env.AUTH0_DOMAIN = 'test.auth0.local';
process.env.AUTH0_AUDIENCE = 'https://api.better-net.test';
process.env.BN_PSEUDONYM_SECRET = 'test-pseudonym-secret';

const ISSUER = 'https://test.auth0.local/';
let privateKey: CryptoKey;
let fastify: FastifyInstance | undefined;

async function app(): Promise<FastifyInstance> {
	await db_init();
	if (!fastify) {
		const pair = await generateKeyPair('RS256');
		privateKey = pair.privateKey as CryptoKey;
		const jwk = await exportJWK(pair.publicKey);
		jwk.alg = 'RS256';
		setKeyStoreForTests(createLocalJWKSet({ keys: [jwk] }));
		fastify = Fastify({ logger: false });
		fastify.register(sharedAnalysisRoutes, { prefix: '/api/shared-analysis' });
		await fastify.ready();
	}
	return fastify;
}

/** A unique tag per run, so reruns against the same database do not collide. */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let seq = 0;
const key = () => `k${RUN}${(seq++).toString().padStart(4, '0')}`;
const pageUrl = (name: string) => `https://news.example.com/${RUN}/${name}`;
const shareId = (name: string) => `share-${RUN}-${name}-0000000000`;

const verdict = (extra: Record<string, unknown> = {}) => ({
	problemScore: 'medium',
	confidence: 0.8,
	tags: [],
	explanation: 'One-sided framing.',
	...extra,
});

async function upload(body: Record<string, unknown>) {
	return (await app()).inject({ method: 'POST', url: '/api/shared-analysis/', payload: body });
}
async function lookup(url: string) {
	const res = await (await app()).inject({ method: 'POST', url: '/api/shared-analysis/lookup', payload: { url } });
	return res.json().results as any[];
}
async function staffToken(isStaff: boolean): Promise<string> {
	const sub = `auth0|shared-${RUN}-${isStaff ? 'staff' : 'user'}`;
	const token = await new SignJWT({})
		.setProtectedHeader({ alg: 'RS256' })
		.setSubject(sub)
		.setIssuer(ISSUER)
		.setAudience(process.env.AUTH0_AUDIENCE)
		.setExpirationTime('5m')
		.sign(privateKey);
	if (isStaff) {
		const a = await app();
		// First authed call creates the user; then promote it.
		await a.inject({ method: 'PUT', url: '/api/shared-analysis/site-lists', headers: { authorization: `Bearer ${token}` }, payload: {} });
		const client = await db_get_client();
		await client.query(`UPDATE bnuser SET isStaff = TRUE WHERE sub = $1`, [sub]);
		client.release();
	}
	return token;
}

tap.teardown(async () => {
	const client = await db_get_client();
	await client.query(`DELETE FROM sharedResult WHERE chunkKey LIKE $1`, [`k${RUN}%`]);
	await client.query(`DELETE FROM sharedContributor WHERE chunkKey LIKE $1`, [`k${RUN}%`]);
	await client.query(`DELETE FROM pageSplit WHERE url LIKE $1`, [`%/${RUN}/%`]);
	await client.query(`DELETE FROM siteList WHERE pattern LIKE $1`, [`%${RUN}%`]);
	await client.query(`DELETE FROM blockedContributor WHERE contributor = $1`, [contributorPseudonym(shareId('bad'))]);
	await client.query(`DELETE FROM bnuser WHERE sub LIKE $1`, [`auth0|shared-${RUN}-%`]);
	client.release();
	await fastify?.close();
	db_close();
});

tap.test('upload then lookup; a repeat upload does not duplicate', async (t) => {
	const url = pageUrl('basic');
	const chunkKey = key();
	const body = { shareId: shareId('a'), url: `${url}?utm_source=x#top`, results: [{ featureId: 'biasDetector', chunkKey, model: 'gpt-4o', result: verdict({ id: 'local-1', user: 'me', spanId: 's1' }) }] };

	const first = await upload(body);
	t.equal(first.statusCode, 200);
	t.same(first.json(), { stored: 1, received: 1 });

	const found = await lookup(url);
	t.equal(found.length, 1);
	t.equal(found[0].chunkKey, chunkKey);
	t.equal(found[0].result.explanation, 'One-sided framing.');
	t.notOk('id' in found[0].result || 'user' in found[0].result || 'spanId' in found[0].result, 'per-user fields are dropped');

	const again = await upload(body);
	t.same(again.json(), { stored: 0, received: 1 }, 'same feature, chunk and model is one row');
	t.equal((await lookup(url)).length, 1);
});

tap.test('lookup serves the best-ranked model', async (t) => {
	const url = pageUrl('models');
	const chunkKey = key();
	for (const model of ['flan-t5-small', 'claude-sonnet-4-5', 'my-custom-model', 'llama3.2:3b']) {
		const res = await upload({ shareId: shareId('a'), url, results: [{ featureId: 'biasDetector', chunkKey, model, result: verdict({ explanation: model }) }] });
		t.equal(res.statusCode, 200, model);
	}
	const found = await lookup(url);
	t.equal(found.length, 1);
	t.equal(found[0].model, 'claude-sonnet-4-5');
});

tap.test('refused uploads', async (t) => {
	const url = pageUrl('refused');
	const item = (extra: Record<string, unknown> = {}) => ({ featureId: 'biasDetector', chunkKey: key(), model: 'gpt-4o', result: verdict(), ...extra });
	const send = (results: unknown[], over: Record<string, unknown> = {}) => upload({ shareId: shareId('a'), url, results, ...over });

	t.equal((await send([item({ model: 'heuristic' })])).statusCode, 400, 'heuristic');
	t.equal((await send([item({ model: '' })])).statusCode, 400, 'no model');
	t.equal((await send([item({ result: verdict({ error: 'boom' }) })])).statusCode, 400, 'error result');
	t.equal((await send([item({ text: 'the chunk text' })])).statusCode, 400, 'chunk text beside the result');
	t.equal((await send([item({ result: verdict({ html: '<p>chunk</p>' }) })])).statusCode, 400, 'chunk html in the result');
	t.equal((await send([item({ result: verdict({ explanation: 'x'.repeat(LIMITS.resultBytes) , metadata: { big: 'y'.repeat(LIMITS.resultBytes) } }) })])).statusCode, 400, 'oversize');
	t.equal((await send([item({ chunkKey: 'no' })])).statusCode, 400, 'bad key');
	t.equal((await send([])).statusCode, 400, 'empty');
	t.equal((await send([item()], { shareId: 'short' })).statusCode, 400, 'no share id');
	t.equal((await send([item()], { url: 'https://www.facebook.com/somepage' })).statusCode, 403, 'blocked site');
	t.equal((await send([item()], { url: 'https://x.com/messages/123' })).statusCode, 403, 'private path');
	t.equal((await send([item()], { url: 'http://localhost:3000/page' })).statusCode, 403, 'local host');
	t.same(await lookup(url), [], 'nothing was stored');
	t.same(await lookup('https://www.facebook.com/somepage'), [], 'blocked site lookup is empty');
});

tap.test('stored text is sanitised', async (t) => {
	const url = pageUrl('sanitised');
	const res = await upload({
		shareId: shareId('a'),
		url,
		results: [{ featureId: 'factChecker', chunkKey: key(), model: 'gpt-4o', result: verdict({ explanation: 'False. <script>alert(1)</script>See https://evil.example/login now', url: 'javascript:alert(1)', metadata: { note: '<b>bold</b>' } }) }],
	});
	t.equal(res.statusCode, 200);
	const [found] = await lookup(url);
	t.notMatch(found.result.explanation, /<|https?:/);
	t.notOk('url' in found.result, 'a non-http url is dropped');
	t.equal(found.result.metadata.note, 'bold');
});

tap.test('rate limit', async (t) => {
	const saved = LIMITS.uploadsPerWindow;
	LIMITS.uploadsPerWindow = 2;
	t.teardown(() => { LIMITS.uploadsPerWindow = saved; });
	const body = () => ({ shareId: shareId('flood'), url: pageUrl('flood'), results: [{ featureId: 'biasDetector', chunkKey: key(), model: 'gpt-4o', result: verdict() }] });
	const codes = [];
	for (let i = 0; i < 4; i++) codes.push((await upload(body())).statusCode);
	t.ok(codes.includes(429), `got ${codes.join(',')}`);
});

tap.test('site list: seed entries, staff edits, and the edit is enforced', async (t) => {
	const a = await app();
	const list = (await a.inject({ method: 'GET', url: '/api/shared-analysis/site-lists' })).json().list;
	t.ok(list.some((e) => e.pattern === 'facebook.com' && e.kind === 'block'));
	t.ok(list.some((e) => e.pattern === 'x.com/messages' && e.kind === 'private'));

	const domain = `blocked-${RUN}.example.org`;
	const put = (token: string | null, payload: Record<string, unknown>) =>
		a.inject({ method: 'PUT', url: '/api/shared-analysis/site-lists', headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
	const staff = await staffToken(true);
	t.equal((await put(null, { pattern: domain, kind: 'block' })).statusCode, 401);
	t.equal((await put(await staffToken(false), { pattern: domain, kind: 'block' })).statusCode, 403);
	t.equal((await put(staff, { pattern: domain, kind: 'nonsense' })).statusCode, 400);

	const item = { featureId: 'biasDetector', chunkKey: key(), model: 'gpt-4o', result: verdict() };
	const url = `https://${domain}/${RUN}/story`;
	t.equal((await upload({ shareId: shareId('a'), url, results: [item] })).statusCode, 200, 'allowed before the edit');
	t.equal((await put(staff, { pattern: domain, kind: 'block', note: 'test' })).statusCode, 200);
	t.equal((await upload({ shareId: shareId('a'), url, results: [item] })).statusCode, 403, 'blocked after');
	t.same(await lookup(url), [], 'and lookups stop too');
	t.equal((await put(staff, { pattern: domain, kind: null })).statusCode, 200);
	t.equal((await lookup(url)).length, 1, 'removing the entry restores it');
});

tap.test('removing a contributor deletes their results, keeps shared ones, and blocks them', async (t) => {
	const a = await app();
	const url = pageUrl('removal');
	const onlyBad = { featureId: 'biasDetector', chunkKey: key(), model: 'gpt-4o', result: verdict() };
	const both = { featureId: 'biasDetector', chunkKey: key(), model: 'gpt-4o', result: verdict() };
	await upload({ shareId: shareId('bad'), url, results: [onlyBad, both] });
	await upload({ shareId: shareId('good'), url, results: [both] });
	t.equal((await lookup(url)).length, 2);

	const remove = (token: string | null, payload: Record<string, unknown>) =>
		a.inject({ method: 'POST', url: '/api/shared-analysis/remove-contributor', headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
	t.equal((await remove(null, {})).statusCode, 401);
	const staff = await staffToken(true);
	// Named by one of their results, which is what staff will have in front of them.
	const res = await remove(staff, { featureId: onlyBad.featureId, chunkKey: onlyBad.chunkKey, model: onlyBad.model });
	t.equal(res.statusCode, 200);
	t.same(res.json().contributors, [contributorPseudonym(shareId('bad'))]);

	const left = await lookup(url);
	t.equal(left.length, 1);
	t.equal(left[0].chunkKey, both.chunkKey, 'the result a second contributor sent survives');
	const blocked = await upload({ shareId: shareId('bad'), url, results: [{ ...onlyBad, chunkKey: key() }] });
	t.equal(blocked.statusCode, 403);
	t.equal((await upload({ shareId: shareId('good'), url, results: [{ ...onlyBad, chunkKey: key() }] })).statusCode, 200);
});
