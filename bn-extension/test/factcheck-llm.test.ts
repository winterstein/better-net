/**
 * When Google has no published rating, Fact Checker asks the LLM (runFeatureAnalysis).
 * A published rating wins. A heuristic miss keeps the Google result.
 */

import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { analyzeChunk } from '../src/features/fact-checker/analyze-chunk.js';

const CLAIM = 'According to experts, the water supply is entirely safe to drink';
const TEXT = `${CLAIM}. Studies show that nobody has ever fact-checked this particular line.`;
const PAGE = { url: 'https://news.example/a', domain: 'news.example', title: 'Water' };

const originalFetch = globalThis.fetch;

function tagIds(tags: Array<string | { tag: string }> = []) {
	return tags.map((t) => (typeof t === 'string' ? t : t.tag));
}

function llmClient(body: unknown, calls: { n: number; user: string; system: string }) {
	return {
		async complete(messages: { role: string; content: string }[]) {
			calls.n += 1;
			calls.user = messages.find((m) => m.role === 'user')?.content ?? '';
			calls.system = messages.find((m) => m.role === 'system')?.content ?? '';
			return typeof body === 'string' ? body : JSON.stringify(body);
		},
	};
}

function stubFetch(matched: boolean) {
	globalThis.fetch = (async () => ({
		ok: true,
		status: 200,
		json: async () =>
			matched
				? {
						claims: [
							{
								text: CLAIM,
								claimant: 'A source',
								claimReview: [
									{
										publisher: { name: 'PolitiFact' },
										url: 'https://politifact.com/1',
										title: 'False',
										textualRating: 'False',
									},
								],
							},
						],
					}
				: {},
	})) as typeof fetch;
}

const calls = { n: 0, user: '', system: '' };

// No key: the model judges, and says which claim it used.
calls.n = 0;
const missed = await analyzeChunk({ text: TEXT }, PAGE, {
	config: {},
	llmClient: llmClient(
		{
			score: 0.92,
			confidence: 0.8,
			flags: ['the claim is a hoax'],
			explanation: 'The water-supply claim is a known hoax.',
		},
		calls
	),
});
assert.equal(calls.n, 1);
assert.match(calls.user, /water supply/);
assert.match(calls.system, /general knowledge/i);
assert.equal(missed.problemScore, 'high');
assert.deepEqual(tagIds(missed.tags), ['false-claim']);
assert.match(String(missed.explanation), /^General knowledge: The water-supply claim is a known hoax\./);
assert.equal(missed.metadata?.diagnostic, 'llm_general_knowledge');
assert.equal(missed.metadata?.googleDiagnostic, 'no_api_key');

// A published rating is the result. The model is not asked.
calls.n = 0;
stubFetch(true);
const published = await analyzeChunk({ text: TEXT }, PAGE, {
	config: { googleFactCheckKey: 'k' },
	llmClient: llmClient({ score: 0.1, explanation: 'should not be used' }, calls),
});
assert.equal(calls.n, 0, 'a published fact-check must not fall through to the LLM');
assert.ok(tagIds(published.tags).includes('false-claim'));
assert.notEqual(published.metadata?.diagnostic, 'llm_general_knowledge');

// Nothing matched: still list the claims, and take the model's verdict.
calls.n = 0;
stubFetch(false);
const none = await analyzeChunk({ text: TEXT }, PAGE, {
	config: { googleFactCheckKey: 'k' },
	llmClient: llmClient(
		{ score: 0.1, confidence: 0.6, explanation: 'The claims look consistent with the record.' },
		calls
	),
});
assert.equal(calls.n, 1);
assert.equal(none.problemScore, 'low');
assert.deepEqual(tagIds(none.tags), ['verified-claims']);
assert.equal(none.metadata?.factChecksFound, 0);
assert.equal((none.metadata?.factChecks as unknown[]).length, 2);
assert.match(String(none.explanation), /^General knowledge:/);

