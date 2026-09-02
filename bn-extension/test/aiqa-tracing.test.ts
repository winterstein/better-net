/**
 * AIQA tracing: off unless enabled, and when enabled produces the analyze / chunk /
 * LLM span tree that tracing/aiqa-tracer.ts posts to the AIQA server.
 *
 * The wire format is OTLP/JSON on `/v1/traces` (aiqa-client's exporter); it is decoded
 * back to flat spans here so the assertions stay about the span tree.
 */

import assert from 'node:assert/strict';
import {
	configureAiqaTracing,
	flushAiqaSpans,
	recordRelayedSteps,
	resetAiqaTracingForTests,
} from '../src/tracing/aiqa-tracer.js';
import { startSpan, endSpan, isTracing } from '../src/tracing/tracer-hook.js';
import { createStepRecorder, StepRecorder } from '../src/tracing/trace-steps.js';
import { analyzeChunksParallel } from '../src/analysis/engine.js';

const SERVER = 'https://aiqa.test';
const API_KEY = 'test-key';

/** Spans the stubbed server received, plus the requests that carried them. */
type Posted = { url: string; headers: Record<string, string>; spans: any[] };

function stubFetch(): { posted: Posted[] } {
	const posted: Posted[] = [];
	(globalThis as any).fetch = async (url: string, init: any) => {
		posted.push({
			url: String(url),
			headers: init?.headers ?? {},
			spans: spansFromOtlpBody(JSON.parse(init?.body ?? '{}')),
		});
		return { ok: true, status: 200, statusText: 'OK', async text() { return ''; } };
	};
	return { posted };
}

/** OTLP AnyValue -> the plain value the span was given. */
function fromOtlpValue(value: any): any {
	if (!value || typeof value !== 'object') return undefined;
	if (value.stringValue !== undefined) return value.stringValue;
	if (value.boolValue !== undefined) return value.boolValue;
	if (value.intValue !== undefined) return Number(value.intValue);
	if (value.doubleValue !== undefined) return value.doubleValue;
	if (value.arrayValue?.values) return value.arrayValue.values.map(fromOtlpValue);
	return undefined;
}

function fromOtlpAttributes(kvs: any[] | undefined): Record<string, any> {
	const out: Record<string, any> = {};
	for (const kv of kvs ?? []) out[kv.key] = fromOtlpValue(kv.value);
	return out;
}

/** One OTLP ExportTraceServiceRequest -> flat spans, keyed as the AIQA server stores them. */
function spansFromOtlpBody(body: any): any[] {
	const spans: any[] = [];
	for (const resourceSpan of body?.resourceSpans ?? []) {
		for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
			for (const span of scopeSpan.spans ?? []) {
				spans.push({
					name: span.name,
					id: span.spanId,
					trace_id: span.traceId,
					parent_span_id: span.parentSpanId,
					start_time: Number(span.startTimeUnixNano) / 1e6,
					end_time: span.endTimeUnixNano === undefined ? undefined : Number(span.endTimeUnixNano) / 1e6,
					status: span.status,
					attributes: fromOtlpAttributes(span.attributes),
				});
			}
		}
	}
	return spans;
}

const localBackend = {
	async zeroShot() {
		return {
			labels: ['This text is objective', 'This text is politically biased'],
			scores: [0.6, 0.4],
		};
	},
	async generate() {
		throw new Error('generate should not be called');
	},
};

const CHUNKS = [
	{ id: 'c1', xpath: '/html/body/div[1]', text: 'Ticket prices rose at the festival.', tags: ['article'] },
	{ id: 'c2', xpath: '/html/body/div[2]', text: 'A second passage of page text.', tags: [] },
];

async function runAnalysis(recorderSteps: any[]) {
	const trace = startSpan('betternet.analyze_page', {
		startTime: Date.now() - 500,
		attributes: { 'betternet.url': 'https://example.com', 'betternet.chunk_count': CHUNKS.length },
	});
	recordRelayedSteps(recorderSteps, trace);
	await analyzeChunksParallel(
		CHUNKS as any,
		{ url: 'https://example.com', domain: 'example.com' },
		{
			mode: 'local',
			config: { localModelId: 'mobilebert-mnli' },
			enabledFeatures: ['biasDetector'],
			localBackend,
			trace,
		}
	);
	endSpan(trace, { 'betternet.duration_ms': 1 });
	await flushAiqaSpans();
}

/** Chunking steps as the content script records them (tracing/trace-steps.ts). */
async function recordChunkingSteps(enabled: boolean) {
	const { recorder, steps } = createStepRecorder(enabled);
	await recorder.step('betternet.chunk_page', { 'betternet.chunk.attempt': 1 }, (step: StepRecorder) =>
		step.step('betternet.chunk.regex', { 'betternet.chunk.strategy': 'regex' }, (leaf) => {
			leaf.annotate({ 'betternet.chunk.count': CHUNKS.length });
			return CHUNKS;
		})
	);
	return steps;
}

