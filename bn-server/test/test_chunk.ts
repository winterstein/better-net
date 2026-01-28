import tap from 'tap';
import Fastify, { FastifyInstance } from 'fastify';
import chunkRoutes from '../src/routes/chunk.js';
import { db_init, db_close } from '../src/db.js';

// load .env
import dotenv from 'dotenv';
import { is } from '../src/utils/miscutils.js';
import { isDeepEqual } from '../src/utils/miscutils.ts';
import { getDefaultAnalysisEngine } from '../src/plugin-src/analyzers/AnalysisEngine.js';
dotenv.config();
// load .env.test
dotenv.config({ path: '.env.test', override: true });

let fastify: FastifyInstance | undefined;

async function initTestNoIntegration(): Promise<FastifyInstance> {
	console.log('Initializing test...');
	// disable API keys - loop over process.env keys and set to empty string
	for (const key in process.env) {
		if (key.match(/API_?(KEY|SECRET)/)) {
			process.env[key] = '';
		}
	}
	// AnalysisEngine: set enabled analyzers to []
	process.env.BN_ANALYSIS_ENABLED_ANALYZERS = '[]';
	getDefaultAnalysisEngine().setEnabledAnalyzers([]);	
	
	await db_init();
	if ( ! fastify) {
		fastify = Fastify({ logger: false });
		// Register chunk routes only
		fastify.register(chunkRoutes, { prefix: '/api/chunk' });
		const port = Number(process.env.PORT) || 0; // Use 0 for random available port in tests
		await fastify.listen({ port });
	}
	return fastify;
}

tap.teardown(async () => {
	if (fastify) await fastify.close();
	await db_close();
});


tap.test('Chunk_POST_and_GET', async (t) => {
	await initTestNoIntegration();
	if (!fastify) {
		t.fail('Fastify instance not initialized');
		return;
	}

	// 1. POST a new chunk
	const newChunkData = {
		type: 'text',
		value: 'Hello test chunk'
	};

	const postRes = await fastify.inject({
		method: 'POST',
		url: '/api/chunk/',
		payload: newChunkData
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
}); // end of Chunk_POST_and_GET


tap.test('Chunk_analyze_POST_and_GET', async (t) => {
	await initTestNoIntegration();
	if (!fastify) {
		t.fail('Fastify instance not initialized');
		return;
	}

	// 1. Create a chunk with required fields for analysis
	const newChunkData = {
		url: 'https://example.com/test',
		text: 'This is a test chunk for analysis. It contains some content that needs to be analyzed.',
		title: 'Test Page'
	};

	const postRes = await fastify.inject({
		method: 'POST',
		url: '/api/chunk/',
		payload: newChunkData
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
				mode: 'local',
				enabledAnalyzers: ['fakeNews', 'bias', 'scams', 'toxicity']
			}
		}
	});

	t.equal(analyzeRes.statusCode, 200, 'Analyze POST should return 200');
	const analysisResult = analyzeRes.json() as any;
	t.ok(analysisResult.chunkId, 'Analysis result should have chunkId');
	t.ok(typeof analysisResult.overallScore === 'number', 'Analysis result should have overallScore');
	t.ok(analysisResult.analyses, 'Analysis result should have analyses object');
	t.ok(analysisResult.timestamp, 'Analysis result should have timestamp');

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
		}
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
		payload: {}
	});

	t.equal(postNonExistentRes.statusCode, 404, 'POST analyze on non-existent chunk should return 404');
});

