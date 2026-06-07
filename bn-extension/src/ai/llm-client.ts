/**
 * Vendor-neutral LLM interface. OpenAI-shaped chat API; Anthropic adapter included.
 */

import { traceLLMCall } from './aiqa.js';

export type LLMMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface LLMCompleteOptions {
	model?: string;
	temperature?: number;
	maxTokens?: number;
	traceName?: string;
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

type OpenAIChatResponse = {
	choices?: { message?: { content?: string } }[];
};

type AnthropicMessageResponse = {
	content?: { text?: string }[];
};

export class OpenAILLMClient implements LLMClient {
	constructor(private apiKey: string, private defaultModel = 'gpt-4') {}

	async complete(messages: LLMMessage[], options: LLMCompleteOptions = {}): Promise<string> {
		const run = async () => {
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
			return data.choices?.[0]?.message?.content?.trim() || '';
		};

		return traceLLMCall(options.traceName || 'openai.complete', run);
	}
}

export class AnthropicLLMClient implements LLMClient {
	constructor(private apiKey: string, private defaultModel = 'claude-3-opus-20240229') {}

	async complete(messages: LLMMessage[], options: LLMCompleteOptions = {}): Promise<string> {
		const run = async () => {
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
			return data.content?.[0]?.text?.trim() || '';
		};

		return traceLLMCall(options.traceName || 'anthropic.complete', run);
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
