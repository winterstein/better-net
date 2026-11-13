import type { LLMClient } from '../ai/llm-client.js';
import type { LocalModelBackend } from '../ai/local-model-backend.js';
import type { TraceHandle } from '../tracing/tracer-hook.js';
import { AISettings } from './AISettings.js';
import type { ModuleAnalysis } from './ModuleAnalysis.js';

/**
 * Analysis options for configuring analyzers
 */
export interface AnalysisOptions {
	// TODO refactor out into AIOptions (which can be reused for other LLM calls). AIOptions should cover which LLM to use, and per-provider settings of API keys, and per-model settings like token thresholds, etc. AnalysisOptions should be about analysis-specific options (e.g. which analyzers to run, which features to enable, etc.)
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
	/** Reuse a stored feature result. Absent means on. Settings -> Advanced. */
	useLocalCache?: boolean;
	/**
	 * Shared analysis for the page being analysed, or absent when sharing is off or the page
	 * is unsuitable (sharing/shared-analysis-client.ts). Read after a local cache miss.
	 */
	shared?: SharedAnalysis | null;
	/**
	 * Private content is analysed by local models only, never a remote provider.
	 * Absent means on. Settings -> AI Model.
	 */
	privateLocalOnly?: boolean;
	// TODO refactor to use this
	aiSettings?: AISettings;
}


/**
 * One page's shared analysis, as the engine sees it. Keys are the content cache keys
 * (analysis/cache-key.ts), the same ones the local cache uses.
 */
export interface SharedAnalysis {
	/** A result from the server, or undefined. `myModel` is the model the user would run: a result from a lower-ranked model is not returned. */
	get(featureId: string, chunkKey: string, myModel: string): Partial<ModuleAnalysis> | undefined;
	/** Queue a fresh result for upload at the end of the pass. */
	add(featureId: string, chunkKey: string, model: string, result: Partial<ModuleAnalysis>): void;
}