// Disabled: nothing is recorded and nothing is sent.
{
	const { posted } = stubFetch();
	await resetAiqaTracingForTests();

	const enabled = await configureAiqaTracing({ aiqaTracing: false, aiqaApiKey: API_KEY });
	assert.equal(enabled, false);
	assert.equal(isTracing(), false);
	assert.deepEqual(await recordChunkingSteps(false), []);

	await runAnalysis([]);
	assert.deepEqual(posted, [], 'no spans should be sent while tracing is disabled');
}

// Enabled but no API key: still off, matching aiqa-client's own behaviour.
{
	const { posted } = stubFetch();
	await resetAiqaTracingForTests();

	assert.equal(await configureAiqaTracing({ aiqaTracing: true, aiqaApiKey: '  ' }), false);
	await runAnalysis([]);
	assert.deepEqual(posted, [], 'no spans without an API key');
}

// Enabled: full span tree reaches the server.
{
	const { posted } = stubFetch();
	await resetAiqaTracingForTests();

	const enabled = await configureAiqaTracing({
		aiqaTracing: true,
		aiqaApiKey: API_KEY,
		aiqaServerUrl: SERVER,
	});
	assert.equal(enabled, true);
	assert.equal(isTracing(), true);

	const steps = await recordChunkingSteps(true);
	assert.equal(steps.length, 1);
	assert.equal(steps[0].children?.[0]?.name, 'betternet.chunk.regex');

	await runAnalysis(steps);

	assert.ok(posted.length > 0, 'spans should be posted');
	assert.equal(posted[0].url, `${SERVER}/v1/traces`, 'posts to the AIQA OTLP endpoint');
	assert.equal(posted[0].headers.Authorization, `Bearer ${API_KEY}`);

	const spans = posted.flatMap((p) => p.spans);
	const byName = new Map(spans.map((s) => [s.name, s]));

	for (const name of [
		'betternet.analyze_page',
		'betternet.chunk_page',
		'betternet.chunk.regex',
		'betternet.analyze_chunk',
		'betternet.feature.biasDetector',
		'local.zero_shot',
	]) {
		assert.ok(byName.has(name), `expected a ${name} span`);
	}

	// One analyze_chunk and one feature span per chunk.
	assert.equal(spans.filter((s) => s.name === 'betternet.analyze_chunk').length, CHUNKS.length);
	assert.equal(spans.filter((s) => s.name === 'betternet.feature.biasDetector').length, CHUNKS.length);
	assert.equal(spans.filter((s) => s.name === 'local.zero_shot').length, CHUNKS.length);

	// Nesting: page -> chunk_page -> chunk.regex, and page -> analyze_chunk -> feature -> model.
	const page = byName.get('betternet.analyze_page');
	const chunkPage = byName.get('betternet.chunk_page');
	const analyzeChunk = spans.find((s) => s.name === 'betternet.analyze_chunk');
	const feature = spans.find(
		(s) => s.name === 'betternet.feature.biasDetector' && s.parent_span_id === analyzeChunk.id
	);
	assert.ok(feature, 'feature span hangs off its chunk');
	const model = spans.find((s) => s.name === 'local.zero_shot' && s.parent_span_id === feature.id);
	assert.ok(model, 'model call hangs off its feature');

	assert.equal(page.parent_span_id, undefined, 'analyze_page is the trace root');
	assert.equal(chunkPage.parent_span_id, page.id);
	assert.equal(byName.get('betternet.chunk.regex').parent_span_id, chunkPage.id);
	assert.equal(analyzeChunk.parent_span_id, page.id);
	assert.equal(new Set(spans.map((s) => s.trace_id)).size, 1, 'one trace for the whole analysis');

	// Attributes AIQA reports on.
	assert.equal(page.attributes['betternet.url'], 'https://example.com');
	assert.equal(page.attributes['aiqa.component'], 'betternet.bn-extension');
	assert.equal(chunkPage.attributes['betternet.chunk.attempt'], 1);
	assert.equal(byName.get('betternet.chunk.regex').attributes['betternet.chunk.count'], CHUNKS.length);
	assert.equal(analyzeChunk.attributes['betternet.chunk.text_length'], CHUNKS[0].text.length);
	assert.equal(model.attributes['gen_ai.system'], 'local');
	assert.equal(model.attributes['gen_ai.request.model'], 'mobilebert-mnli');
	assert.equal(feature.attributes['betternet.feature'], 'biasDetector');
	assert.equal(typeof feature.attributes['betternet.problem_score'], 'number');

	// The root span covers the chunking that happened before it was created.
	assert.ok(page.start_time <= chunkPage.start_time, 'chunking falls inside the page span');

	// Chunk text itself must never leave the browser.
	const body = JSON.stringify(spans);
	assert.ok(!body.includes(CHUNKS[0].text), 'span attributes must not carry chunk text');
}

// Turning the setting back off tears tracing down.
{
	const { posted } = stubFetch();
	assert.equal(await configureAiqaTracing({ aiqaTracing: false }), false);
	assert.equal(isTracing(), false);
	await runAnalysis([]);
	assert.deepEqual(posted, [], 'no spans after tracing is switched off');
}

await resetAiqaTracingForTests();
console.log('✅ aiqa tracing tests passed');
