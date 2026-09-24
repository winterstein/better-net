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
	choices?: { message?: { content?: string }; finish_reason?: string }[];
	model?: string;
	usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type AnthropicMessageResponse = {
	content?: { text?: string }[];
	model?: string;
	stop_reason?: string;
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

function recordUsage(
	handle: TraceHandle | null,
	model: string | undefined,
	usage: TokenUsage,
	finishReason?: string
) {
	const attributes: Record<string, string | number> = {};
	if (model) attributes['gen_ai.response.model'] = model;
	if (usage.input != null) attributes['gen_ai.usage.input_tokens'] = usage.input;
	if (usage.output != null) attributes['gen_ai.usage.output_tokens'] = usage.output;
	if (finishReason) attributes['gen_ai.response.finish_reasons'] = finishReason;
	setAttributes(handle, attributes);
}

/**
 * Provider errors are the thing traces are most often opened for, so the status goes on
 * the span before it is failed — the message alone does not survive AIQA's grouping.
 */
function failedResponse(
	handle: TraceHandle | null,
	provider: string,
	response: { status: number; statusText: string }
): Error {
	setAttributes(handle, { 'http.response.status_code': response.status });
	return new Error(`${provider} API error: ${response.status} ${response.statusText}`);
}

/** Prompt size, so a slow call can be read against how much was sent. No prompt text. */
function promptChars(messages: LLMMessage[]): number {
	return messages.reduce((total, m) => total + (m.content?.length ?? 0), 0);
}

/** Remote LLM calls that never return should not hang analysis forever. */
const LLM_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export class OpenAILLMClient implements LLMClient {
	constructor(private apiKey: string, private defaultModel = 'gpt-4') {}

	async complete(messages: LLMMessage[], options: LLMCompleteOptions = {}): Promise<string> {
		return traceStep(
			options.traceName || 'openai.complete',
			{ parent: options.trace, attributes: genAiAttributes('openai', this.defaultModel, options) },
			async (span) => {
				setAttributes(span, { 'betternet.input.chars': promptChars(messages) });
				const response = await fetchWithTimeout(
					'https://api.openai.com/v1/chat/completions',
					{
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
					},
					LLM_TIMEOUT_MS
				);

				if (!response.ok) {
					throw failedResponse(span, 'OpenAI', response);
				}

				const data = (await response.json()) as OpenAIChatResponse;
				recordUsage(
					span,
					data.model,
					{ input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
					data.choices?.[0]?.finish_reason
				);
				const text = data.choices?.[0]?.message?.content?.trim() || '';
				setAttributes(span, { 'betternet.output.chars': text.length });
				return text;
			}
		);
	}
}

export class AnthropicLLMClient implements LLMClient {
	constructor(private apiKey: string, private defaultModel = 'claude-sonnet-4-5') {}

	async complete(messages: LLMMessage[], options: LLMCompleteOptions = {}): Promise<string> {
		return traceStep(
			options.traceName || 'anthropic.complete',
			{ parent: options.trace, attributes: genAiAttributes('anthropic', this.defaultModel, options) },
			async (span) => {
				setAttributes(span, { 'betternet.input.chars': promptChars(messages) });
				const system = messages.find((m) => m.role === 'system')?.content || '';
				const userParts = messages.filter((m) => m.role !== 'system').map((m) => m.content);
				const userContent = userParts.join('\n\n');

				const response = await fetchWithTimeout(
					'https://api.anthropic.com/v1/messages',
					{
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
					},
					LLM_TIMEOUT_MS
				);

				if (!response.ok) {
					throw failedResponse(span, 'Anthropic', response);
				}

				const data = (await response.json()) as AnthropicMessageResponse;
				recordUsage(
					span,
					data.model,
					{ input: data.usage?.input_tokens, output: data.usage?.output_tokens },
					data.stop_reason
				);
				const text = data.content?.[0]?.text?.trim() || '';
				setAttributes(span, { 'betternet.output.chars': text.length });
				return text;
			}
		);
	}
}

/**
 * The one place that knows provider names. Everything else asks `isRemoteProvider` or just
 * calls `createLLMClient` and checks for null — so adding a provider is one entry here plus
 * its client class, and no feature has to be edited. A feature that hard-codes
 * `mode === 'openai'` silently skips the new provider instead of failing, which is the worst
 * kind of regression to find.
 */
const PROVIDERS: Record<string, (config: LLMClientConfig) => LLMClient | null> = {
	openai: (config) => {
		const key = config.apiKey || config.openaiKey;
		return key ? new OpenAILLMClient(key, config.model) : null;
	},
	anthropic: (config) => {
		const key = config.apiKey || config.anthropicKey;
		return key ? new AnthropicLLMClient(key, config.model) : null;
	},
};

/** Is this mode served by a remote provider (as opposed to `local` / `heuristic`)? */
export function isRemoteProvider(mode: string): boolean {
	return Object.prototype.hasOwnProperty.call(PROVIDERS, mode);
}

/** Remote client for this mode, or null when the mode is not remote or has no API key. */
export function createLLMClient(
	mode: string,
	config: LLMClientConfig = {}
): LLMClient | null {
	return PROVIDERS[mode]?.(config) ?? null;
}
