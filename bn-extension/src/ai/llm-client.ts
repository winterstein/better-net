/**
 * Vendor-neutral LLM interface. OpenAI-shaped chat API; Anthropic adapter included.
 *
 * Each call is traced as a span via tracing/tracer-hook.ts, using OpenTelemetry GenAI
 * attribute names so AIQA reports model, provider and token usage. Attributes are only
 * read from the response, so an untraced run behaves identically.
 */

import { traceStep, setAttributes } from '../tracing/tracer-hook.js';
import type { TraceHandle } from '../tracing/tracer-hook.js';

export type LLMMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface LLMCompleteOptions {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	traceName?: string;
	/** Parent AIQA span; the call becomes a child of it. */
	trace?: TraceHandle | null;
}

export interface LLMClient {
	complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<string>;
}

export interface LLMClientConfig {
	apiKey?: string;
	openaiKey?: string;
	anthropicKey?: string;
	model?: string;
}

type TokenUsage = { input?: number; output?: number };

type OpenAIChatResponse = {
	choices?: { message?: { content?: string } }[];
	model?: string;
	usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type AnthropicMessageResponse = {
	content?: { text?: string }[];
	model?: string;
	usage?: { input_tokens?: number; output_tokens?: number };
};

/** OpenTelemetry GenAI semantic-convention attributes, as read by AIQA. */
function genAiAttributes(provider: string, model: string, options: LLMCompleteOptions) {
	return {
		'gen_ai.operation.name': 'chat',
		'gen_ai.system': provider,
		'gen_ai.request.model': options.model || model,
		'gen_ai.request.temperature': options.temperature ?? 0.3,
		'gen_ai.request.max_tokens': options.maxTokens ?? 1024,
	};
}

function recordUsage(handle: TraceHandle | null, model: string | undefined, usage: TokenUsage) {
	const attributes: Record<string, string | number> = {};
	if (model) attributes['gen_ai.response.model'] = model;
	if (usage.input != null) attributes['gen_ai.usage.input_tokens'] = usage.input;
	if (usage.output != null) attributes['gen_ai.usage.output_tokens'] = usage.output;
	setAttributes(handle, attributes);
}

export class OpenAILLMClient implements LLMClient {
	constructor(private apiKey: string, private defaultModel = 'gpt-4') {}

	async complete(messages: LLMMessage[], options: LLMCompleteOptions = {}): Promise<string> {
		return traceStep(
			options.traceName || 'openai.complete',
			{ parent: options.trace, attributes: genAiAttributes('openai', this.defaultModel, options) },
			async (span) => {
				const response = await fetch('https://api.openai.com/v1/chat/completions', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: options.model || this.defaultModel,
						messages,
						temperature: options.temperature ?? 0.3,
						max_tokens: options.maxTokens ?? 1024,
					}),
				});

				if (!response.ok) {
					throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
				}

				const data = (await response.json()) as OpenAIChatResponse;
				recordUsage(span, data.model, {
					input: data.usage?.prompt_tokens,
					output: data.usage?.completion_tokens,
				});
				return data.choices?.[0]?.message?.content?.trim() || '';
			}
		);
	}
}

export class AnthropicLLMClient implements LLMClient {
	constructor(private apiKey: string, private defaultModel = 'claude-3-opus-20240229') {}

	async complete(messages: LLMMessage[], options: LLMCompleteOptions = {}): Promise<string> {
		return traceStep(
			options.traceName || 'anthropic.complete',
			{ parent: options.trace, attributes: genAiAttributes('anthropic', this.defaultModel, options) },
			async (span) => {
				const system = messages.find((m) => m.role === 'system')?.content || '';
				const userParts = messages.filter((m) => m.role !== 'system').map((m) => m.content);
				const userContent = userParts.join('\n\n');

				const response = await fetch('https://api.anthropic.com/v1/messages', {
					method: 'POST',
					headers: {
						'x-api-key': this.apiKey,
						'anthropic-version': '2023-06-01',
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: options.model || this.defaultModel,
						max_tokens: options.maxTokens ?? 1024,
						system: system || undefined,
						messages: [{ role: 'user', content: userContent }],
					}),
				});

				if (!response.ok) {
					throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
				}

				const data = (await response.json()) as AnthropicMessageResponse;
				recordUsage(span, data.model, {
					input: data.usage?.input_tokens,
					output: data.usage?.output_tokens,
				});
				return data.content?.[0]?.text?.trim() || '';
			}
		);
	}
}

export function createLLMClient(
	mode: string,
	config: LLMClientConfig = {}
): LLMClient | null {
	if (mode === 'openai') {
		const key = config.apiKey || config.openaiKey;
		return key ? new OpenAILLMClient(key, config.model) : null;
	}
	if (mode === 'anthropic') {
		const key = config.apiKey || config.anthropicKey;
		return key ? new AnthropicLLMClient(key, config.model) : null;
	}
	return null;
}
