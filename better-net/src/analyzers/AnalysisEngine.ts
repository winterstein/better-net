/**
 * Analysis Engine for BetterNet
 * Main entry point for page analysis - uses modular chunking and analyzer system
 */

import { extractStatements } from '../factcheck/extract-statements.js';
import { analyzeFactCheck } from './factcheck/factcheck.js';
import { analyzeBias } from './bias.js';
import { analyzeScams } from './scams.js';
import { analyzeToxicity } from './toxicity.js';
import { extractChunks } from '../chunking/chunking.js';
import { logit } from '../utils/logger.js';
import type { Chunk } from '../types/Chunk.js';
import type { Statement } from '../types/Statement.js';
import { AspectType } from '../types/AspectAnalysis.js';
import type { AspectAnalysis } from '../types/AspectAnalysis.js';
import type { ChunkAnalysis } from '../types/ChunkAnalysis.js';
import type { PageMetadata } from '../types/Page.js';
import type { AnalysisOptions } from '../types/AnalysisOptions.js';

type StatementAnalyzerFunction = (chunk: Partial<Chunk>, statement: Statement, options: AnalysisOptions) => Promise<AspectAnalysis>;
type ChunkAnalyzerFunction = (chunk: Partial<Chunk>, options: AnalysisOptions) => Promise<AspectAnalysis>;

interface Task {
	type: AspectType | "statements";
	promise: Promise<AspectAnalysis | Statement[]>;
}


export class AnalysisEngine {
	private mode: 'local' | 'openai' | 'anthropic';
	private config: Record<string, unknown>;
	private _enabledAnalyzers: AspectType[] | null;

	constructor(mode: 'local' | 'openai' | 'anthropic' = 'local', config: Record<string, unknown> = {}) {
		this.mode = mode;
		this.config = config;
		this._enabledAnalyzers = null;
	}

	private _getEnabledAnalyzers(options: Partial<AnalysisOptions> = {}): string[] {
		if (options.enabledAnalyzers !== undefined) {
			return options.enabledAnalyzers;
		}
		if (this._enabledAnalyzers !== null) {
			return this._enabledAnalyzers;
		}
		const envAnalyzers = process.env.BN_ANALYSIS_ENABLED_ANALYZERS;
		if (envAnalyzers !== undefined) {
			try {
				const parsed = JSON.parse(envAnalyzers);
				if (Array.isArray(parsed)) return parsed;
			} catch (e) {
				const error = e as Error;
				logit('warn', '[ANALYZE_CHUNK] Failed to parse BN_ANALYSIS_ENABLED_ANALYZERS:', error.message);
			}
		}
		return [AspectType.ACCURACY, AspectType.BIAS, AspectType.SCAMS, AspectType.TOXICITY];
	}

	setEnabledAnalyzers(analyzers: AspectType[]): void {
		if (!Array.isArray(analyzers)) {
			throw new Error('enabledAnalyzers must be an array');
		}
		this._enabledAnalyzers = analyzers;
	}

