import tap from 'tap';
import Fastify, { FastifyInstance } from 'fastify';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import chunkRoutes from '../src/routes/chunk.js';
import { db_init, db_close } from '../src/db.js';
import { setKeyStoreForTests } from '../src/auth.js';
import { PROBLEM_SCORES } from '../src/bn-extension-src/types/Score.js';

// load .env
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.test', override: true });

process.env.AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || 'test.auth0.local';
process.env.AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || 'https://api.better-net.test';

const ISSUER = `https://${process.env.AUTH0_DOMAIN}/`;
let privateKey: CryptoKey;
let fastify: FastifyInstance | undefined;

async function initTestNoIntegration(): Promise<FastifyInstance> {
	console.log('Initializing test...');
	for (const key in process.env) {
		if (key.match(/API_?(KEY|SECRET)/)) {
			process.env[key] = '';
		}
	}
	
	await db_init();
	if ( ! fastify) {
		const pair = await generateKeyPair('RS256');
		privateKey = pair.privateKey as CryptoKey;
		const jwk = await exportJWK(pair.publicKey);
		jwk.alg = 'RS256';
		setKeyStoreForTests(createLocalJWKSet({ keys: [jwk] }));

		fastify = Fastify({ logger: false });
		// Register chunk routes only
		fastify.register(chunkRoutes, { prefix: '/api/chunk' });
		const port = Number(process.env.PORT) || 0; // Use 0 for random available port in tests
		await fastify.listen({ port });
	}
	return fastify;
}

async function authHeader(): Promise<{ authorization: string }> {
	await initTestNoIntegration();
	const jwt = await new SignJWT({ email: 'chunk-test@example.com' })
		.setProtectedHeader({ alg: 'RS256' })
		.setSubject('auth0|chunk-test')
		.setIssuer(ISSUER)
		.setAudience(process.env.AUTH0_AUDIENCE as string)
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(privateKey);
	return { authorization: `Bearer ${jwt}` };
}

tap.teardown(async () => {
	setKeyStoreForTests(undefined);
	if (fastify) await fastify.close();
	await db_close();
});


tap.test('Chunk_POST_and_GET', async (t) => {
	await initTestNoIntegration();
	if (!fastify) {
		t.fail('Fastify instance not initialized');
		return;
	}

	const headers = await authHeader();

	t.equal(
		(await fastify.inject({ method: 'POST', url: '/api/chunk/', payload: { type: 'text' } })).statusCode,
		401,
		'creating a chunk needs a token'
	);

	// 1. POST a new chunk
	const newChunkData = {
		type: 'text',
		value: 'Hello test chunk'
	};

	const postRes = await fastify.inject({
		method: 'POST',
		url: '/api/chunk/',
		payload: newChunkData,
		headers,
	});

	t.equal(postRes.statusCode, 201, 'Chunk POST should return 201');
	const chunk = postRes.json() as any;
	t.ok(chunk.id, 'POST response should have id property');
	t.match(chunk, { ...newChunkData }, 'POST response should contain chunk data');

	// 2. GET all chunks
	const getAllRes = await fastify.inject({
		method: 'GET',
		url: '/api/chunk/'
	});

	t.equal(getAllRes.statusCode, 200, 'Chunk GET all should succeed');
	const allChunks = getAllRes.json() as any[];
	t.ok(Array.isArray(allChunks), 'GET all should return an array');
	t.ok(allChunks.find(c => c.id === chunk.id), 'Created chunk should be in GET all response');

	// 3. GET by id
	const getOneRes = await fastify.inject({
		method: 'GET',
		url: `/api/chunk/${chunk.id}`
	});

	t.equal(getOneRes.statusCode, 200, 'Chunk GET by id should succeed');
	const chunkById = getOneRes.json() as any;
	t.same(chunkById, chunk, 'GET by id should return the created chunk');

	const putRes = await fastify.inject({
		method: 'PUT',
		url: `/api/chunk/${chunk.id}`,
		payload: { value: 'updated', id: 999999 },
		headers,
	});
	t.equal(putRes.statusCode, 200, 'Chunk PUT should succeed');
	t.equal(putRes.json().id, chunk.id, 'PUT must not change the row id');
	t.equal(putRes.json().value, 'updated');

	const badSort = await fastify.inject({
		method: 'GET',
		url: '/api/chunk/?sort=updated;drop%20table%20chunk',
	});
	t.equal(badSort.statusCode, 400, 'sort is an allowlist, not pasted into ORDER BY');
});


