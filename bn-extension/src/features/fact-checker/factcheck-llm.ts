/**
 * Fact Checker — general-knowledge fallback when no published fact-check matched.
 * Prompt: fact-checker.latest.default (prompts/prompt-text.ts).
 */

import { runFeatureAnalysis } from '../../ai/run-feature-analysis.js';
import {
	isZeroShotPayload,
	problemScoreFromZeroShotPayload,
} from '../zero-shot-score.js';
import { problemScoreFromFraction } from '../../types/Score.js';
import type { ModuleAnalysis } from '../../types/ModuleAnalysis.js';

const PROMPT_ID = 'fact-checker';

/** First label is the problem class (zero-shot-score.ts). */
const ZERO_SHOT_LABELS = [
	'This text contains a false or highly misleading factual claim',
	'This text is factually accurate',
];

const PRODUCT_TAGS = ['no-claims', 'verified-claims', 'false-claim', 'suspect-claim', 'fringe-view'];

/**
 * Ask the configured model whether the extracted claims hold up.
 * A heuristic or mock result is not a verdict — the caller keeps the Google result.
 */
export async function checkWithGeneralKnowledge(chunk, claims: string[], pageMetadata, options) {
	return runFeatureAnalysis({
		chunk,
		pageMetadata,
		options,
		promptId: PROMPT_ID,
		zeroShotLabels: ZERO_SHOT_LABELS,
		buildContext: (c, meta) => ({
			text: contextText(c.text || '', claims),
			url: meta.url || '',
			domain: meta.domain || '',
			title: meta.title || '',
		}),
		formatContextForPrompt,
		parseAIResponse: parseFactCheckResponse,
		heuristicFallback: heuristicFactCheck,
		mockResults: mockFactCheck,
	});
}

/** Keep the Google claim list; replace the verdict with the model's. */
export function mergeGeneralKnowledge(
	google: Partial<ModuleAnalysis>,
	llm: Partial<ModuleAnalysis>
): Partial<ModuleAnalysis> {
	const googleMeta = google.metadata ?? {};
	const explanation = prefixExplanation(llm.explanation) || google.explanation;
	return {
		problemScore: llm.problemScore ?? google.problemScore,
		confidence: llm.confidence ?? 0,
		tags: llm.tags ?? [],
		explanation,
		error: llm.error,
		metadata: {
			...googleMeta,
			...(llm.metadata ?? {}),
			diagnostic: 'llm_general_knowledge',
			factCheckSource: 'llm',
			googleDiagnostic: googleMeta.diagnostic,
			factChecks: googleMeta.factChecks ?? [],
			factChecksFound: googleMeta.factChecksFound ?? 0,
			claimsChecked: googleMeta.claimsChecked,
		},
	};
}

function contextText(text: string, claims: string[]): string {
	if (!claims.length) return text;
	const lines = claims.map((claim, i) => `${i + 1}. ${claim}`).join('\n');
	// Claims go first so a truncated local-model window still sees them.
	return `Claims:\n${lines}\n\nContent:\n${text}`;
}

function formatContextForPrompt(context) {
	return `URL: ${context.url || 'N/A'}
Domain: ${context.domain || 'N/A'}
Title: ${context.title || 'N/A'}

${context.text}`;
}

function parseFactCheckResponse(responseText: string) {
	try {
		const jsonMatch = responseText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			if (isZeroShotPayload(parsed)) {
				const fraction = problemScoreFromZeroShotPayload(parsed);
				const tags = tagsForFraction(fraction);
				return verdict(fraction, parsed.scores?.[0] ?? 0.7, tags, explanationFor(tags));
			}
			const fraction = clamp01(Number(parsed.problemScore ?? parsed.score ?? 0));
			const fromFlags = tagsFromFlags(parsed.flags ?? parsed.tags);
			const tags = fromFlags.length ? fromFlags : tagsForFraction(fraction);
			const explanation =
				typeof parsed.explanation === 'string' && parsed.explanation.trim()
					? parsed.explanation.trim()
					: explanationFor(tags);
			return verdict(fraction, Number(parsed.confidence ?? 0.7), tags, explanation);
		}
	} catch {
		// Unparseable model text falls through to the score regex.
	}

	const scoreMatch = responseText.match(/score[:\s]+([\d.]+)/i);
	const fraction = clamp01(scoreMatch ? parseFloat(scoreMatch[1]) : 0.5);
	const tags = tagsForFraction(fraction);
	return verdict(fraction, 0.5, tags, explanationFor(tags));
}

function verdict(fraction: number, confidence: number, tags: string[], explanation: string) {
	return {
		problemScore: problemScoreFromFraction(fraction),
		confidence: clamp01(confidence),
		tags,
		explanation,
		metadata: { diagnostic: 'llm_general_knowledge' },
	};
}

function tagsForFraction(fraction: number): string[] {
	if (fraction >= 0.7) return ['false-claim'];
	if (fraction >= 0.4) return ['suspect-claim'];
	return ['verified-claims'];
}

/** Map free-text flags onto product tags. Exact ids win; safe wording is left to the score. */
function tagsFromFlags(flags: unknown): string[] {
	if (!Array.isArray(flags)) return [];
	const tags = new Set<string>();
	for (const flag of flags) {
		const text = String(flag).toLowerCase().trim();
		if (PRODUCT_TAGS.includes(text)) {
			tags.add(text);
			continue;
		}
		if (/fringe|conspir/.test(text)) tags.add('fringe-view');
		else if (/false|fake|hoax/.test(text)) tags.add('false-claim');
		else if (/mislead|suspect|unverified|unlikely/.test(text)) tags.add('suspect-claim');
	}
	return [...tags];
}

function explanationFor(tags: string[]): string {
	if (tags.includes('false-claim')) return 'A claim here looks false or highly misleading.';
	if (tags.includes('fringe-view')) return 'A claim here looks like a fringe or conspiracy view.';
	if (tags.includes('suspect-claim')) return 'A claim here looks suspect and is not confirmed.';
	if (tags.includes('verified-claims')) return 'The claims look plausible.';
	return 'General-knowledge fact-check completed.';
}

function prefixExplanation(explanation: string | undefined): string | undefined {
	if (!explanation) return explanation;
	if (explanation.startsWith('General knowledge:')) return explanation;
	return `General knowledge: ${explanation}`;
}

function heuristicFactCheck() {
	return {
		problemScore: problemScoreFromFraction(0),
		confidence: 0,
		tags: [],
		metadata: { diagnostic: 'heuristic' },
		explanation: 'General-knowledge fact-check unavailable.',
	};
}

function mockFactCheck() {
	return {
		problemScore: 'medium' as const,
		confidence: 0.5,
		tags: ['suspect-claim'],
		metadata: { diagnostic: 'mock' },
		explanation: 'Mock general-knowledge fact-check',
	};
}

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(1, n));
}
