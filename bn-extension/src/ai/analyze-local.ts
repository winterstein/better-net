/**
 * Shared local-model runner. Does not invent scores/explanations — analyzers parse those.
 */

import { canClassify, getLocalModel } from './model-catalog.js';
import { getOffscreenLocalBackend } from './local-model-backend.js';
import type { LocalModelBackend, ZeroShotResult } from './local-model-backend.js';
import { traceStep, setAttributes, recordSteps } from '../tracing/tracer-hook.js';
import type { TraceHandle } from '../tracing/tracer-hook.js';
import { logit } from '../utils/logger.js';

const MAX_TEXT_CHARS = 1200;
const MAX_NEW_TOKENS = 256;

/** GenAI attributes for an on-device model call, so AIQA groups it with remote LLM spans. */
function localModelAttributes(modelId: string, pipeline: string) {
	return {
		'gen_ai.operation.name': pipeline,
		'gen_ai.system': 'local',
		'gen_ai.request.model': modelId,
	};
}

/**
 * Zero-shot verdict on the span: the top label and its score, so a trace shows what the
 * model decided. Labels are our own candidate strings, never page text.
 */
function recordZeroShotResult(span: TraceHandle | null, result: ZeroShotResult) {
	const top = result.labels?.[0];
	if (top === undefined) return;
	setAttributes(span, {
		'betternet.zero_shot.top_label': top,
		'betternet.zero_shot.top_score': result.scores?.[0] ?? 0,
	});
}

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
	/** Parent AIQA span; the model call becomes a child of it. */
	trace?: TraceHandle | null;
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
		trace,
	} = params;

	const model = getLocalModel(modelId);
	const backend =
		localBackend !== undefined ? localBackend : await getOffscreenLocalBackend();

	if (!backend) {
		logit('warn', '[LOCAL_AI] No local backend available, using heuristics');
		setAttributes(trace, { 'betternet.analysis.path': 'no_backend' });
		const fb = fallback();
		fb.metadata = { ...(fb.metadata as object || {}), localModelSkipped: 'no_backend' };
		return fb;
	}

	try {
		if (canClassify(model) && candidateLabels?.length) {
			const result = await traceStep(
				'local.zero_shot',
				{ parent: trace, attributes: localModelAttributes(model.id, 'zero-shot-classification') },
				async (span) => {
					setAttributes(span, { 'gen_ai.request.label_count': candidateLabels.length });
					const res = await backend.zeroShot({
						modelId: model.id,
						text: truncate(context.text || ''),
						candidateLabels,
						multiLabel,
					});
					// The span above also covers the port hops and any first-call model load;
					// these steps are what the model itself spent (see inference-worker.ts).
					recordSteps(res.traceSteps, span);
					recordZeroShotResult(span, res);
					// Thrown inside the span so a failed inference is a failed span in AIQA.
					if (res.error) throw new Error(res.error);
					if (!res.labels?.length) throw new Error('Empty zero-shot result');
					return res;
				}
			);

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
		const result = await traceStep(
			'local.generate',
			{ parent: trace, attributes: localModelAttributes(model.id, 'text2text-generation') },
			async (span) => {
				setAttributes(span, {
					'gen_ai.request.max_tokens': MAX_NEW_TOKENS,
					'betternet.input.chars': prompt.length,
				});
				const res = await backend.generate({
					modelId: model.id,
					prompt,
					maxNewTokens: MAX_NEW_TOKENS,
				});
				recordSteps(res.traceSteps, span);
				setAttributes(span, { 'betternet.output.chars': res?.text?.length ?? 0 });
				if (res.error) throw new Error(res.error);
				if (!res.text?.trim()) throw new Error('Empty generation');
				return res;
			}
		);

		const text = result.text!.trim();
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
		// The model span carries the error; this marks the result as a fallback.
		setAttributes(trace, {
			'betternet.analysis.path': 'heuristic_fallback',
			'betternet.analysis.fallback_reason': message,
		});
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
