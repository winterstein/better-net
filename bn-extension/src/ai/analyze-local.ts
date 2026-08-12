/**
 * Shared local-model runner. Does not invent scores/explanations — analyzers parse those.
 */

import { getLocalModel } from './model-catalog.js';
import { getOffscreenLocalBackend } from './local-model-backend.js';
import type { LocalModelBackend } from './local-model-backend.js';
import { logit } from '../utils/logger.js';

const MAX_TEXT_CHARS = 1200;

function truncate(text: string) {
	if (!text || text.length <= MAX_TEXT_CHARS) return text || '';
	return text.slice(0, MAX_TEXT_CHARS) + '…';
}

export interface AnalyzeWithLocalLLMParams {
	modelId?: string;
	systemPrompt?: string;
	context: Record<string, unknown> & { text?: string; title?: string };
	candidateLabels?: string[];
	multiLabel?: boolean;
	/** Analyzer: turn model text (or zero-shot JSON) into problemScore + explanation */
	parseResponse: (text: string) => Record<string, unknown>;
	fallback: () => Record<string, unknown>;
	localBackend?: LocalModelBackend | null;
}

/**
 * Run local zero-shot or generative analysis. Falls back to heuristics when no backend.
 */
export async function analyzeWithLocalLLM(params: AnalyzeWithLocalLLMParams) {
	const {
		modelId,
		systemPrompt,
		context,
		candidateLabels,
		multiLabel = false,
		parseResponse,
		fallback,
		localBackend,
	} = params;

	const model = getLocalModel(modelId);
	const backend =
		localBackend !== undefined ? localBackend : await getOffscreenLocalBackend();

	if (!backend) {
		logit('warn', '[LOCAL_AI] No local backend available, using heuristics');
		const fb = fallback();
		fb.metadata = { ...(fb.metadata as object || {}), localModelSkipped: 'no_backend' };
		return fb;
	}

	try {
		if (model.pipeline === 'zero-shot-classification' && candidateLabels?.length) {
			const result = await backend.zeroShot({
				modelId: model.id,
				text: truncate(context.text || ''),
				candidateLabels,
				multiLabel,
			});

			if (result?.error) throw new Error(result.error);
			if (!result?.labels?.length) throw new Error('Empty zero-shot result');

			const parsed = parseResponse(
				JSON.stringify({
					labels: result.labels,
					scores: result.scores,
					candidateLabels,
				})
			);
			parsed.metadata = { ...(parsed.metadata as object || {}), localModel: model.id, method: 'zero-shot' };
			return parsed;
		}

		const userContent = formatContextForPrompt(context);
		const prompt = `${systemPrompt}\n\n${userContent}`;
		const result = await backend.generate({
			modelId: model.id,
			prompt,
			maxNewTokens: 256,
		});

		if (result?.error) throw new Error(result.error);
		const text = result?.text?.trim();
		if (!text) throw new Error('Empty generation');

		const parsed = parseResponse(text);
		const explanationText = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '';
		if (!explanationText) {
			parsed.explanation = summarizeGeneratedResponse(text, parsed.problemScore ?? parsed.score);
		}
		parsed.metadata = { ...(parsed.metadata as object || {}), localModel: model.id, method: 'generate' };
		return parsed;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logit('warn', '[LOCAL_AI] Local analysis failed, using heuristics:', message);
		const fb = fallback();
		fb.metadata = { ...(fb.metadata as object || {}), localModelError: message };
		return fb;
	}
}

function summarizeGeneratedResponse(text: string, score: unknown) {
	const trimmed = text.trim();
	if (trimmed.length > 0) return trimmed.slice(0, 280);
	const pct = typeof score === 'number' ? (score * 100).toFixed(0) : '?';
	return `Local model analysis complete (risk score ${pct}%).`;
}

function formatContextForPrompt(context: Record<string, unknown>) {
	const lines: string[] = [];
	if (context.url) lines.push(`URL: ${context.url}`);
	if (context.domain) lines.push(`Domain: ${context.domain}`);
	if (context.title) lines.push(`Title: ${context.title}`);
	if (context.author) lines.push(`Author: ${context.author}`);
	if (Array.isArray(context.links) && context.links.length) {
		lines.push(`Links: ${context.links.slice(0, 5).join(', ')}`);
	}
	lines.push('', 'Content:', String(context.text || ''));
	return lines.join('\n');
}
