/**
 * Analysis options for configuring analyzers
 */
export interface AnalysisOptions {
	mode?: 'local' | 'openai' | 'anthropic';
	config?: {
		openaiKey?: string;
		anthropicKey?: string;
		googleFactCheckKey?: string;
		languageCode?: string;
		[key: string]: unknown;
	};
	maxConcurrency?: number;
	enabledAnalyzers?: string[];
}

