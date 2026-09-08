/**
 * Click Unbait — detect clickbait via shared analysis pathway, then unravel
 * destination links: `[honest summary] original title`.
 * Spec: specs/click-unbait/unravel/spec.md
 */

import { runFeatureAnalysis } from '../../ai/run-feature-analysis.js';
import { createLLMClient, isRemoteProvider } from '../../ai/llm-client.js';
import { getPrompt } from '../../ai/prompt-manager.js';
import {
	isZeroShotPayload,
	problemScoreFromZeroShotPayload,
} from '../zero-shot-score.js';
import { canGenerate, getLocalModel } from '../../ai/model-catalog.js';
import { getOffscreenLocalBackend } from '../../ai/local-model-backend.js';
import { traceStep, setAttributes, recordSteps } from '../../tracing/tracer-hook.js';
import { contentTokens, isFurnitureUrl, pickBestLink } from '../../chunking/headline-link.js';
import { fetchDestinationText } from './fetch-destination.js';
import type { DestinationContent } from './fetch-destination.js';
import type { ChunkLink } from '../../types/Chunk.js';
import { formatUnbaitTitle } from './format-unbait-title.js';
import { CLICKBAIT_THRESHOLD, describeSignals, namedSignals, scoreClickbait } from './clickbait-signals.js';

const PROMPT_ID = 'click-unbait';
const UNRAVEL_PROMPT_ID = 'click-unbait-unravel';

/** Re-exported so callers of this feature have one import, not two. */
export { CLICKBAIT_THRESHOLD };

/** Long enough to say something; short enough to sit in front of a headline. */
const MIN_SUMMARY_CHARS = 12;
const MAX_SUMMARY_CHARS = 70;

/** How much of the summary may be words the headline already used before it is an echo. */
const MAX_HEADLINE_OVERLAP = 0.6;

/** Article text sent to an on-device model. Small models degrade on longer inputs. */
const LOCAL_SUMMARY_CHARS = 1800;

/** Article text sent to a remote model, which can take more of it. */
const REMOTE_SUMMARY_CHARS = 2500;

/**
 * Headline this chunk is really about. The scorer reads a headline, not a page: on a feed
 * chunk the surrounding text is other stories.
 */
function headlineOf(chunk: any, pageMetadata: any = {}): string {
	return (
		String(chunk?.title || '').trim() ||
		String(chunk?.metadata?.heading || '').trim() ||
		firstLinkText(chunk?.links) ||
		firstLine(chunk?.text || '') ||
		String(pageMetadata?.title || '').trim()
	);
}

