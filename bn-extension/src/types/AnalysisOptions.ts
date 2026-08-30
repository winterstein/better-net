import type { LLMClient } from '../ai/llm-client.js';
import type { LocalModelBackend } from '../ai/local-model-backend.js';
import type { TraceHandle } from '../tracing/tracer-hook.js';

/**
 * Analysis options for configuring analyzers
 */
export interface AnalysisOptions {
	mode?: 'local' | 'openai' | 'anthropic' | 'heuristic';
	config?: {
		apiKey?: string;
		openaiKey?: string;
		anthropicKey?: string;
		googleFactCheckKey?: string;
		localModelId?: string;
		languageCode?: string;
		model?: string;
		[key: string]: unknown;
	};
	maxConcurrency?: number;
	/** Feature ids from features/registry (e.g. biasDetector). */
	enabledFeatures?: string[];
	/** @deprecated use enabledFeatures */
	enabledAnalyzers?: string[];
	/** Optional injected LLM client (server or tests). */
	llmClient?: LLMClient;
	/** Optional local model backend (extension offscreen). */
	localBackend?: LocalModelBackend | null;
	/** Parent AIQA span for this analysis; child spans hang off it (tracing/tracer-hook.ts). */
	trace?: TraceHandle | null;
}

