/**
 * Click Unbait — detect clickbait via shared analysis pathway, then unravel
 * destination links: `[honest summary] original title`.
 * Spec: specs/click-unbait/unravel/spec.md
 */

import { runFeatureAnalysis } from '../../ai/run-feature-analysis.js';
import { createLLMClient } from '../../ai/llm-client.js';
import { getPrompt } from '../../ai/prompt-manager.js';
import {
	isZeroShotPayload,
	problemScoreFromZeroShotPayload,
} from '../zero-shot-score.js';
import { fetchDestinationText } from './fetch-destination.js';
import { formatUnbaitTitle } from './format-unbait-title.js';

const PROMPT_ID = 'click-unbait';
const UNRAVEL_PROMPT_ID = 'click-unbait-unravel';

const ZERO_SHOT_LABELS = [
	'withholding information to force a click',
	'describing the article clearly',
];

/** Act on chunks at or above this clickbait problem score. */
export const CLICKBAIT_THRESHOLD = 0.4;

export async function analyzeChunk(chunk, pageMetadata: any = {}, options: any = {}) {
	const detection = await runFeatureAnalysis({
		chunk,
		pageMetadata,
		options,
		promptId: PROMPT_ID,
		zeroShotLabels: ZERO_SHOT_LABELS,
		buildContext: (c, meta) => ({
			text: c.text || '',
			title: (c as any).title || meta.title || '',
			links: normalizeLinks(c.links),
			url: meta.url || '',
			domain: meta.domain || '',
		}),
		formatContextForPrompt,
		parseAIResponse,
		heuristicFallback: analyzeWithHeuristics,
		mockResults: getMockResults,
	});

	if (!isClickbaitDetection(detection)) {
		return detection;
	}

	const flags = uniqueFlags([...(detection.flags || []), 'clickbait']);
	const originalTitle =
		String((chunk as any).title || '').trim() ||
		firstLinkText(chunk.links) ||
		firstLine(chunk.text || '');

	const destUrl = pickDestinationUrl(chunk.links, pageMetadata.url);
	if (!destUrl || !originalTitle) {
		return {
			...detection,
			flags,
			explanation: detection.explanation || 'Clickbait detected; no link to unravel.',
		};
	}

	const fetchFn = options.fetchDestination ?? fetchDestinationText;
	const dest = await fetchFn(destUrl);
	if (!dest) {
		return {
			...detection,
			flags,
			explanation: detection.explanation || 'Clickbait detected; destination fetch failed.',
			metadata: { destinationUrl: destUrl, originalTitle },
		};
	}

	const summary = await summarizeDestination(dest, originalTitle, options);
	if (!summary) {
		return {
			...detection,
			flags,
			explanation: detection.explanation || 'Clickbait detected; no summary available.',
			metadata: { destinationUrl: destUrl, originalTitle },
		};
	}

	const formatted = formatUnbaitTitle(summary, originalTitle);
	if (!formatted.rewritten) {
		return {
			...detection,
			flags,
			metadata: { destinationUrl: destUrl, originalTitle },
		};
	}

	return {
		...detection,
		flags: uniqueFlags([...flags, 'unbaited']),
		explanation: `Unbaited: ${summary}`,
		metadata: {
			destinationUrl: destUrl,
			originalTitle,
			honestSummary: summary,
			displayTitle: formatted.displayText,
			hoverTitle: formatted.hoverTitle,
		},
	};
}

export function isClickbaitDetection(detection: {
	problemScore?: number;
	flags?: string[];
}): boolean {
	if ((detection.flags || []).includes('clickbait')) return true;
	return (detection.problemScore ?? 0) >= CLICKBAIT_THRESHOLD;
}

export function pickDestinationUrl(
	links: unknown,
	pageUrl?: string
): string | null {
	const list = normalizeLinks(links);
	for (const link of list) {
		const resolved = resolveUrl(link.url, pageUrl);
		if (!resolved || !/^https?:/i.test(resolved)) continue;
		if (pageUrl && samePage(resolved, pageUrl)) continue;
		return resolved;
	}
	return null;
}

