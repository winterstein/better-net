/**
 * Unit tests for click-unbait unravel (format + gate + analyze with mocks).
 */

import assert from 'node:assert/strict';
import { formatUnbaitTitle } from '../src/features/click-unbait/format-unbait-title.js';
import {
	acceptSummary,
	analyzeChunk,
	echoesHeadline,
	isClickbaitDetection,
	pickDestinationUrl,
	CLICKBAIT_THRESHOLD,
} from '../src/features/click-unbait/analyze-chunk.js';
import {
	extractTextFromHtml,
	beginDestinationBudget,
	resetDestinationCache,
	isPublicHttpUrl,
} from '../src/features/click-unbait/fetch-destination.js';
import {
	allSignalIds,
	describeSignals,
	isQuizHeadline,
	scoreClickbait,
} from '../src/features/click-unbait/clickbait-signals.js';
import { isRemoteProvider } from '../src/ai/llm-client.js';
import { canClassify, canGenerate, getLocalModel } from '../src/ai/model-catalog.js';
import { findHeadlineLink, isFurnitureUrl, pickBestLink } from '../src/chunking/headline-link.js';
import { readFileSync } from 'node:fs';
import { applyClickUnbaitRewrite } from '../src/content/apply-click-unbait.js';
import { completeModuleAnalysis } from '../src/types/ModuleAnalysis.js';
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

// A long headline is kept whole: the budget only bites past DEFAULT_MAX_TITLE_LEN, and it
// applies to the original alone, so a wordier summary never costs the reader any headline.
const longButFine = 'Nine '.repeat(20).trim(); // 99 chars
assert.equal(
	formatUnbaitTitle('Short tip', longButFine).displayText,
	`[Short tip] ${longButFine}`
);
assert.equal(
	formatUnbaitTitle('A considerably longer honest summary than that one', longButFine)
		.displayText.endsWith(longButFine),
	true,
	'the summary length must not eat the headline'
);

// Truncation, when it does bite, cuts back to a word break — never half a word plus an
// ellipsis, which reads as another withheld detail.
const runaway =
	'Doctors are stunned by this one simple morning habit that experts say could completely ' +
	'transform your entire life in under thirty seconds a day, according to new research';
const truncated = formatUnbaitTitle('Drink water', runaway, 60);
assert.ok(truncated.displayText.startsWith('[Drink water] '));
assert.ok(truncated.displayText.endsWith('…'));
assert.equal(
	truncated.displayText,
	'[Drink water] Doctors are stunned by this one simple morning habit that…'
);
assert.equal(truncated.hoverTitle, runaway, 'the full headline is one hover away');
assert.equal(truncated.rewritten, true);

// No word break in reach (link text that is really a URL): cut flat rather than lose the lot.
const noSpaces = 'A'.repeat(120);
const flat = formatUnbaitTitle('Short tip', noSpaces, 40);
assert.equal(flat.displayText, `[Short tip] ${'A'.repeat(40)}…`);

const stripsBrackets = formatUnbaitTitle('[Already bracketed]', 'Title');
assert.equal(stripsBrackets.displayText, '[Already bracketed] Title');

// --- gate ---

assert.equal(isClickbaitDetection({ problemScore: 0.1, tags: [] }), false);
assert.equal(isClickbaitDetection({ problemScore: CLICKBAIT_THRESHOLD, tags: [] }), true);
assert.equal(isClickbaitDetection({ problemScore: 0, tags: ['clickbait'] }), true);

// A link has to match the headline. "Go" does not, so there is nothing to unravel — the
// old rule took the first http link in the chunk and confidently summarised whatever it
// found there.
assert.equal(
	pickDestinationUrl(
		{ links: [{ url: 'https://example.com/article', text: 'Go' }] },
		'https://search.example/q',
		'Nine things about breakfast'
	),
	null
);
// Matching link text wins.
assert.equal(
	pickDestinationUrl(
		{ links: [{ url: 'https://example.com/x', text: 'Nine things about breakfast' }] },
		'https://search.example/q',
		'Nine things about breakfast'
	),
	'https://example.com/x'
);
// So does a matching slug when the anchor has no text of its own (a card's image link).
assert.equal(
	pickDestinationUrl(
		{ links: [{ url: 'https://example.com/nine-things-about-breakfast', text: '' }] },
		'https://search.example/q',
		'Nine things about breakfast'
	),
	'https://example.com/nine-things-about-breakfast'
);
// A link to the page we are already on is not a destination.
assert.equal(
	pickDestinationUrl(
		{ links: [{ url: 'https://example.com/a', text: 'A' }] },
		'https://example.com/a',
		'A'
	),
	null
);