	async analyzeChunk(
		chunk: Partial<Chunk>,
		pageMetadata: Partial<PageMetadata> = {},
		options: Partial<AnalysisOptions> = {},
		onAnalysis?: (chunk: Partial<Chunk>, result: ChunkAnalysis) => void
	): Promise<ChunkAnalysis> {
		logit('log', '[ANALYZE_CHUNK] Starting, chunk:', chunk);
		const combinedResults: Partial<ChunkAnalysis> = {
			chunkId: chunk.id ? String(chunk.id) : chunk.fingerprint || '',
			analyses: []
		};
		const { mode = this.mode, config = this.config } = options;
		const enabledAnalyzers = this._getEnabledAnalyzers(options);

		const tasks: Task[] = [];
		// always extract statements first
		const statementsTask = {
			type: "statements",
			promise: extractStatements(chunk, { mode, config }).then((statements) => {
				combinedResults.statements = statements;
				return combinedResults;
			})
		} as Task;
		tasks.push(statementsTask);
		// chunk-level analyzers
		if (enabledAnalyzers.includes(AspectType.TOXICITY)) {
			tasks.push({
				type: AspectType.TOXICITY,
				promise: analyzeToxicity(chunk, { mode, config }).then((analysis) => {
					combinedResults.analyses!.push(analysis);
					return combinedResults;
				})
			} as Task);
		}
		if (enabledAnalyzers.includes(AspectType.CLICKBAIT)) {
			tasks.push({
				type: AspectType.CLICKBAIT,
				promise: statementsTask.promise.then((statements) => statements.map(statement => analyzeClickbait(chunk, statement, { mode, config })))
			} as Task);
		}
		// statement-level analyzers
		if (enabledAnalyzers.includes(AspectType.ACCURACY)) {
			tasks.push({
				type: AspectType.ACCURACY,
				promise: analyzeFactCheck(chunk, { mode, config })
			} as Task);
		}
		if (enabledAnalyzers.includes(AspectType.BIAS)) {
			tasks.push({



				const statementAnalyzers: Record<string, StatementAnalyzerFunction> = {
				accuracy: analyzeFactCheck as unknown as StatementAnalyzerFunction,
				bias: analyzeBias as unknown as StatementAnalyzerFunction
			};

			enabledAnalyzers.forEach((type: string) => {
				const analyzerType = type as AspectType;
				if (analyzers[analyzerType]) {
					tasks.push({
						type: analyzerType,
						promise: analyzers[analyzerType](chunk, pageMetadata as PageMetadata, { mode, config })
					});
				}
			});

			const _results = await Promise.allSettled(tasks.map(task => task.promise));

			if (onAnalysis) onAnalysis(chunk, combinedResults);
			return combinedResults;
		}

	async analyzeChunksParallel(
			chunks: Chunk[],
			pageMetadata: Partial<PageMetadata> = {},
			options: Partial<AnalysisOptions> = {},
			onAnalysis ?: (chunk: Chunk, result: ChunkAnalysis) => void
	): Promise < ChunkAnalysis[] > {
			const { maxConcurrency = 5, ...analysisOptions } = options;
			const results: ChunkAnalysis[] = [];

			for(let i = 0; i <chunks.length; i += maxConcurrency) {
			const batch = chunks.slice(i, i + maxConcurrency);
			const batchResults = await Promise.all(
				batch.map(chunk => this.analyzeChunk(chunk, pageMetadata, analysisOptions, onAnalysis))
			);
			results.push(...batchResults);
		}
		return results;
	}

	async analyzePage(
		htmlSource: string,
		pageMetadata: Partial<PageMetadata> = {},
		options: Partial<AnalysisOptions> & {
			chunkingOptions?: Record<string, unknown>;
			analysisOptions?: Partial<AnalysisOptions>;
		} = {},
		onAnalysis?: (chunk: Chunk, result: ChunkAnalysis) => void
	): Promise<ChunkAnalysis[]> {
		console.log('[BetterNet] [ANALYZE_PAGE] Starting, URL:', pageMetadata.url);

		const { chunkingOptions = {}, analysisOptions = {}, ...restOptions } = options;
		const chunks = await extractChunks(htmlSource, pageMetadata.url || '', chunkingOptions as unknown as Parameters<typeof extractChunks>[2]) as Chunk[];
		console.log('[BetterNet] [ANALYZE_PAGE] Extracted', chunks.length, 'chunks');

		if (chunks.length === 0) {
			return [];
		}

		const chunkResults: ChunkAnalysis[] = await this.analyzeChunksParallel(
			chunks,
			pageMetadata,
			{ ...analysisOptions, ...restOptions },
			onAnalysis
		);

		return chunkResults;
	}
}

let defaultInstance: AnalysisEngine | null = null;

/**
 * @returns The default analysis engine instance
 */
export function getDefaultAnalysisEngine(): AnalysisEngine {
	if (!defaultInstance) {
		defaultInstance = new AnalysisEngine();
	}
	return defaultInstance;
}