function normalizeLinks(links: unknown): { url: string; text: string }[] {
	if (!Array.isArray(links)) return [];
	return links
		.map((link) => {
			if (typeof link === 'string') {
				return { url: link, text: '' };
			}
			if (link && typeof link === 'object') {
				const url = String((link as any).url || (link as any).href || '');
				const text = String((link as any).text || '').trim();
				return { url, text };
			}
			return null;
		})
		.filter(Boolean) as { url: string; text: string }[];
}

function firstLinkText(links: unknown): string {
	const list = normalizeLinks(links);
	const withText = list.find((l) => l.text.length > 8);
	return withText?.text || '';
}

function firstLine(text: string): string {
	return text.split(/\n/)[0]?.replace(/\s+/g, ' ').trim().slice(0, 200) || '';
}

function resolveUrl(href: string, base?: string): string | null {
	if (!href || href.startsWith('javascript:') || href.startsWith('#')) return null;
	try {
		return new URL(href, base || undefined).href;
	} catch {
		return null;
	}
}

function samePage(a: string, b: string): boolean {
	try {
		const ua = new URL(a);
		const ub = new URL(b);
		return ua.origin === ub.origin && ua.pathname === ub.pathname;
	} catch {
		return false;
	}
}

function uniqueFlags(flags: string[]): string[] {
	return [...new Set(flags.filter(Boolean))];
}

