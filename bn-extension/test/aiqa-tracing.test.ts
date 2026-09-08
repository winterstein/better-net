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
	mirrorFeedbackToAiqa,
	recordRelayedSteps,
	resetAiqaTracingForTests,
} from '../src/tracing/aiqa-tracer.js';
import { startSpan, endSpan, isTracing } from '../src/tracing/tracer-hook.js';
import { createStepRecorder, StepRecorder } from '../src/tracing/trace-steps.js';
import { analyzeChunksParallel } from '../src/analysis/engine.js';
import { OpenAILLMClient } from '../src/ai/llm-client.js';
import {
	beginDestinationBudget,
	fetchDestinationText,
	resetDestinationCache,
} from '../src/features/click-unbait/fetch-destination.js';

const SERVER = 'https://aiqa.test';
const API_KEY = 'test-key';

/** Spans the stubbed server received, plus the requests that carried them. */
type Posted = { url: string; headers: Record<string, string>; spans: any[] };

/**
 * Collect AIQA exports. `others` handles any non-AIQA URL (the LLM provider), so a test
 * can trace a real client call.
 */
function stubFetch(others?: (url: string, init: any) => any): { posted: Posted[] } {
	const posted: Posted[] = [];
	(globalThis as any).fetch = async (url: string, init: any) => {
		if (others && !String(url).startsWith(SERVER)) return others(String(url), init);
		posted.push({
			url: String(url),
			headers: init?.headers ?? {},
			spans: spansFromOtlpBody(JSON.parse(init?.body ?? '{}')),
		});
		return { ok: true, status: 200, statusText: 'OK', async text() { return ''; } };
	};
	return { posted };
}

