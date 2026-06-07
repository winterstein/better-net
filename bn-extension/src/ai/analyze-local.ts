/**
 * Shared local-model analysis for bias-detector, anti-manipulation, and defuse-ragebait.
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
	context: Record<string, unknown> & { text?: string };
	candidateLabels?: string[];
	multiLabel?: boolean;
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

			const primaryIdx = 0;
			const riskLabel = candidateLabels[0];
			const riskIdx = result.labels.indexOf(riskLabel);
			const score =
				riskIdx >= 0 ? (result.scores?.[riskIdx] ?? 0) : (result.scores?.[primaryIdx] ?? 0);

			const parsed = parseResponse(
				JSON.stringify({
					problemScore: Math.max(0, Math.min(1, score)),
					confidence: Math.max(0.5, Math.min(0.95, result.scores?.[primaryIdx] ?? 0.7)),
					flags: score > 0.45 ? [`local_${model.id}`] : [],
					explanation: buildZeroShotExplanation(model, result as { labels: string[]; scores?: number[] }, candidateLabels, score),
				})
			);
			parsed.explanation = parsed.explanation || buildZeroShotExplanation(model, result as { labels: string[]; scores?: number[] }, candidateLabels, score);
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
		const explanationText = typeof parsed.explanation === 'string' ? parsed.explanation : '';
		if (!explanationText.trim()) {
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

function buildZeroShotExplanation(
	model: { name: string },
	result: { labels: string[]; scores?: number[] },
	candidateLabels: string[],
	riskScore: number
) {
	const riskLabel = candidateLabels[0];
	const safeLabel = candidateLabels[1] ?? candidateLabels[candidateLabels.length - 1];
	const riskIdx = result.labels.indexOf(riskLabel);
	const riskConfidence = riskIdx >= 0 ? (result.scores?.[riskIdx] ?? 0) : 0;
	const riskPct = (riskConfidence * 100).toFixed(0);

	if (riskIdx >= 0 && riskScore > 0.45) {
		return `${model.name} flagged this as "${riskLabel}" (${riskPct}% confidence). The content may warrant a closer read.`;
	}

	const safeIdx = result.labels.indexOf(safeLabel);
	const safeConfidence = safeIdx >= 0 ? (result.scores?.[safeIdx] ?? 0) : (result.scores?.[0] ?? 0);
	const safePct = (safeConfidence * 100).toFixed(0);
	return `${model.name} classified this as "${safeLabel}" (${safePct}% confidence). No strong concern signals were detected.`;
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