tap.test('Chunk_analyze_POST_and_GET', async (t) => {
	await initTestNoIntegration();
	if (!fastify) {
		t.fail('Fastify instance not initialized');
		return;
	}

	const headers = await authHeader();

	t.equal(
		(await fastify.inject({
			method: 'POST',
			url: '/api/chunk/1/analyze',
			payload: {},
		})).statusCode,
		401,
		'analyze needs a token'
	);

	// 1. Create a chunk with required fields for analysis
	const newChunkData = {
		url: 'https://example.com/test',
		text: 'This is a test chunk for analysis. It contains some content that needs to be analyzed.',
		title: 'Test Page'
	};

	const postRes = await fastify.inject({
		method: 'POST',
		url: '/api/chunk/',
		payload: newChunkData,
		headers,
	});

	t.equal(postRes.statusCode, 201, 'Chunk POST should return 201');
	const chunk = postRes.json() as any;
	t.ok(chunk.id, 'POST response should have id property');

	// 2. POST analyze - perform analysis
	const analyzeRes = await fastify.inject({
		method: 'POST',
		url: `/api/chunk/${chunk.id}/analyze`,
		payload: {
			options: {
				mode: 'heuristic',
				enabledFeatures: ['factChecker', 'biasDetector', 'antiManipulation', 'defuseRagebait']
			}
		},
		headers,
	});

	t.equal(analyzeRes.statusCode, 200, 'Analyze POST should return 200');
	const analysisResult = analyzeRes.json() as any;
	t.ok(analysisResult.chunkId, 'Analysis result should have chunkId');
	// problemScore is the high|medium|low ProblemScore enum, not a [0,1] number
	t.ok(PROBLEM_SCORES.includes(analysisResult.summary?.problemScore), 'Analysis result should have summary.problemScore');
	t.ok(Array.isArray(analysisResult.analyses), 'Analysis result should have analyses array');
	t.ok(analysisResult.chunkId, 'Analysis result should have chunkId');

	// 3. GET analyze - retrieve analysis from database
	const getAnalyzeRes = await fastify.inject({
		method: 'GET',
		url: `/api/chunk/${chunk.id}/analyze`
	});

	t.equal(getAnalyzeRes.statusCode, 200, 'Analyze GET should return 200');
	const retrievedAnalysis = getAnalyzeRes.json() as any;
	t.same(retrievedAnalysis, analysisResult, 'GET analyze should return the same analysis result');

	// 4. Test GET analyze on non-existent chunk
	const getNonExistentRes = await fastify.inject({
		method: 'GET',
		url: '/api/chunk/99999/analyze'
	});

	t.equal(getNonExistentRes.statusCode, 404, 'GET analyze on non-existent chunk should return 404');

	// 5. Test GET analyze on chunk without analysis
	const newChunkRes = await fastify.inject({
		method: 'POST',
		url: '/api/chunk/',
		payload: {
			url: 'https://example.com/no-analysis',
			text: 'This chunk has no analysis yet'
		},
		headers,
	});

	const newChunk = newChunkRes.json() as any;
	const getNoAnalysisRes = await fastify.inject({
		method: 'GET',
		url: `/api/chunk/${newChunk.id}/analyze`
	});

	t.equal(getNoAnalysisRes.statusCode, 404, 'GET analyze on chunk without analysis should return 404');

	// 6. Test POST analyze on non-existent chunk
	const postNonExistentRes = await fastify.inject({
		method: 'POST',
		url: '/api/chunk/99999/analyze',
		payload: {},
		headers,
	});

	t.equal(postNonExistentRes.statusCode, 404, 'POST analyze on non-existent chunk should return 404');
});
