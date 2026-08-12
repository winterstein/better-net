/**
 * Unit tests for click-unbait unravel (format + gate + analyze with mocks).
 */

import assert from 'node:assert/strict';
import { formatUnbaitTitle } from '../src/features/click-unbait/format-unbait-title.js';
import {
	analyzeChunk,
	isClickbaitDetection,
	pickDestinationUrl,
	CLICKBAIT_THRESHOLD,
} from '../src/features/click-unbait/analyze-chunk.js';
import { extractTextFromHtml } from '../src/features/click-unbait/fetch-destination.js';
import { applyClickUnbaitRewrite } from '../src/content/apply-click-unbait.js';
import { completeAspectAnalysis } from '../src/types/AspectAnalysis.js';
import { Window } from 'happy-dom';

// --- formatUnbaitTitle ---

const normal = formatUnbaitTitle(
	'Try a healthy breakfast',
	"The One Thing You're Doing Wrong Each Morning"
);
assert.equal(
	normal.displayText,
	"[Try a healthy breakfast] The One Thing You're Doing Wrong Each Morning"
);
assert.equal(normal.hoverTitle, "The One Thing You're Doing Wrong Each Morning");
assert.equal(normal.rewritten, true);

const emptySummary = formatUnbaitTitle('', 'Original Title');
assert.equal(emptySummary.rewritten, false);
assert.equal(emptySummary.displayText, 'Original Title');

const longOriginal = 'A'.repeat(120);
const truncated = formatUnbaitTitle('Short tip', longOriginal, 40);
assert.ok(truncated.displayText.startsWith('[Short tip] '));
assert.ok(truncated.displayText.endsWith('…'));
assert.ok(truncated.displayText.length <= 40);
assert.equal(truncated.hoverTitle, longOriginal);
assert.equal(truncated.rewritten, true);

const stripsBrackets = formatUnbaitTitle('[Already bracketed]', 'Title');
assert.equal(stripsBrackets.displayText, '[Already bracketed] Title');

// --- gate ---

assert.equal(isClickbaitDetection({ problemScore: 0.1, flags: [] }), false);
assert.equal(isClickbaitDetection({ problemScore: CLICKBAIT_THRESHOLD, flags: [] }), true);
assert.equal(isClickbaitDetection({ problemScore: 0, flags: ['clickbait'] }), true);

assert.equal(
	pickDestinationUrl(
		[{ url: 'https://example.com/article', text: 'Go' }],
		'https://search.example/q'
	),
	'https://example.com/article'
);
assert.equal(
	pickDestinationUrl(['https://example.com/a'], 'https://example.com/a'),
	null
);

// --- extractTextFromHtml ---

const extracted = extractTextFromHtml(
	'<html><head><title>Eat oats daily</title></head><body><h1>Breakfast</h1><p>Oats help.</p></body></html>'
);
assert.equal(extracted.title, 'Eat oats daily');
assert.ok(extracted.text.includes('Oats help'));

// --- analyzeChunk: ignores non-clickbait (no fetch) ---

let fetchCalls = 0;
const nonBait = await analyzeChunk(
	{
		title: 'Edinburgh weather forecast for Tuesday',
		text: 'Edinburgh weather forecast for Tuesday\nCloudy with light rain.',
		links: [{ url: 'https://example.com/weather', text: 'Full forecast' }],
	},
	{ url: 'https://search.example/' },
	{
		mode: 'heuristic',
		fetchDestination: async () => {
			fetchCalls += 1;
			return { title: 'Weather', text: 'Rain', url: 'https://example.com/weather' };
		},
	}
);
assert.ok(nonBait.problemScore < CLICKBAIT_THRESHOLD);
assert.equal(fetchCalls, 0);
assert.equal(nonBait.metadata?.displayTitle, undefined);

// --- analyzeChunk: clickbait + mock fetch → rewrite metadata ---

const bait = await analyzeChunk(
	{
		title: "The One Thing You're Doing Wrong Each Morning",
		text: "The One Thing You're Doing Wrong Each Morning\nYou won't believe this tip.",
		links: [
			{
				url: 'https://example.com/breakfast',
				text: "The One Thing You're Doing Wrong Each Morning",
			},
		],
	},
	{ url: 'https://search.example/' },
	{
		mode: 'heuristic',
		fetchDestination: async () => ({
			title: 'Try a healthy breakfast | Health Site',
			text: 'Nutritionists recommend starting the day with protein and fibre.',
			url: 'https://example.com/breakfast',
		}),
	}
);
assert.ok(bait.problemScore >= CLICKBAIT_THRESHOLD);
assert.ok(bait.flags.includes('clickbait'));
assert.ok(bait.flags.includes('unbaited'));
assert.ok(String(bait.metadata?.displayTitle).startsWith('['));
assert.equal(
	bait.metadata?.originalTitle,
	"The One Thing You're Doing Wrong Each Morning"
);

// --- DOM rewrite ---

const window = new Window();
const document = window.document;
document.body.innerHTML = `
  <div id="chunk">
    <a href="https://example.com/breakfast">The One Thing You're Doing Wrong Each Morning</a>
  </div>
`;
const chunkEl = document.getElementById('chunk');
const analysis = completeAspectAnalysis('clickUnbait', {
	problemScore: 0.8,
	confidence: 0.7,
	flags: ['clickbait', 'unbaited'],
	metadata: {
		displayTitle:
			"[Try a healthy breakfast] The One Thing You're Doing Wrong Each Morning",
		originalTitle: "The One Thing You're Doing Wrong Each Morning",
		hoverTitle: "The One Thing You're Doing Wrong Each Morning",
	},
});
assert.equal(applyClickUnbaitRewrite(chunkEl, analysis), true);
const link = chunkEl.querySelector('a');
assert.ok(link.textContent.includes('[Try a healthy breakfast]'));
assert.equal(link.getAttribute('title'), "The One Thing You're Doing Wrong Each Morning");
assert.equal(chunkEl.getAttribute('data-betternet-unbaited'), '1');
// idempotent
assert.equal(applyClickUnbaitRewrite(chunkEl, analysis), false);

console.log('click-unbait tests OK');