// Furniture is never the destination, however early it appears in the chunk. This is the
// bug that fetched google.com/preferences and captioned a headline with it.
assert.equal(
	pickDestinationUrl(
		{
			links: [
				{ url: 'https://www.google.com/preferences', text: 'Settings' },
				{ url: 'https://news.example/category/dogs', text: 'Dogs' },
				{ url: 'https://news.example/dog-rescues-owner-from-fire', text: '' },
			],
		},
		'https://www.google.com/search?q=dog',
		'Dog rescues owner from fire'
	),
	'https://news.example/dog-rescues-owner-from-fire'
);

// The chunker's resolved link is preferred over the chunk's link list, which on a card grid
// holds the *next* card's story.
assert.equal(
	pickDestinationUrl(
		{
			primaryLink: { url: 'https://news.example/the-right-story', label: 'The right story' },
			links: [{ url: 'https://news.example/the-next-card', text: '' }],
		},
		'https://news.example/',
		'The right story'
	),
	'https://news.example/the-right-story'
);
// …but not when it is furniture; then we fall back to scoring the list.
assert.equal(
	pickDestinationUrl(
		{
			primaryLink: { url: 'https://news.example/category/culture', label: 'Culture' },
			links: [{ url: 'https://news.example/the-right-story', text: '' }],
		},
		'https://news.example/',
		'The right story'
	),
	'https://news.example/the-right-story'
);

// --- extractTextFromHtml ---

const extracted = extractTextFromHtml(
	'<html><head><title>Eat oats daily</title></head><body><h1>Breakfast</h1><p>Oats help.</p></body></html>'
);
assert.equal(extracted.title, 'Eat oats daily');
assert.ok(extracted.text.includes('Oats help'));

// Numeric entities: WordPress writes every apostrophe as `&#039;`, and undecoded they went
// straight into the brackets on the page.
assert.equal(
	extractTextFromHtml('<title>It&#039;s here &amp; it&#8217;s fine</title>').title,
	"It's here & it\u2019s fine"
);

// The site name after the separator is not part of the headline.
assert.equal(
	extractTextFromHtml(
		'<title>Teacher lists the 10 basic skills 3rd graders no longer have - Upworthy</title>'
	).title,
	'Teacher lists the 10 basic skills 3rd graders no longer have'
);

// Furniture must not crowd out the article. On a real Upworthy page the nav, topic list and
// newsletter form filled the first 5,200 characters and the 4,000-character head slice
// contained no article text at all.
const furnished = extractTextFromHtml(`
	<html><head>
		<meta property="og:description" content="Nutritionists say to start with protein.">
	</head><body>
		<nav>${'Culture Family Nature Science Subscribe '.repeat(40)}</nav>
		<header>Skip to content</header>
		<main><article><p>${'The study followed 400 children over two years. '.repeat(8)}</p></article></main>
		<footer>${'About Contact Privacy Terms '.repeat(40)}</footer>
	</body></html>
`);
assert.ok(
	furnished.text.includes('The study followed 400 children'),
	'the article must survive the cap'
);
assert.ok(!furnished.text.includes('Skip to content'), 'page furniture must be dropped');
assert.equal(furnished.description, 'Nutritionists say to start with protein.');

