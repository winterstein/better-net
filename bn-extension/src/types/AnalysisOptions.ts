/**
 * Analysis options for configuring analyzers
 */
export interface AnalysisOptions {
	mode?: 'local' | 'openai' | 'anthropic';
	config?: {
		apiKey?: string;
		openaiKey?: string;
		anthropicKey?: string;
		googleFactCheckKey?: string;
		localModelId?: string;
		languageCode?: string;
		[key: string]: unknown;
	};
	maxConcurrency?: number;
	enabledAnalyzers?: string[];
}

