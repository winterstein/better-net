/**
 * Shared orchestration for LLM-backed feature analyzers (bias, scams, toxicity).
 */

import { analyzeWithLocalLLM } from './analyze-local.js';
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

	const { mode = 'local', config = {}, llmClient, localBackend } = options;
	const context = buildContext(chunk, pageMetadata);

	if (mode === 'heuristic') {
		return heuristicFallback(context);
	}

	if (mode === 'local') {
		return analyzeWithLocalLLM({
			modelId: config.localModelId as string | undefined,
			systemPrompt: getPrompt(promptId),
			context,
			candidateLabels: zeroShotLabels,
			parseResponse: parseAIResponse,
			fallback: () => heuristicFallback(context),
			localBackend,
		});
	}

	const client = llmClient ?? createLLMClient(mode, config);
	if (!client) {
		return mockResults(context);
	}

	try {
		const text = await client.complete(
			[
				{ role: 'system', content: getPrompt(promptId) },
				{ role: 'user', content: formatContextForPrompt(context) },
			],
			{ traceName: `${promptId}.${mode}` }
		);
		return parseAIResponse(text);
	} catch (error) {
		console.error(`${promptId} ${mode} analysis error:`, error);
		return heuristicFallback(context);
	}
}
