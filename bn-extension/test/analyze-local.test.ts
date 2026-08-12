/**
 * Zero-shot → analyzer score/explanation: local runner passes raw labels through;
 * feature parseAIResponse owns problemScore + explanation.
 */

import assert from 'node:assert/strict';
import { analyzeWithLocalLLM } from '../src/ai/analyze-local.js';
import { problemScoreFromZeroShotPayload } from '../src/features/zero-shot-score.js';
import { analyzeChunk as analyzeBias } from '../src/features/bias-detector/analyze-chunk.js';

const LABELS = ['This text is politically biased', 'This text is objective'];

{
	const score = problemScoreFromZeroShotPayload({
		labels: ['This text is objective', 'This text is politically biased'],
		scores: [0.91, 0.09],
		candidateLabels: LABELS,
	});
	assert.equal(score, 0.09);
}

{
	const localBackend = {
		async zeroShot() {
			return {
				labels: ['This text is objective', 'This text is politically biased'],
				scores: [0.91, 0.09],
			};
		},
		async generate() {
			throw new Error('generate should not be called');
		},
	};

	const out = await analyzeWithLocalLLM({
		modelId: 'mobilebert-mnli',
		context: { text: 'Ticket prices rose at the festival.' },
		candidateLabels: LABELS,
		parseResponse: (text) => {
			const parsed = JSON.parse(text);
			assert.deepEqual(parsed.candidateLabels, LABELS);
			assert.ok(Array.isArray(parsed.labels));
			return {
				problemScore: 0.09,
				explanation: 'Content appears balanced and objective.',
			};
		},
		fallback: () => ({ problemScore: 0, explanation: 'fallback' }),
		localBackend,
	});

	assert.equal(out.problemScore, 0.09);
	assert.equal(out.explanation, 'Content appears balanced and objective.');
	assert.equal((out.metadata as { method?: string })?.method, 'zero-shot');
}

{
	const localBackend = {
		async zeroShot() {
			return {
				labels: ['This text is objective', 'This text is politically biased'],
				scores: [0.91, 0.09],
			};
		},
		async generate() {
			throw new Error('generate should not be called');
		},
	};

	const out = await analyzeBias(
		{ text: 'Ticket prices rose at the festival.' },
		{ url: 'https://example.com', title: 'Festivals' },
		{ mode: 'local', config: { localModelId: 'mobilebert-mnli' }, localBackend }
	);

	assert.ok(out.problemScore < 0.4);
	assert.match(String(out.explanation), /balanced and objective/i);
}

console.log('✅ analyze-local / zero-shot analyzer tests passed');
