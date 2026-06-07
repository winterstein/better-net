/**
 * Server-side analysis defaults: heuristic fallback when no API keys; inject keys from env.
 */

import type { AnalysisOptions } from '../bn-extension-src/types/AnalysisOptions.js';

function envKey(name: string): string | undefined {
	const v = process.env[name]?.trim();
	return v || undefined;
}

function defaultServerMode(): AnalysisOptions['mode'] {
	if (envKey('BN_OPENAI_API_KEY')) return 'openai';
	if (envKey('BN_ANTHROPIC_API_KEY')) return 'anthropic';
	return 'heuristic';
}

/** Merge request options with server env config (no Chrome offscreen). */
export function buildServerAnalysisOptions(
	requestOptions: Partial<AnalysisOptions> = {}
): AnalysisOptions {
	const openaiKey = requestOptions.config?.openaiKey || envKey('BN_OPENAI_API_KEY');
	const anthropicKey = requestOptions.config?.anthropicKey || envKey('BN_ANTHROPIC_API_KEY');
	const googleFactCheckKey =
		requestOptions.config?.googleFactCheckKey || envKey('BN_GOOGLE_API_KEY');

	const mode = requestOptions.mode ?? defaultServerMode();
	const apiKey =
		requestOptions.config?.apiKey ||
		(mode === 'openai' ? openaiKey : mode === 'anthropic' ? anthropicKey : undefined);

	return {
		...requestOptions,
		mode,
		localBackend: null,
		config: {
			...requestOptions.config,
			openaiKey,
			anthropicKey,
			googleFactCheckKey,
			apiKey,
		},
	};
}
