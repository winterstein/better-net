/**
 * Shared local-model analysis for bias-detector, anti-manipulation, and defuse-ragebait.
 */

import { getLocalModel } from './model-catalog.js';
import { sendToOffscreen } from './local-inference-client.js';
import { logit } from '../utils/logger.js';

const MAX_TEXT_CHARS = 1200;

function truncate(text) {
  if (!text || text.length <= MAX_TEXT_CHARS) return text || '';
  return text.slice(0, MAX_TEXT_CHARS) + '…';
}

/**
 * @param {Object} params
 * @param {string} [params.modelId]
 * @param {string} [params.systemPrompt]
 * @param {Object} params.context
 * @param {string[]} [params.candidateLabels]
 * @param {boolean} [params.multiLabel]
 * @param {(text: string) => Object} params.parseResponse
 * @param {() => Object} params.fallback
 */
export async function analyzeWithLocalLLM({
  modelId,
  systemPrompt,
  context,
  candidateLabels,
  multiLabel = false,
  parseResponse,
  fallback,
}) {
  const model = getLocalModel(modelId);

  try {
    if (model.pipeline === 'zero-shot-classification' && candidateLabels?.length) {
      const result = await sendToOffscreen('ZERO_SHOT', {
        modelId: model.id,
        text: truncate(context.text),
        candidateLabels,
        multiLabel,
      });

      if (result?.error) throw new Error(result.error);
      if (!result?.labels?.length) throw new Error('Empty zero-shot result');

      const primaryIdx = 0;
      const riskLabel = candidateLabels?.[0];
      const riskIdx = result.labels.indexOf(riskLabel);
      const score =
        riskIdx >= 0 ? result.scores[riskIdx] : result.scores[primaryIdx];

      const parsed = parseResponse(
        JSON.stringify({
          score: Math.max(0, Math.min(1, score)),
          confidence: Math.max(0.5, Math.min(0.95, result.scores[primaryIdx] ?? 0.7)),
          flags: score > 0.45 ? [`local_${model.id}`] : [],
          explanation: `Local model (${model.name}): "${result.labels[primaryIdx]}" (${(result.scores[primaryIdx] * 100).toFixed(0)}% confidence).`,
        })
      );
      parsed.metadata = { ...(parsed.metadata || {}), localModel: model.id, method: 'zero-shot' };
      return parsed;
    }

    const userContent = formatContextForPrompt(context);
    const prompt = `${systemPrompt}\n\n${userContent}`;
    const result = await sendToOffscreen('GENERATE', {
      modelId: model.id,
      prompt,
      maxNewTokens: 256,
    });

    if (result?.error) throw new Error(result.error);
    const text = result?.text?.trim();
    if (!text) throw new Error('Empty generation');

    const parsed = parseResponse(text);
    parsed.metadata = { ...(parsed.metadata || {}), localModel: model.id, method: 'generate' };
    return parsed;
  } catch (err) {
    logit('warn', '[LOCAL_AI] Local analysis failed, using heuristics:', err.message);
    const fb = fallback();
    fb.metadata = { ...(fb.metadata || {}), localModelError: err.message };
    return fb;
  }
}

function formatContextForPrompt(context) {
  const lines = [];
  if (context.url) lines.push(`URL: ${context.url}`);
  if (context.domain) lines.push(`Domain: ${context.domain}`);
  if (context.title) lines.push(`Title: ${context.title}`);
  if (context.author) lines.push(`Author: ${context.author}`);
  if (context.links?.length) lines.push(`Links: ${context.links.slice(0, 5).join(', ')}`);
  lines.push('', 'Content:', context.text || '');
  return lines.join('\n');
}