// schema.org articleBody is the story with no furniture at all, so it wins outright.
const jsonLd = extractTextFromHtml(
	`<html><body><nav>Menu</nav><script type="application/ld+json">
	 {"@graph":[{"@type":"NewsArticle","articleBody":"${'Researchers tracked the cohort for a decade. '.repeat(6)}"}]}
	 </script><p>ignored</p></body></html>`
);
assert.equal(jsonLd.source, 'json-ld');
assert.ok(jsonLd.text.includes('Researchers tracked the cohort'));

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
			return {
				title: 'Weather',
				text: 'Rain',
				url: 'https://example.com/weather',
				source: 'body' as const,
				description: '',
			};
		},
	}
);
// The emitted problemScore is a ProblemScore band (terminology.md), and CLICKBAIT_THRESHOLD
// is exactly the low/medium boundary — so "below threshold" is the `low` band.
assert.equal(nonBait.problemScore, 'low');
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
			source: 'article' as const,
			description: 'Nutritionists recommend starting the day with protein and fibre.',
		}),
	}
);
assert.notEqual(bait.problemScore, 'low', 'at or above the clickbait threshold');
assert.ok(bait.tags.includes('clickbait'));
assert.ok(bait.metadata?.unbaited);
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
const analysis = completeModuleAnalysis('clickUnbait', {
	problemScore: 0.8,
	confidence: 0.7,
	tags: ['clickbait'],
	metadata: {
		unbaited: true,
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




// --- detector: measured against real headlines, not invented ones ---
//
// test-data/clickbait-headlines.json is hand-labelled copy captured from live upworthy.com
// and buzzfeed.com front pages and from the saved BBC pages. The thresholds below are the
// point of the file: the catchphrase list this replaced scored 0 on every one of the 41
// `bait` headlines, and a regression that quietly reintroduces that is invisible without a
// corpus to measure against.

const corpus = JSON.parse(
	readFileSync(new URL('../test-data/clickbait-headlines.json', import.meta.url), 'utf8')
).headlines as { headline: string; label: string }[];

const withLabel = (label: string) => corpus.filter((r) => r.label === label);
const flagged = (h: string) => scoreClickbait(h).score >= CLICKBAIT_THRESHOLD;

const baitRows = withLabel('bait');
const plainRows = withLabel('plain');
const quizRows = withLabel('quiz');
assert.ok(baitRows.length >= 40 && plainRows.length >= 60, 'corpus should not shrink silently');

const recall = baitRows.filter((r) => flagged(r.headline)).length / baitRows.length;
const falsePositives = plainRows.filter((r) => flagged(r.headline)).length;

assert.ok(
	recall >= 0.9,
	`clickbait recall dropped to ${(recall * 100).toFixed(0)}% (want >=90%); ` +
		baitRows
			.filter((r) => !flagged(r.headline))
			.map((r) => `\n    ${scoreClickbait(r.headline).score.toFixed(2)} ${r.headline}`)
			.join('')
);
// Labelling a plain news headline is worse than missing a bait one: it teaches the reader
// to ignore the label. One known miss is allowed — "People shared what they loved about
// their childhood home. An overwhelming number said trees." is bait-shaped but does answer
// itself in the last three words.
assert.ok(
	falsePositives <= 2,
	`${falsePositives} plain headlines flagged as clickbait: ` +
		plainRows
			.filter((r) => flagged(r.headline))
			.map((r) => `\n    ${scoreClickbait(r.headline).score.toFixed(2)} ${r.headline}`)
			.join('')
);
// A quiz has no withheld answer sitting on a destination page, so there is nothing honest
// to put in the brackets.
assert.ok(quizRows.filter((r) => flagged(r.headline)).length <= 3, 'quizzes are out of scope');
assert.equal(isQuizHeadline('If You Can Answer 15/25 Of These Spelling Questions...'), true);
assert.equal(isQuizHeadline('Bank of England holds interest rates at 4.5%'), false);

// Curly apostrophes are what sites actually publish; the old patterns only had straight
// ones, so `won’t` never matched anything.
assert.ok(
	scoreClickbait('Teacher lists the 10 skills 3rd graders no longer have, and it\u2019s eye-opening')
		.score >= CLICKBAIT_THRESHOLD
);

// --- echo guard: the summary must say something the headline did not ---

assert.equal(
	echoesHeadline(
		"You won't believe what this Harvard doctor keeps",
		"You won't believe what this Harvard doctor keeps on a Post-it note"
	),
	true
);
assert.equal(
	echoesHeadline(
		'The note says "awareness"',
		"Harvard psychiatrist reveals 'the fastest way to change your life'"
	),
	false
);
// This is the exact string the old heuristic produced: the destination <title> is the same
// clickbait headline plus a site suffix, so the rewrite printed the bait twice.
assert.equal(
	acceptSummary(
		"You won't believe what this Harvard doctor keeps",
		"You won't believe what this Harvard doctor keeps on a Post-it note"
	),
	null
);
assert.equal(acceptSummary('Eat protein at breakfast', 'The One Thing You Do Wrong'), 'Eat protein at breakfast');
assert.equal(acceptSummary('  ', 'Anything'), null, 'empty summary is no summary');

// --- an unravel that would have echoed produces no rewrite at all ---

resetDestinationCache();
beginDestinationBudget('https://feed.example/');
const echoed = await analyzeChunk(
	{
		title: "The One Thing You're Doing Wrong Each Morning",
		text: "The One Thing You're Doing Wrong Each Morning",
		links: [
			{
				url: 'https://example.com/the-one-thing-youre-doing-wrong-each-morning',
				text: "The One Thing You're Doing Wrong Each Morning",
			},
		],
	},
	{ url: 'https://feed.example/' },
	{
		mode: 'heuristic',
		fetchDestination: async () => ({
			// What a real site serves: <title> is the headline again, and nothing else useful.
			title: "The One Thing You're Doing Wrong Each Morning | Health Site",
			text: "The One Thing You're Doing Wrong Each Morning",
			description: '',
			source: 'body' as const,
			url: 'https://example.com/the-one-thing-youre-doing-wrong-each-morning',
		}),
	}
);
assert.ok(echoed.tags.includes('clickbait'));
assert.ok(!echoed.metadata?.unbaited, 'must not claim to have unbaited anything');
assert.equal(echoed.metadata?.displayTitle, undefined, 'no rewrite rather than a false one');

// --- destination budget and cache ---

resetDestinationCache();
beginDestinationBudget('https://feed.example/', 1);
let networkCalls = 0;
const countingFetch = (async () => {
	networkCalls += 1;
	return {
		ok: true,
		status: 200,
		statusText: 'OK',
		url: 'https://example.com/a',
		headers: { get: () => 'text/html' },
		text: async () => '<html><head><title>A story about ducks</title></head><body><main><p>' +
			'Ducks were counted on the canal for six weeks running. '.repeat(6) + '</p></main></body></html>',
	};
}) as unknown as typeof fetch;

const { fetchDestinationText } = await import('../src/features/click-unbait/fetch-destination.js');
const onFeed = { fetchImpl: countingFetch, pageUrl: 'https://feed.example/' };

const first = await fetchDestinationText('https://example.com/a', onFeed);
assert.ok(first, 'first fetch succeeds');
const repeat = await fetchDestinationText('https://example.com/a', onFeed);
assert.equal(repeat?.title, first?.title);
assert.equal(networkCalls, 1, 'a repeated destination is served from cache');
assert.equal(
	await fetchDestinationText('https://example.com/b', onFeed),
	null,
	'the per-page budget caps outbound requests'
);

// Budgets are per page, not global. The background analyses several tabs from one service
// worker, so a shared counter meant a second page could start already spent.
beginDestinationBudget('https://other.example/', 1);
assert.ok(
	await fetchDestinationText('https://example.com/c', {
		fetchImpl: countingFetch,
		pageUrl: 'https://other.example/',
	}),
	'a second page gets its own allowance'
);
assert.equal(
	await fetchDestinationText('https://example.com/d', onFeed),
	null,
	'and the first page is still spent'
);

// --- headline link resolution in the DOM ---
//
// The shape that broke this on every card grid: the story anchor wraps the image, comes
// *before* the heading in document order, and carries the headline only in aria-label. The
// chunker filed it under the previous card, so every rewrite on the page was off by one.

const cardWindow = new Window();
cardWindow.document.body.innerHTML = `
  <div class="grid">
    <div class="card" id="card-1">
      <a href="/neurologist-hand-test-dementia" aria-label="Neurologist shares a 10-second hand test"><img src="a.jpg"></a>
      <div><a href="/category/health">Health</a><h3 id="h1">Neurologist shares a 10-second hand test</h3></div>
    </div>
    <div class="card" id="card-2">
      <a href="/europeans-craziest-questions" aria-label="Europeans share the craziest questions"><img src="b.jpg"></a>
      <div><h3 id="h2">Europeans share the craziest questions</h3></div>
    </div>
  </div>
`;
const heading = cardWindow.document.getElementById('h1');
const resolved = findHeadlineLink(
	heading as unknown as Element,
	'Neurologist shares a 10-second hand test',
	'https://news.example/'
);
assert.equal(resolved?.url, 'https://news.example/neurologist-hand-test-dementia');
// Not the category link that sits between them, and not the neighbouring card.
assert.ok(!resolved?.url.includes('category'));
assert.ok(!resolved?.url.includes('europeans'));

// Nothing matches → nothing returned. No link beats the wrong link.
assert.equal(
	pickBestLink(
		[{ url: 'https://news.example/something-else-entirely', text: 'Read more' }],
		'Neurologist shares a 10-second hand test',
		'https://news.example/'
	),
	null
);



// A summary that opens a quotation and never closes it reads as another withheld detail.
// This arrives straight from a publisher's og:description, with no truncation involved, so
// the check cannot live on the truncation branch alone.
assert.equal(
	acceptSummary('He couldn\u2019t believe the "full American experience', 'Unrelated headline here'),
	"He couldn\u2019t believe the"
);
assert.equal(
	acceptSummary('She called it "the best day of her life"', 'Unrelated headline here'),
	'She called it "the best day of her life"',
	'a properly closed quotation is left alone'
);
assert.equal(
	acceptSummary('\u201cWe never expected it, said the mayor', 'Unrelated headline here'),
	'We never expected it, said the mayor',
	'a quotation opened at the very start loses the mark, not the sentence'
);

// --- architecture invariants ---
//
// These two cost nothing to keep and both have already been broken once.

// Every signal carries its own description, so a signal cannot be added to the scorer and
// forgotten in a separate map — which is exactly what happened to `singular_tease`, leaving
// every headline it caught alone saying "sensational framing".
for (const id of allSignalIds()) {
	const said = describeSignals([id]);
	assert.notEqual(said, 'sensational framing', `signal ${id} has no description`);
}

// No feature may hard-code a provider name. `isRemoteProvider` is the question to ask, so
// adding a provider is one entry in llm-client.ts and nothing else. Click Unbait used to
// carry two `mode === 'openai' || mode === 'anthropic'` disjunctions, and missing one made a
// new provider silently fall back to heuristics.
assert.equal(isRemoteProvider('openai'), true);
assert.equal(isRemoteProvider('anthropic'), true);
assert.equal(isRemoteProvider('local'), false);
assert.equal(isRemoteProvider('heuristic'), false);

const featureSource = readFileSync(
	new URL('../src/features/click-unbait/analyze-chunk.ts', import.meta.url),
	'utf8'
).replace(/\/\*[\s\S]*?\*\//g, ''); // comments may name providers when explaining why
assert.ok(
	!/['"](openai|anthropic)['"]/.test(featureSource),
	'the feature layer must not hard-code provider names; ask isRemoteProvider instead'
);

// An explicitly injected client wins over `mode`. Checking `mode === 'local'` first meant a
// caller that supplied a client and left mode at its default had the client ignored.
let injectedWasUsed = false;
await analyzeChunk(
	{ title: 'The one thing you are doing wrong each morning', text: 'x', links: [] },
	{ url: 'https://x.test/' },
	{
		mode: 'local',
		localBackend: null,
		llmClient: {
			async complete() {
				injectedWasUsed = true;
				return JSON.stringify({ problemScore: 0.9, flags: ['clickbait'] });
			},
		},
	}
);
assert.equal(injectedWasUsed, true, 'an injected llmClient must not be silently ignored');

// Local model capability comes from the catalog, not a regex over the pipeline name.
assert.equal(canGenerate(getLocalModel('flan-t5-small')), true);
assert.equal(canGenerate(getLocalModel('mobilebert-mnli')), false);
assert.equal(canClassify(getLocalModel('mobilebert-mnli')), true);

assert.equal(
	extractTextFromHtml(
		'<meta property="og:description" content="It\'s the fastest way to change your life">'
	).description,
	"It's the fastest way to change your life"
);

assert.equal(isFurnitureUrl('https://www.bbc.co.uk/sport', 'https://www.bbc.co.uk/'), true);
assert.equal(isFurnitureUrl('https://www.bbc.co.uk/news', 'https://www.bbc.co.uk/'), true);
assert.equal(
	isFurnitureUrl('https://www.bbc.co.uk/news/uk-12345678', 'https://www.bbc.co.uk/'),
	false
);

assert.equal(isPublicHttpUrl('https://example.com/story'), true);
assert.equal(isPublicHttpUrl('http://localhost/admin'), false);
assert.equal(isPublicHttpUrl('http://127.0.0.1/'), false);
assert.equal(isPublicHttpUrl('http://192.168.1.1/'), false);
assert.equal(isPublicHttpUrl('http://169.254.169.254/latest/meta-data/'), false);

resetDestinationCache();
beginDestinationBudget('https://feed.example/', 12);
let failedCalls = 0;
const failingFetch = (async () => {
	failedCalls += 1;
	throw new Error('network down');
}) as unknown as typeof fetch;
assert.equal(
	await fetchDestinationText('https://example.com/fail', {
		fetchImpl: failingFetch,
		pageUrl: 'https://feed.example/',
	}),
	null
);
assert.equal(
	await fetchDestinationText('https://example.com/fail', {
		fetchImpl: failingFetch,
		pageUrl: 'https://feed.example/',
	}),
	null
);
assert.equal(failedCalls, 2, 'a failed fetch is not cached');

console.log('click-unbait tests OK');