function analyzeWithHeuristics(context) {
	const text = `${context.title || ''} ${context.text || ''}`.toLowerCase();
	let score = 0;
	const flags: string[] = [];

	const patterns: { re: RegExp; weight: number; flag: string }[] = [
		{ re: /you won'?t believe/i, weight: 0.45, flag: 'you_wont_believe' },
		{ re: /one weird trick/i, weight: 0.5, flag: 'one_weird_trick' },
		{ re: /the one thing (you'?re|you are) doing wrong/i, weight: 0.5, flag: 'the_one_thing' },
		{ re: /what happened next|what happens next/i, weight: 0.4, flag: 'what_happens_next' },
		{ re: /doctors hate|experts hate/i, weight: 0.45, flag: 'authority_hate' },
		{ re: /will (shock|blow your mind|amaze)/i, weight: 0.4, flag: 'shock_promise' },
		{ re: /this is why|here'?s why you/i, weight: 0.3, flag: 'heres_why' },
		{ re: /\d+\s+(reasons|ways|things|secrets|tips)\b/i, weight: 0.25, flag: 'listicle_tease' },
		{ re: /\b(gone wrong|goes viral|you need to see)\b/i, weight: 0.35, flag: 'viral_tease' },
		{ re: /\?$/, weight: 0.15, flag: 'question_headline' },
	];

	for (const { re, weight, flag } of patterns) {
		if (re.test(text)) {
			score += weight;
			flags.push(flag);
		}
	}

	// Withholding pronouns / vague referents in short headlines
	if (
		/\b(this|these|that)\b/i.test(context.title || '') &&
		(context.title || '').length < 80 &&
		flags.length > 0
	) {
		score += 0.1;
	}

	score = Math.min(score, 1);
	if (score >= CLICKBAIT_THRESHOLD && !flags.includes('clickbait')) {
		flags.push('clickbait');
	}

	return {
		problemScore: score,
		confidence: flags.length ? 0.65 : 0.5,
		flags,
		explanation:
			score >= CLICKBAIT_THRESHOLD
				? `Clickbait patterns: ${flags.filter((f) => f !== 'clickbait').join(', ') || 'sensational framing'}.`
				: 'Headline appears reasonably descriptive.',
	};
}

function formatContextForPrompt(context) {
	return `URL: ${context.url || 'N/A'}
Domain: ${context.domain || 'N/A'}
Title: ${context.title || 'N/A'}

Content:
${context.text}`;
}

function parseAIResponse(responseText) {
	try {
		const jsonMatch = responseText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			if (isZeroShotPayload(parsed)) {
				const problemScore = problemScoreFromZeroShotPayload(parsed);
				const flags = problemScore >= CLICKBAIT_THRESHOLD ? ['clickbait'] : [];
				return {
					problemScore,
					confidence: Math.max(0.5, Math.min(0.95, parsed.scores?.[0] ?? 0.7)),
					flags,
					explanation:
						problemScore >= CLICKBAIT_THRESHOLD
							? 'Headline looks like clickbait (withholding or sensational framing).'
							: 'Headline appears straightforward.',
				};
			}
			const problemScore = Math.max(
				0,
				Math.min(1, parsed.problemScore ?? parsed.score ?? 0)
			);
			const flags = parsed.flags || [];
			if (problemScore >= CLICKBAIT_THRESHOLD && !flags.includes('clickbait')) {
				flags.push('clickbait');
			}
			return {
				problemScore,
				confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
				flags,
				explanation: parsed.explanation || 'Analysis completed',
			};
		}
	} catch {
		// fall through
	}

	const scoreMatch = responseText.match(/score[:\s]+([\d.]+)/i);
	const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0.2;
	return {
		problemScore: Math.max(0, Math.min(1, score)),
		confidence: 0.5,
		flags: score >= CLICKBAIT_THRESHOLD ? ['clickbait'] : [],
		explanation: responseText.substring(0, 200),
	};
}

function getMockResults(context) {
	const title = String(context.title || context.text || '');
	const looksBait = /you won'?t believe|one thing|shock|weird trick/i.test(title);
	return {
		problemScore: looksBait ? 0.7 : 0.15,
		confidence: 0.75,
		flags: looksBait ? ['clickbait'] : [],
		explanation: 'Mock clickbait analysis',
	};
}

async function summarizeDestination(
	dest: { title: string; text: string },
	originalTitle: string,
	options: any
): Promise<string | null> {
	const { mode = 'local', config = {}, llmClient } = options;
	const client =
		llmClient ??
		(mode === 'openai' || mode === 'anthropic' ? createLLMClient(mode, config) : null);

	if (client) {
		try {
			const text = await client.complete(
				[
					{ role: 'system', content: getPrompt(UNRAVEL_PROMPT_ID) },
					{
						role: 'user',
						content: `Original headline: ${originalTitle}\n\nDestination title: ${dest.title}\n\nDestination excerpt:\n${dest.text.slice(0, 2500)}`,
					},
				],
				{ traceName: 'click-unbait.unravel' }
			);
			const summary = parseSummaryResponse(text);
			if (summary) return summary;
		} catch (err) {
			console.error('click-unbait unravel LLM error:', err);
		}
	}

	return heuristicSummary(dest, originalTitle);
}

function parseSummaryResponse(responseText: string): string | null {
	try {
		const jsonMatch = responseText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			const s = String(parsed.summary || parsed.honestSummary || '').trim();
			if (s) return cleanSummary(s);
		}
	} catch {
		// plain text
	}
	const line = responseText
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l && !l.startsWith('{'));
	return line ? cleanSummary(line) : null;
}

function cleanSummary(s: string): string {
	return s
		.replace(/^\[+|\]+$/g, '')
		.replace(/^["']|["']$/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60);
}

function heuristicSummary(
	dest: { title: string; text: string },
	originalTitle: string
): string | null {
	const title = dest.title.replace(/\s+/g, ' ').trim();
	if (title && title.toLowerCase() !== originalTitle.toLowerCase()) {
		// Shorten destination title into a bracket-friendly phrase
		const words = title.split(/\s+/).slice(0, 8);
		return words.join(' ').replace(/[|:].*$/, '').trim() || null;
	}
	const sentence = dest.text.split(/[.!?]/)[0]?.replace(/\s+/g, ' ').trim();
	if (sentence && sentence.length > 12) {
		return sentence.split(/\s+/).slice(0, 8).join(' ');
	}
	return null;
}
