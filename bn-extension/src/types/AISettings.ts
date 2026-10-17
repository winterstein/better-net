
// TODO refactor to use this.
// Callers of LLMs should be able to convert an AIOptions into a client (LLMClient) and call that.
// Callers should not have to manage any model or provider specific details.

// The settings system should support listing providers and models

export interface AISettings {
    provider: AIProvider,
    modelOptions: AIModelSettings
}

/** e.g. Anthropic vs local (which means in-browser) */
export interface AIProvider {
    name: 'local' | 'openai' | 'anthropic' | 'heuristic' | 'custom' | string;
    apiKey?: string;
    modelIds?: string[];
    /** The base url for the endpoint. Standard sub-paths like "/chat" can be added */
    endpoint?: string;
    /** What schema does this API use? e.g. openai */
    apiSchema?: string;
}

export interface AIModelSettings {
    modelId: string;
    /** allow extra parameters */
    [key: string]: unknown;
    maxContextTokens?: number;
    maxOutputTokens?: number;
    maxConcurrency?: number;
}

export function aiSettingsFromGlobalSettings(settings) : AISettings {
    // custom or OpenAI?
    console.log("aiSettingsFromGlobalSettings","TODO convert properly",settings);
    return {
        provider: {
				name: 'Custom Endpoint',
				endpoint: settings.customModelEndpoint,
				apiKey: settings.customModelApiKey
			},
			modelOptions: {
				modelId: settings.customModelId
			}
        };
}