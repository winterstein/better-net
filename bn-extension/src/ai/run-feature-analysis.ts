/**
 * Shared orchestration for LLM-backed feature analyzers (bias, scams, toxicity).
 */

import { analyzeWithLocalLLM } from './analyze-local.js';
import { setAttributes } from '../tracing/tracer-hook.js';
import { createLLMClient, type LLMClient } from './llm-client.js';
import { getPrompt } from './prompt-manager.js';
import type { LocalModelBackend } from './local-model-backend.js';
import type { AnalysisOptions } from '../types/AnalysisOptions.js';

export interface FeatureAnalysisParams {
	chunk: { text?: string; links?: { url: string }[] };
	pageMetadata: Record<string, unknown>;
	options?: Partial<AnalysisOptions> & { llmClient?: LLMClient; localBackend?: LocalModelBackend | null };
	promptId: string;
	zeroShotLabels: string[];
	buildContext: (chunk: FeatureAnalysisParams['chunk'], pageMetadata: Record<string, unknown>) => Record<string, unknown>;
	formatContextForPrompt: (context: Record<string, unknown>) => string;
	parseAIResponse: (text: string) => Record<string, unknown>;
	heuristicFallback: (context: Record<string, unknown>) => Record<string, unknown>;
	mockResults: (context: Record<string, unknown>) => Record<string, unknown>;
}

export async function runFeatureAnalysis(params: FeatureAnalysisParams) {
	const {
		chunk,
		pageMetadata,
		options = {},
		promptId,
		zeroShotLabels,
		buildContext,
		formatContextForPrompt,
		parseAIResponse,
		heuristicFallback,
		mockResults,
	} = params;

	const { mode = 'local', config = {}, llmClient, localBackend, trace } = options;
	const context = buildContext(chunk, pageMetadata);

	// Which path a feature took is otherwise invisible in a trace: a chunk that quietly
	// fell back to heuristics looks the same as one an LLM actually judged.
	setAttributes(trace, { 'betternet.analysis.mode': mode });

	if (mode === 'heuristic') {
		setAttributes(trace, { 'betternet.analysis.path': 'heuristic' });
		return heuristicFallback(context);
	}

	// An explicitly injected client wins over `mode`. The other order meant a caller that
	// supplied a client but left `mode` at its 'local' default had the client ignored.
	const client = llmClient ?? createLLMClient(mode, config);

	if (!client && mode === 'local') {
		setAttributes(trace, { 'betternet.analysis.path': 'local' });
		return analyzeWithLocalLLM({
			modelId: config.localModelId as string | undefined,
			systemPrompt: getPrompt(promptId),
			context,
			candidateLabels: zeroShotLabels,
			parseResponse: parseAIResponse,
			fallback: () => heuristicFallback(context),
			localBackend,
			trace,
		});
	}

	if (!client) {
		setAttributes(trace, { 'betternet.analysis.path': 'mock' });
		return mockResults(context);
	}

	try {
		const text = await client.complete(
			[
				{ role: 'system', content: getPrompt(promptId) },
				{ role: 'user', content: formatContextForPrompt(context) },
			],
			{ traceName: `${promptId}.${mode}`, trace }
		);
		setAttributes(trace, { 'betternet.analysis.path': 'remote' });
		return parseAIResponse(text);
	} catch (error) {
		console.error(`${promptId} ${mode} analysis error:`, error);
		// The call's own span carries the error; this says the feature result is a fallback.
		setAttributes(trace, {
			'betternet.analysis.path': 'heuristic_fallback',
			'betternet.analysis.fallback_reason': error instanceof Error ? error.message : String(error),
		});
		return heuristicFallback(context);
	}
}