// No model: keep the Google "not configured" result rather than invent a verdict.
calls.n = 0;
const heuristic = await analyzeChunk({ text: TEXT }, PAGE, {
	mode: 'heuristic',
	config: {},
	llmClient: llmClient({ score: 0.9 }, calls),
});
assert.equal(calls.n, 0);
assert.equal(heuristic.metadata?.diagnostic, 'no_api_key');
assert.equal(heuristic.problemScore, 'low');

// Local zero-shot payload: the risk label's score is the problem score.
calls.n = 0;
const riskLabel = 'This text contains a false or highly misleading factual claim';
const zeroShot = await analyzeChunk({ text: TEXT }, PAGE, {
	config: {},
	llmClient: llmClient(
		{
			labels: [riskLabel, 'This text is factually accurate'],
			scores: [0.91, 0.09],
			candidateLabels: [riskLabel, 'This text is factually accurate'],
		},
		calls
	),
});
assert.equal(zeroShot.problemScore, 'high');
assert.deepEqual(tagIds(zeroShot.tags), ['false-claim']);

// Unparseable text still yields a score when the model wrote one.
const scored = await analyzeChunk({ text: TEXT }, PAGE, {
	config: {},
	llmClient: llmClient('not json. score: 0.85', calls),
});
assert.equal(scored.problemScore, 'high');
assert.deepEqual(tagIds(scored.tags), ['false-claim']);

// Exact product tag, including fringe-view.
const fringe = await analyzeChunk({ text: TEXT }, PAGE, {
	config: {},
	llmClient: llmClient({ score: 0.2, flags: ['fringe-view'], explanation: 'Moon-landing denial.' }, calls),
});
assert.deepEqual(tagIds(fringe.tags), ['fringe-view']);
assert.equal(fringe.problemScore, 'low');

// Too short to contain a claim: no model call.
calls.n = 0;
const short = await analyzeChunk({ text: 'Hi' }, PAGE, {
	config: {},
	llmClient: llmClient({ score: 0.9 }, calls),
});
assert.equal(calls.n, 0);
assert.equal(short.metadata?.diagnostic, 'insufficient_content');

globalThis.fetch = originalFetch;

// A low LLM verdict still shows as low risk. An unchecked Google miss stays blank.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://news.example/a' });
Object.assign(globalThis as any, {
	window: dom.window,
	document: dom.window.document,
	Node: dom.window.Node,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	HTMLSelectElement: dom.window.HTMLSelectElement,
	KeyboardEvent: dom.window.KeyboardEvent,
	chrome: { runtime: { sendMessage: async () => ({ ok: true }) }, storage: { sync: { get: async () => ({}) } } },
});
const { showContentAnalysisModal } = await import('../src/content/content-analysis-modal.js');

showContentAnalysisModal({
	fingerprint: 'fp-llm',
	url: 'https://news.example/a',
	analyses: [
		{
			id: 'fc-llm',
			methodName: 'factChecker',
			model: 'llm',
			problemScore: 'low',
			confidence: 0.6,
			tags: [{ tag: 'verified-claims', strength: 'low', confidence: 0.6 }],
			explanation: none.explanation,
			metadata: { moduleId: 'factChecker', ...(none.metadata as object) },
		} as any,
	],
});
const llmModal = dom.window.document.getElementById('betternet-detail-modal')!.textContent!;
assert.match(llmModal, /low risk/);
assert.match(llmModal, /General knowledge:/);

showContentAnalysisModal({
	fingerprint: 'fp-google',
	url: 'https://news.example/a',
	analyses: [
		{
			id: 'fc-google',
			methodName: 'factChecker',
			model: 'google',
			problemScore: 'low',
			confidence: 0.3,
			tags: [],
			explanation: 'Checked 2 claims against fact-check sources; none of them have been fact-checked.',
			metadata: {
				moduleId: 'factChecker',
				factChecks: [{ claim: CLAIM, status: 'unverified', factChecks: [] }],
				factChecksFound: 0,
				diagnostic: 'no_fact_checks_found',
			},
		} as any,
	],
});
const googleModal = dom.window.document.getElementById('betternet-detail-modal')!.textContent!;
assert.doesNotMatch(googleModal, /low risk/);

console.log('factcheck llm tests passed');