interface Detection {
	problemScore?: number | string;
	confidence?: number;
	tags?: Array<string | { tag: string; strength?: string; confidence?: number }>;
	explanation?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Detection. Deliberately *not* routed through the on-device model.
 *
 * Measured on real headlines, both local options are worse than the signal scorer here.
 * MobileBERT zero-shot with this feature's label pair is anti-correlated: it scored a plain
 * BBC headline ("Storm Eowyn: Thousands without power across Northern Ireland") at 0.52 and
 * Upworthy's "Harvard psychiatrist reveals 'the fastest way to change your life'" at 0.15.
 * FLAN-T5-Small, the shipped default, answers the JSON detection prompt by repeating the
 * headline back, which parses to the 0.2 default and never crosses the threshold. So local
 * and heuristic modes use `scoreClickbait`; the on-device model still earns its keep on the
 * summary, which is a task it can actually do.
 */
async function detectClickbait(
	chunk,
	pageMetadata: any,
	options: any,
	headline: string
): Promise<Detection> {
	const { mode = 'local', llmClient } = options;
	const useRemoteLLM = isRemoteProvider(mode) || !!llmClient;

	if (!useRemoteLLM) return analyzeWithHeuristics(headline);

	return runFeatureAnalysis({
		chunk,
		pageMetadata,
		options,
		promptId: PROMPT_ID,
		// Unused: this path is only reached for a remote client. Kept non-empty so the
		// shared signature stays honest about what a zero-shot caller would pass.
		zeroShotLabels: [],
		buildContext: (c, meta) => ({
			text: c.text || '',
			title: headline || (meta.title as string) || '',
			links: normalizeLinks(c.links),
			url: meta.url || '',
			domain: meta.domain || '',
		}),
		formatContextForPrompt,
		parseAIResponse: (text: string) => parseAIResponse(text, headline),
		heuristicFallback: () => analyzeWithHeuristics(headline),
		mockResults: () => analyzeWithHeuristics(headline),
	});
}

export async function analyzeChunk(chunk, pageMetadata: any = {}, options: any = {}) {
	const originalTitle = headlineOf(chunk, pageMetadata);
	const detection = await detectClickbait(chunk, pageMetadata, options, originalTitle);

	if (!isClickbaitDetection(detection)) {
		return detection;
	}

	const tags = uniqueTags([...(detection.tags || []), 'clickbait']);

	const destUrl = pickDestinationUrl(chunk, pageMetadata.url, originalTitle);
	if (!destUrl || !originalTitle) {
		return {
			...detection,
			tags,
			explanation: withReason(detection.explanation, 'no link on this chunk to unravel'),
		};
	}

	const fetchFn = options.fetchDestination ?? fetchDestinationText;
	const dest = await fetchFn(destUrl, { trace: options.trace, pageUrl: pageMetadata.url });
	if (!dest) {
		return {
			...detection,
			tags,
			explanation: withReason(detection.explanation, 'could not read the destination page'),
			metadata: { destinationUrl: destUrl, originalTitle },
		};
	}

	const summary = await summarizeDestination(dest, originalTitle, options);
	if (!summary) {
		return {
			...detection,
			tags,
			explanation: withReason(
				detection.explanation,
				'the destination gave nothing the headline had not already said'
			),
			metadata: { destinationUrl: destUrl, originalTitle },
		};
	}

	const formatted = formatUnbaitTitle(summary, originalTitle);
	if (!formatted.rewritten) {
		return {
			...detection,
			tags,
			metadata: { destinationUrl: destUrl, originalTitle },
		};
	}

	return {
		...detection,
		tags,
		explanation: `Unbaited: ${summary}`,
		metadata: {
			destinationUrl: destUrl,
			originalTitle,
			honestSummary: summary,
			displayTitle: formatted.displayText,
			hoverTitle: formatted.hoverTitle,
			unbaited: true,
		},
	};
}

export function isClickbaitDetection(detection: {
	problemScore?: number | string;
	tags?: Array<string | { tag: string }>;
}): boolean {
	const tags = detection.tags || [];
	const hasClickbait = tags.some((t) => (typeof t === 'string' ? t : t.tag) === 'clickbait');
	if (hasClickbait) return true;
	const score = typeof detection.problemScore === 'number' ? detection.problemScore : 0;
	return score >= CLICKBAIT_THRESHOLD;
}

/**
 * Where this headline actually goes.
 *
 * The chunker resolves this from the DOM where it can (`chunk.primaryLink`); the link list
 * is the fallback for chunkers that only collect one. Either way the link has to earn it by
 * matching the headline — the old "first http link in the chunk" rule fetched
 * `google.com/preferences` on a results page and the *next* card's story on a grid, then
 * prepended a confident summary of it. Returning null is the good outcome when unsure.
 */
export function pickDestinationUrl(
	chunk: { primaryLink?: { url?: string } | null; links?: unknown },
	pageUrl?: string,
	headline?: string
): string | null {
	const primary = usableDestination(chunk?.primaryLink?.url, pageUrl);
	if (primary) return primary;

	if (!headline) return null;
	const best = pickBestLink(normalizeLinks(chunk?.links), headline, pageUrl);
	return usableDestination(best?.url, pageUrl);
}

/** An absolute http(s) URL that is neither this page nor site furniture. */
function usableDestination(url: string | undefined, pageUrl?: string): string | null {
	if (!url) return null;
	const resolved = resolveUrl(url, pageUrl);
	if (!resolved || !/^https?:/i.test(resolved)) return null;
	if (pageUrl && samePage(resolved, pageUrl)) return null;
	if (isFurnitureUrl(resolved, pageUrl)) return null;
	return resolved;
}

function normalizeLinks(links: unknown): ChunkLink[] {
	if (!Array.isArray(links)) return [];
	return links
		.filter((link) => link && typeof link === 'object' && (link as ChunkLink).url)
		.map((link: ChunkLink) => ({
			url: String(link.url),
			text: String(link.text || '').trim(),
			label: String(link.label || '').trim(),
		}));
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

/** Detection reason plus why the unravel stopped — both matter when a label looks wrong. */
function withReason(explanation: string | undefined, reason: string): string {
	const base = explanation || 'Clickbait detected';
	return `${base.replace(/\.$/, '')}. Not rewritten: ${reason}.`;
}

function uniqueTags(tags: string[]): string[] {
	return [...new Set(tags.filter(Boolean))];
}

/**
 * Score a headline on curiosity-gap structure. See `clickbait-signals.ts` for why the old
 * catchphrase list ("you won't believe", "one weird trick") scored 0 on every headline on
 * upworthy.com and buzzfeed.com.
 */
function analyzeWithHeuristics(headline: string) {
	const { score, flags } = scoreClickbait(headline);
	const isBait = score >= CLICKBAIT_THRESHOLD;
	const named = namedSignals(flags);

	return {
		problemScore: score,
		confidence: named.length >= 2 ? 0.75 : named.length === 1 ? 0.6 : 0.5,
		// Product tag only; signal ids stay in metadata for diagnostics.
		tags: isBait ? ['clickbait'] : [],
		metadata: {
			signals: named,
			quizOutOfScope: flags.includes('quiz_out_of_scope') || undefined,
		},
		explanation: isBait
			? `Withholds the payoff: ${describeSignals(named)}.`
			: flags.includes('quiz_out_of_scope')
				? 'A quiz — there is no withheld answer on a destination page to reveal.'
				: 'Headline states what the story is about.',
	};
}

function formatContextForPrompt(context) {
	return `URL: ${context.url || 'N/A'}
Domain: ${context.domain || 'N/A'}
Title: ${context.title || 'N/A'}

Content:
${context.text}`;
}

function parseAIResponse(responseText: string, headline = '') {
	try {
		const jsonMatch = responseText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			if (isZeroShotPayload(parsed)) {
				const problemScore = problemScoreFromZeroShotPayload(parsed);
				const tags = problemScore >= CLICKBAIT_THRESHOLD ? ['clickbait'] : [];
				return {
					problemScore,
					confidence: Math.max(0.5, Math.min(0.95, parsed.scores?.[0] ?? 0.7)),
					tags,
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
			const tags = parsed.tags || parsed.flags || [];
			if (problemScore >= CLICKBAIT_THRESHOLD && !tags.includes('clickbait')) {
				tags.push('clickbait');
			}
			return {
				problemScore,
				confidence: Math.max(0, Math.min(1, parsed.confidence || 0.7)),
				tags: tags.filter((t: string) => t === 'clickbait'),
				explanation: parsed.explanation || 'Analysis completed',
			};
		}
	} catch {
		// fall through
	}

	const scoreMatch = responseText.match(/score[:\s]+([\d.]+)/i);
	if (!scoreMatch) {
		// Unparseable. A hardcoded 0.2 here silently answered "not clickbait" for every
		// model that cannot produce JSON, which is every small local one.
		return analyzeWithHeuristics(headline);
	}
	const score = Math.max(0, Math.min(1, parseFloat(scoreMatch[1])));
	return {
		problemScore: score,
		confidence: 0.5,
		tags: score >= CLICKBAIT_THRESHOLD ? ['clickbait'] : [],
		explanation: responseText.substring(0, 200),
	};
}

/**
 * A short honest line about what the destination actually says.
 *
 * Tiers, best first, each one a function that either produces a candidate or returns null;
 * every candidate goes through the same `acceptSummary` gate. The gate is the point. The
 * failure that made this feature actively misleading was not a missing model but an
 * unchecked one: with no LLM in local mode the old code fell back to the destination's
 * `<title>`, which is the same clickbait headline the site put on the link, so the page read
 * `[You won't believe what this doctor keeps] You won't believe what this doctor keeps on a
 * Post-it note`. The bait, twice, presented as the cure.
 *
 * Running them as a list rather than an if/else chain also means a tier that is unavailable
 * falls through to the next instead of skipping the rest: `mode: 'openai'` with no API key
 * used to jump straight past a perfectly good downloaded local model.
 */
type SummaryTier = (
	dest: DestinationContent,
	originalTitle: string,
	options: any
) => Promise<string | null> | string | null;

async function summarizeDestination(
	dest: DestinationContent,
	originalTitle: string,
	options: any
): Promise<string | null> {
	const tiers = [summarizeWithRemoteLLM, summarizeWithLocalModel, summarizeFromPage];

	for (const tier of tiers) {
		const candidate = await tier(dest, originalTitle, options);
		const accepted = acceptSummary(candidate, originalTitle);
		if (accepted) return accepted;
	}
	return null;
}

const summarizeWithRemoteLLM: SummaryTier = async (dest, originalTitle, options) => {
	const { mode = 'local', config = {}, llmClient, trace } = options;
	const client = llmClient ?? createLLMClient(mode, config);
	if (!client) return null;

	try {
		const text = await client.complete(
			[
				{ role: 'system', content: getPrompt(UNRAVEL_PROMPT_ID) },
				{
					role: 'user',
					content: `Original headline: ${originalTitle}\n\nDestination title: ${dest.title}\n\nDestination excerpt:\n${dest.text.slice(0, REMOTE_SUMMARY_CHARS)}`,
				},
			],
			{ traceName: 'click-unbait.unravel', trace }
		);
		return parseSummaryResponse(text);
	} catch (err) {
		console.error('click-unbait unravel LLM error:', err);
		return null;
	}
};

/**
 * On-device summary. The small FLAN-T5 models cannot follow the JSON unravel prompt — asked
 * for one they return the headline back — but they do handle a plain "summarise this" and
 * then pull a real sentence out of the article, so that is what we ask for.
 */
const summarizeWithLocalModel: SummaryTier = async (dest, originalTitle, options) => {
	const { config = {}, localBackend } = options;
	const backend =
		localBackend !== undefined ? localBackend : await getOffscreenLocalBackend();
	if (!backend?.generate) return null;

	const model = getLocalModel(config.localModelId as string | undefined);
	if (!canGenerate(model)) return null;

	const body = [dest.description, dest.text]
		.filter(Boolean)
		.join(' ')
		.slice(0, LOCAL_SUMMARY_CHARS);
	if (!body) return null;

	try {
		const result = (await traceStep(
			'local.generate',
			{
				parent: options.trace,
				attributes: {
					'gen_ai.operation.name': model.pipeline,
					'gen_ai.system': 'local',
					'gen_ai.request.model': model.id,
					'betternet.step': 'click-unbait.unravel',
				},
			},
			async (span) => {
				const res = await backend.generate({
					modelId: model.id,
					prompt: `Summarize the following article in one short sentence.\n\n${body}`,
					maxNewTokens: 48,
				});
				// Load + inference as the worker timed them (see inference-worker.ts).
				recordSteps(res?.traceSteps, span);
				setAttributes(span, { 'betternet.output.chars': res?.text?.length ?? 0 });
				return res;
			}
		)) as { text?: string; error?: string } | undefined;
		return result?.error ? null : result?.text || null;
	} catch (err) {
		console.error('click-unbait local unravel error:', err);
		return null;
	}
};

/**
 * No model available. The destination's own `og:description` is the publisher's honest
 * one-liner about the story, which is exactly the job — and unlike `<title>`, it is not the
 * clickbait headline again. Failing that, the first sentence that is not an echo.
 */
const summarizeFromPage: SummaryTier = (dest, originalTitle) =>
	[dest.description, ...splitSentences(dest.text)].find((candidate) =>
		acceptSummary(candidate, originalTitle)
	) ?? null;

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
	const flat = stripWrappingQuotes(
		String(s || '')
			.replace(/^\[+|\]+$/g, '')
			.replace(/\s+/g, ' ')
			.trim()
	).replace(/[.,;:]+$/, '');

	if (flat.length <= MAX_SUMMARY_CHARS) return balanceQuotes(flat);

	// Cut at a word break: a summary ending mid-word is its own little curiosity gap.
	const cut = flat.slice(0, MAX_SUMMARY_CHARS);
	const lastSpace = cut.lastIndexOf(' ');
	const kept = lastSpace > MAX_SUMMARY_CHARS / 2 ? cut.slice(0, lastSpace) : cut;
	return balanceQuotes(kept.replace(TRAILING_PUNCTUATION, '')) + '\u2026';
}

const TRAILING_PUNCTUATION = /[\s,;:.\u2013\u2014-]+$/;

/** Quotation marks a model wrapped the whole summary in. Only a matched pair is stripped:
 *  taking one end off `She called it "the best day of her life"` leaves the other dangling. */
const QUOTE_PAIRS: [string, string][] = [
	['"', '"'],
	["'", "'"],
	['\u201c', '\u201d'],
	['\u2018', '\u2019'],
];

function stripWrappingQuotes(text: string): string {
	for (const [open, close] of QUOTE_PAIRS) {
		if (text.length > 2 && text.startsWith(open) && text.endsWith(close)) {
			return text.slice(1, -1).trim();
		}
	}
	return text;
}

/**
 * Drop a quotation the summary opens and never closes — `the "full American experience`.
 * A publisher's `og:description` arrives that way often enough on its own, so this runs on
 * every summary, not just truncated ones.
 *
 * Counted per quote character rather than as open/close pairs: a straight `"` is both, so
 * matching it against an "opening" and a "closing" pattern counts one quote twice and calls
 * the dangling case balanced.
 */
function balanceQuotes(text: string): string {
	const straightUnclosed = (text.match(/"/g) || []).length % 2 === 1;
	const curlyUnclosed =
		(text.match(/\u201c/g) || []).length > (text.match(/\u201d/g) || []).length;
	if (!straightUnclosed && !curlyUnclosed) return text;

	const lastOpen = Math.max(text.lastIndexOf('"'), text.lastIndexOf('\u201c'));
	if (lastOpen < 0) return text;
	// Opened at the very start: drop the mark and keep the sentence, rather than cut to
	// nothing and throw away a usable summary.
	if (lastOpen === 0) return text.slice(1).trim();
	return text.slice(0, lastOpen).replace(TRAILING_PUNCTUATION, '');
}

/**
 * A summary is only worth showing if it says something the headline did not. Reject the
 * empty, the too-short, and above all the echo — repeating the bait inside the brackets is
 * worse than leaving the headline alone, because it looks like the feature worked.
 */
export function acceptSummary(summary: string | null, originalTitle: string): string | null {
	const text = cleanSummary(summary || '');
	if (text.length < MIN_SUMMARY_CHARS) return null;
	if (echoesHeadline(text, originalTitle)) return null;
	return text;
}

/** Share of the summary's own content words that the headline already used. */
export function echoesHeadline(summary: string, originalTitle: string): boolean {
	const summaryTokens = contentTokens(summary);
	if (!summaryTokens.size) return true;
	const headlineTokens = contentTokens(originalTitle);
	if (!headlineTokens.size) return false;

	let shared = 0;
	for (const token of summaryTokens) if (headlineTokens.has(token)) shared += 1;
	return shared / summaryTokens.size >= MAX_HEADLINE_OVERLAP;
}

function splitSentences(text: string): string[] {
	return String(text || '')
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter((s) => s.length >= MIN_SUMMARY_CHARS)
		.slice(0, 6);
}