/** An OpenAI chat completion, or a failure when `status` is given. */
function openaiResponse(status?: number) {
	if (status) {
		return { ok: false, status, statusText: 'Too Many Requests', async text() { return ''; } };
	}
	return {
		ok: true,
		status: 200,
		statusText: 'OK',
		async json() {
			return {
				model: 'gpt-4o-mini-2024-07-18',
				usage: { prompt_tokens: 210, completion_tokens: 24 },
				choices: [
					{
						finish_reason: 'stop',
						message: { content: '{"problemScore":0.8,"confidence":0.9,"flags":["bias"]}' },
					},
				],
			};
		},
	};
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

/** Load + inference stages as inference-worker.ts times them inside the worker. */
function workerTraceSteps() {
	const start = Date.now();
	return [
		{
			name: 'local.load_model',
			start,
			end: start + 5,
			attributes: { 'betternet.model.cached': true },
		},
		{
			name: 'local.infer',
			start: start + 5,
			end: start + 35,
			attributes: { 'gen_ai.request.model': 'mobilebert-mnli' },
		},
	];
}

const localBackend = {
	async zeroShot() {
		return {
			labels: ['This text is objective', 'This text is politically biased'],
			scores: [0.6, 0.4],
			traceSteps: workerTraceSteps(),
		};
	},
	async generate() {
		throw new Error('generate should not be called');
	},
};

const CHUNKS = [
	{ id: 'c1', xpath: '/html/body/div[1]', text: 'Ticket prices rose at the festival.', tags: ['article'] },
	{
		id: 'c2',
		xpath: '/html/body/div[2]',
		text: 'A second passage of page text.',
		title: 'Council extends festival licence',
		tags: [],
	},
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
		'local.load_model',
		'local.infer',
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

	// Stages timed inside the inference worker, replayed under the model call.
	const load = spans.find((s) => s.name === 'local.load_model' && s.parent_span_id === model.id);
	const infer = spans.find((s) => s.name === 'local.infer' && s.parent_span_id === model.id);
	assert.ok(load, 'worker model load hangs off the model call');
	assert.ok(infer, 'worker inference hangs off the model call');
	assert.equal(spans.filter((s) => s.name === 'local.infer').length, CHUNKS.length);
	// Worker timings survive the relay rather than being re-measured here.
	assert.equal(Math.round(infer.end_time - infer.start_time), 30);
	assert.equal(load.attributes['betternet.model.cached'], true);

	assert.equal(page.parent_span_id, undefined, 'analyze_page is the trace root');
	assert.equal(chunkPage.parent_span_id, page.id);
	assert.equal(byName.get('betternet.chunk.regex').parent_span_id, chunkPage.id);
	assert.equal(analyzeChunk.parent_span_id, page.id);
	assert.equal(new Set(spans.map((s) => s.trace_id)).size, 1, 'one trace for the whole analysis');

	// AIQA's input/output pair on the chunk and feature spans.
	const byChunk = (id: string, name: string) =>
		spans.find((s) => s.name === name && s.attributes['betternet.chunk.id'] === id);
	const titled = byChunk('c2', 'betternet.analyze_chunk');
	assert.equal(titled.attributes['input'], CHUNKS[1].title, 'the headline is the chunk input');
	assert.equal(analyzeChunk.attributes['input'], '', 'a chunk with no headline has a blank input');

	const chunkOut = JSON.parse(String(titled.attributes['output']));
	// The stubbed zero-shot verdict (0.6 objective / 0.4 biased) lands at medium risk.
	assert.equal(chunkOut.risk, 'medium');
	assert.equal(typeof chunkOut.score, 'number');
	assert.ok(Array.isArray(chunkOut.flags));

	// The feature output carries the model's own explanation, which is what AIQA judges.
	assert.equal(feature.attributes['input'], '', 'the feature span shares the chunk input');
	const featureOut = JSON.parse(String(feature.attributes['output']));
	assert.equal(featureOut.score, feature.attributes['betternet.problem_score']);
	assert.equal(typeof featureOut.confidence, 'number');
	assert.ok(featureOut.explanation.length > 0, 'the verdict explanation is on the span');

	// Attributes AIQA reports on.
	assert.equal(page.attributes['betternet.url'], 'https://example.com');
	assert.equal(page.attributes['aiqa.component'], 'betternet.bn-extension');
	assert.equal(chunkPage.attributes['betternet.chunk.attempt'], 1);
	assert.equal(byName.get('betternet.chunk.regex').attributes['betternet.chunk.count'], CHUNKS.length);
	assert.equal(analyzeChunk.attributes['betternet.chunk.text_length'], CHUNKS[0].text.length);
	assert.equal(model.attributes['gen_ai.system'], 'local');
	assert.equal(model.attributes['gen_ai.request.model'], 'mobilebert-mnli');
	assert.equal(feature.attributes['betternet.feature'], 'biasDetector');
	assert.equal(feature.attributes['betternet.analysis.mode'], 'local');
	assert.equal(feature.attributes['betternet.analysis.path'], 'local');
	assert.equal(model.attributes['betternet.zero_shot.top_label'], 'This text is objective');
	assert.equal(model.attributes['betternet.zero_shot.top_score'], 0.6);
	assert.equal(typeof feature.attributes['betternet.problem_score'], 'number');

	// The root span covers the chunking that happened before it was created.
	assert.ok(page.start_time <= chunkPage.start_time, 'chunking falls inside the page span');

	// Chunk text itself must never leave the browser.
	const body = JSON.stringify(spans);
	assert.ok(!body.includes(CHUNKS[0].text), 'span attributes must not carry chunk text');
}

// A remote LLM call: the client's own span carries model, usage and finish reason.
{
	const { posted } = stubFetch((url) => {
		assert.equal(url, 'https://api.openai.com/v1/chat/completions');
		return openaiResponse();
	});
	await resetAiqaTracingForTests();
	await configureAiqaTracing({ aiqaTracing: true, aiqaApiKey: API_KEY, aiqaServerUrl: SERVER });

	const trace = startSpan('betternet.analyze_page', {});
	await analyzeChunksParallel(
		[CHUNKS[0]] as any,
		{ url: 'https://example.com', domain: 'example.com' },
		{
			mode: 'openai',
			enabledFeatures: ['biasDetector'],
			llmClient: new OpenAILLMClient('sk-test', 'gpt-4o-mini'),
			trace,
		} as any
	);
	endSpan(trace);
	await flushAiqaSpans();

	const spans = posted.flatMap((p) => p.spans);
	const feature = spans.find((s) => s.name === 'betternet.feature.biasDetector');
	const call = spans.find((s) => s.name === 'bias-detector.openai');
	assert.ok(call, 'the LLM call is traced under its own name');
	assert.equal(call.parent_span_id, feature.id, 'the call hangs off its feature');
	assert.equal(call.attributes['gen_ai.system'], 'openai');
	assert.equal(call.attributes['gen_ai.request.model'], 'gpt-4o-mini');
	assert.equal(call.attributes['gen_ai.response.model'], 'gpt-4o-mini-2024-07-18');
	assert.equal(call.attributes['gen_ai.usage.input_tokens'], 210);
	assert.equal(call.attributes['gen_ai.usage.output_tokens'], 24);
	assert.equal(call.attributes['gen_ai.response.finish_reasons'], 'stop');
	assert.ok((call.attributes['betternet.input.chars'] as number) > 0);
	assert.equal(feature.attributes['betternet.analysis.path'], 'remote');

	// Prompts and completions stay in the browser.
	assert.ok(!JSON.stringify(spans).includes(CHUNKS[0].text), 'no prompt text in spans');
}

// A provider error fails the call span and marks the feature result as a fallback.
{
	const { posted } = stubFetch(() => openaiResponse(429));
	await resetAiqaTracingForTests();
	await configureAiqaTracing({ aiqaTracing: true, aiqaApiKey: API_KEY, aiqaServerUrl: SERVER });

	const trace = startSpan('betternet.analyze_page', {});
	await analyzeChunksParallel(
		[CHUNKS[0]] as any,
		{ url: 'https://example.com', domain: 'example.com' },
		{
			mode: 'openai',
			enabledFeatures: ['biasDetector'],
			llmClient: new OpenAILLMClient('sk-test', 'gpt-4o-mini'),
			trace,
		} as any
	);
	endSpan(trace);
	await flushAiqaSpans();

	const spans = posted.flatMap((p) => p.spans);
	const call = spans.find((s) => s.name === 'bias-detector.openai');
	const feature = spans.find((s) => s.name === 'betternet.feature.biasDetector');
	assert.equal(call.status?.code, 2, 'a provider error is an ERROR span');
	assert.equal(call.attributes['http.response.status_code'], 429);
	assert.equal(feature.attributes['betternet.analysis.path'], 'heuristic_fallback');
	assert.match(String(feature.attributes['betternet.analysis.fallback_reason']), /429/);
}

// A failed local inference is an error span too, not a silently OK one.
{
	const { posted } = stubFetch();
	await resetAiqaTracingForTests();
	await configureAiqaTracing({ aiqaTracing: true, aiqaApiKey: API_KEY, aiqaServerUrl: SERVER });

	const trace = startSpan('betternet.analyze_page', {});
	await analyzeChunksParallel(
		[CHUNKS[0]] as any,
		{ url: 'https://example.com', domain: 'example.com' },
		{
			mode: 'local',
			config: { localModelId: 'mobilebert-mnli' },
			enabledFeatures: ['biasDetector'],
			localBackend: {
				async zeroShot() {
					return { error: 'Not enough memory to load this model on-device' };
				},
				async generate() {
					throw new Error('generate should not be called');
				},
			},
			trace,
		} as any
	);
	endSpan(trace);
	await flushAiqaSpans();

	const spans = posted.flatMap((p) => p.spans);
	const model = spans.find((s) => s.name === 'local.zero_shot');
	const feature = spans.find((s) => s.name === 'betternet.feature.biasDetector');
	assert.equal(model.status?.code, 2, 'a failed local call is an ERROR span');
	assert.equal(feature.attributes['betternet.analysis.path'], 'heuristic_fallback');
	assert.match(String(feature.attributes['betternet.analysis.fallback_reason']), /memory/);
}

// The click-unbait destination fetch: status, size and outcome, never the response body.
{
	const { posted } = stubFetch();
	await resetAiqaTracingForTests();
	await configureAiqaTracing({ aiqaTracing: true, aiqaApiKey: API_KEY, aiqaServerUrl: SERVER });

	const SECRET = 'The council voted 7-2 to extend the festival licence.';
	const html = `<html><head><title>Council extends festival licence | The Post</title>
		<meta property="og:description" content="A short honest summary."></head>
		<body><nav>menu menu menu</nav><article><p>${SECRET.repeat(8)}</p></article></body></html>`;

	const okFetch = async () =>
		({
			ok: true,
			status: 200,
			statusText: 'OK',
			url: 'https://news.test/story',
			headers: { get: () => 'text/html; charset=utf-8' },
			async text() { return html; },
		}) as any;

	const PAGE = 'https://feed.test';

	async function traceFetch(url: string, fetchImpl: any) {
		resetDestinationCache();
		beginDestinationBudget(PAGE);
		const trace = startSpan('betternet.analyze_page', {});
		const result = await fetchDestinationText(url, { fetchImpl, trace, pageUrl: PAGE });
		endSpan(trace);
		await flushAiqaSpans();
		const spans = posted.flatMap((p) => p.spans);
		const span = spans.find((sp) => sp.name === 'click-unbait.fetch_destination');
		assert.ok(span, 'the destination fetch is traced');
		return { result, span, spans };
	}

	// A fetch that works.
	{
		const { result, span, spans } = await traceFetch('https://news.test/story', okFetch);
		const page = spans.find((sp) => sp.name === 'betternet.analyze_page');
		assert.equal(span.parent_span_id, page.id, 'the fetch hangs off the page span');
		assert.equal(span.attributes['betternet.destination.url'], 'https://news.test/story');
		assert.equal(span.attributes['http.response.status_code'], 200);
		assert.equal(span.attributes['betternet.destination.status_text'], 'OK');
		assert.equal(span.attributes['betternet.destination.content_type'], 'text/html; charset=utf-8');
		assert.equal(span.attributes['betternet.destination.outcome'], 'ok');
		assert.equal(span.attributes['betternet.destination.source'], 'article');
		assert.equal(span.attributes['betternet.destination.html_chars'], html.length);
		assert.equal(span.attributes['betternet.destination.text_chars'], result!.text.length);
		assert.equal(span.attributes['betternet.destination.fetch_index'], 1);

		// The page's own text must not ride along in a span attribute.
		assert.ok(!JSON.stringify(spans).includes(SECRET), 'no response body in spans');
	}

	// A cache hit never reaches the network, and says so.
	{
		posted.length = 0;
		beginDestinationBudget(PAGE);
		const trace = startSpan('betternet.analyze_page', {});
		await fetchDestinationText('https://news.test/story', {
			fetchImpl: (async () => {
				throw new Error('should not refetch');
			}) as any,
			trace,
			pageUrl: PAGE,
		});
		endSpan(trace);
		await flushAiqaSpans();
		const span = posted
			.flatMap((p) => p.spans)
			.find((sp) => sp.name === 'click-unbait.fetch_destination');
		assert.equal(span.attributes['betternet.destination.outcome'], 'cache_hit');
	}

	// A bot block: the code and its status message, and a null result.
	{
		posted.length = 0;
		const { result, span } = await traceFetch('https://news.test/blocked', async () =>
			({
				ok: false,
				status: 403,
				statusText: 'Forbidden',
				url: 'https://news.test/blocked',
				headers: { get: () => 'text/html' },
				async text() { return ''; },
			}) as any
		);
		assert.equal(result, null);
		assert.equal(span.attributes['http.response.status_code'], 403);
		assert.equal(span.attributes['betternet.destination.status_text'], 'Forbidden');
		assert.equal(span.attributes['betternet.destination.outcome'], 'http_error');
	}

	// A PDF is skipped before it is read.
	{
		posted.length = 0;
		const { span } = await traceFetch('https://news.test/report.pdf', async () =>
			({
				ok: true,
				status: 200,
				statusText: 'OK',
				url: 'https://news.test/report.pdf',
				headers: { get: () => 'application/pdf' },
				async text() { throw new Error('body should not be read'); },
			}) as any
		);
		assert.equal(span.attributes['betternet.destination.outcome'], 'unsupported_content_type');
	}

	// A network failure is a reason on an OK span, not an AIQA error.
	{
		posted.length = 0;
		const { span } = await traceFetch('https://news.test/down', async () => {
			throw new Error('net::ERR_CONNECTION_REFUSED');
		});
		assert.equal(span.status?.code ?? 0, 0, 'a quiet failure is not an ERROR span');
		assert.equal(span.attributes['betternet.destination.outcome'], 'error');
		assert.match(String(span.attributes['betternet.destination.error']), /CONNECTION_REFUSED/);
	}

	// Over the per-page allowance: no request, and the trace says why.
	{
		posted.length = 0;
		resetDestinationCache();
		beginDestinationBudget(PAGE, 0);
		const trace = startSpan('betternet.analyze_page', {});
		assert.equal(
			await fetchDestinationText('https://news.test/other', {
				fetchImpl: okFetch,
				trace,
				pageUrl: PAGE,
			}),
			null
		);
		endSpan(trace);
		await flushAiqaSpans();
		const span = posted
			.flatMap((p) => p.spans)
			.find((sp) => sp.name === 'click-unbait.fetch_destination');
		assert.equal(span.attributes['betternet.destination.outcome'], 'budget_exceeded');
	}

	resetDestinationCache();
}

// Analysis results carry their trace and span ids, so feedback can link back to them
// (specs/feedback.md), and feedback is mirrored onto the trace as a span AIQA shows.
{
	const { posted } = stubFetch();
	await resetAiqaTracingForTests();
	await configureAiqaTracing({ aiqaTracing: true, aiqaApiKey: API_KEY, aiqaServerUrl: SERVER });

	const trace = startSpan('betternet.analyze_page', {});
	const results = await analyzeChunksParallel(
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
	endSpan(trace);

	const traceId = results[0].traceId!;
	assert.match(traceId, /^[0-9a-f]{32}$/, 'the chunk analysis carries its trace id');
	assert.match(results[0].spanId!, /^[0-9a-f]{16}$/, 'and its chunk span id');
	assert.match(
		results[0].analyses[0].spanId!,
		/^[0-9a-f]{16}$/,
		'each aspect carries the span of its own feature call'
	);

	assert.equal(
		await mirrorFeedbackToAiqa(traceId, {
			thumbsUp: false,
			comment: 'aspect:biasDetector — This isn\'t biased',
			parentSpanId: results[0].analyses[0].spanId,
		}),
		true
	);
	await flushAiqaSpans();

	const feedback = posted.flatMap((p) => p.spans).find((s) => s.name === 'feedback');
	assert.ok(feedback, 'a feedback span is sent');
	assert.equal(feedback.trace_id, traceId, 'attached to the trace it is about');
	assert.equal(feedback.parent_span_id, results[0].analyses[0].spanId);
	assert.equal(feedback.attributes['feedback.value'], 'negative');
	assert.match(String(feedback.attributes['feedback.comment']), /biasDetector/);

	// A retraction has no thumb, and a malformed trace id is refused rather than guessed.
	assert.equal(await mirrorFeedbackToAiqa(traceId, {}), true);
	await flushAiqaSpans();
	const neutral = posted
		.flatMap((p) => p.spans)
		.filter((s) => s.name === 'feedback')
		.find((s) => s.attributes['feedback.value'] === 'neutral');
	assert.ok(neutral, 'a retracted vote is recorded as neutral');
	assert.equal(await mirrorFeedbackToAiqa('not-a-trace-id', { thumbsUp: true }), false);
}

// Feedback with tracing off is a no-op, not an error: bn-server still has the record.
{
	await resetAiqaTracingForTests();
	assert.equal(await mirrorFeedbackToAiqa('a'.repeat(32), { thumbsUp: true }), false);
	await configureAiqaTracing({ aiqaTracing: true, aiqaApiKey: API_KEY, aiqaServerUrl: SERVER });
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
