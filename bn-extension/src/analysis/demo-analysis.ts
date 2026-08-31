/**
 * Canned chunks + analysis for product-demo recordings: url -> chunks + ChunkAnalysis.
 *
 * Live analysis is slow and non-deterministic (model download, LLM latency, rate limits),
 * which makes it a bad thing to film. Each entry pins one real page URL to the chunks a
 * chunker would emit plus the analysis the pipeline would return, so a demo run is instant
 * and repeatable.
 *
 * Both entries are genuine, still-live URLs, and they are the two halves of one story: an
 * X post sharing a link to a fake news article, and the article it links to. Every verdict
 * cites a published fact-check.
 *
 * Scores are hand-set to land in the intended Nutrient Label band (see RiskLevel.ts).
 * buildChunkSummary averages the chunk-level analyses, so only list the features that
 * actually fired — padding with near-zero scores washes the label out.
 *
 * Nothing imports this yet. `findDemoPage()` is the seam: call it in background.ts
 * PERFORM_ANALYSIS (before chunking) and serve the canned result when it hits.
 */

import { createChunk } from '../types/Chunk.js';
import type { Chunk } from '../types/Chunk.js';
import { buildChunkSummary } from '../types/ChunkAnalysis.js';
import type { ChunkAnalysis } from '../types/ChunkAnalysis.js';
import { completeAspectAnalysis } from '../types/AspectAnalysis.js';
import type { AspectAnalysis } from '../types/AspectAnalysis.js';
import type { Statement } from '../types/Statement.js';

/** One feature's verdict, keyed by settings module id (see MODULE_ASPECT_TYPE). */
interface DemoAspectSpec {
  moduleId: 'factChecker' | 'biasDetector' | 'antiManipulation' | 'defuseRagebait' | 'clickUnbait';
  problemScore: number;
  confidence: number;
  flags: string[];
  explanation: string;
  /** Fact-check or source page, shown as a link in the Content Analysis modal. */
  url?: string;
}

interface DemoStatementSpec {
  type: 'claim' | 'opinion';
  summaryText: string;
  analyses: DemoAspectSpec[];
}

interface DemoChunkSpec {
  title: string;
  /** Account display name or article author, as shown on the page. */
  byline: string;
  /** Handle or publication name. */
  source: string;
  /** Absolute date, so the offline mirror does not age. */
  time: string;
  /** Verbatim text of the post or the opening of the article. */
  text: string;
  /** Link card, for a post that shares an article. */
  link?: { href: string; title: string; site: string };
  /** Distinctive phrases for pages we cannot chunk predictably (x.com renders the shared
   *  link as a truncated display URL, so the verbatim post text never matches). Used only
   *  when the text comparison fails. */
  markers?: string[];
  /** IAB Content Taxonomy Tier 1 category. */
  primaryTopic: string;
  statements: DemoStatementSpec[];
  analyses: DemoAspectSpec[];
}

interface DemoPageSpec {
  urls: string[];
  title: string;
  note: string;
  verified: string;
  chunks: DemoChunkSpec[];
}

export interface DemoChunk {
  chunk: Chunk;
  analysis: ChunkAnalysis;
  /** See DemoChunkSpec.markers. */
  markers: string[];
}

export interface DemoPage {
  /** URLs this page answers to, canonical first. */
  urls: string[];
  title: string;
  /** Why this example is in the demo. */
  note: string;
  /** Date the URLs were last confirmed live — recheck before recording. */
  verified: string;
  chunks: DemoChunk[];
}

// --- the examples ---
//
// Both URLs are real and were live on 2026-08-31 (HTTP 200). The X post text is verbatim
// from the API; the article excerpt is verbatim from the page. Verify both still load
// before a recording — a deleted post is the one thing this file cannot fake convincingly.
//
// Lower-risk alternative if naming an individual account is a problem for the audience:
// https://x.com/realtpv/status/1689201644456628224 is the publisher posting its own
// story ("Peruvian Villagers Are Reporting Nightly Attacks by 7ft Shapeshifting
// Reptilians"), same shape, no third party involved.

const LEAD_STORIES_DEBUNK =
  'https://leadstories.com/hoax-alert/2023/02/fact-check-report-does-not-prove-lab-grown-meat-causes-cancer-in-humans.html';
const HEALTH_FEEDBACK_DEBUNK =
  'https://healthfeedback.org/claimreview/lab-grown-meat-isnt-made-of-cancerous-cells/';
const FULL_FACT_DEBUNK = 'https://fullfact.org/health/lab-grown-meat-turbo-cancer/';
/** Background on the publisher: previously YourNewsWire, then NewsPunch. Records the
 *  Poynter count (debunked 80+ times in 2017-18) and that "Baxter Dmitry" posed as an
 *  unrelated Latvian man using a stolen profile photo. */
const PUBLISHER_PROFILE = 'https://en.wikipedia.org/wiki/The_People%27s_Voice_(website)';
/** Snopes on the same genre from the same byline: an invented celebrity-cannibalism claim
 *  hung on the Epstein files. */
const SNOPES_CELEBRITY_CLAIM = 'https://www.snopes.com/fact-check/epstein-files-dicaprio-cannibalism/';

/**
 * Example 1: a real post sharing a link to a fake news article. Posted 23 Apr 2026 by an
 * account presenting medical credentials (~763k followers), linking to The People's Voice.
 */
const SHARE_POST: DemoChunkSpec = {
  title: 'Study: Bill Gates’ Lab Grown Meat Causes Cancer in Humans',
  byline: 'Dr.Sam Youssef Ph.D.,Ph.D.,DPT.',
  source: '@drhossamsamy65',
  time: '23 Apr 2026',
  text:
    'Study: Bill Gates’ Lab Grown Meat Causes Cancer in Humans ' +
    'https://thepeoplesvoice.tv/study-bill-gates-lab-grown-meat-causes-cancer-in-humans/ via @realtpv',
  link: {
    href: 'https://thepeoplesvoice.tv/study-bill-gates-lab-grown-meat-causes-cancer-in-humans/',
    title: 'Study: Bill Gates’ Lab Grown Meat Causes Cancer in Humans',
    site: 'thepeoplesvoice.tv',
  },
  markers: ['Study: Bill Gates’ Lab Grown Meat Causes Cancer in Humans', 'drhossamsamy65'],
  primaryTopic: 'Medical Health',
  statements: [
    {
      type: 'claim',
      summaryText: 'A study found that Bill Gates’ lab-grown meat causes cancer in the people who eat it.',
      analyses: [
        {
          moduleId: 'factChecker',
          problemScore: 0.95,
          confidence: 0.88,
          flags: ['false'],
          explanation:
            'No such study exists. Lead Stories rated this exact headline FALSE: the "study" is a safety report Impossible Foods filed with the FDA about a plant-based burger, a different product from cultivated meat.',
          url: LEAD_STORIES_DEBUNK,
        },
      ],
    },
  ],
  analyses: [
    {
      moduleId: 'factChecker',
      problemScore: 0.9,
      confidence: 0.85,
      flags: ['false', 'shared-fake-article'],
      explanation:
        'The headline being shared is false and was debunked in February 2023. The FDA says it is "not aware of evidence or a credible mechanism to support the claim that cultured animal cells used as food cause cancer."',
      url: LEAD_STORIES_DEBUNK,
    },
    {
      moduleId: 'antiManipulation',
      problemScore: 0.62,
      confidence: 0.72,
      flags: ['low-credibility-source', 'false-authority'],
      explanation:
        'The link goes to The People’s Voice, formerly YourNewsWire and NewsPunch, a site with a long record of fabricated stories — shared here by an account whose display name claims two doctorates.',
      url: PUBLISHER_PROFILE,
    },
  ],
};

/**
 * Example 2: the fake article itself, still live. Published 21 Feb 2023, and it names no
 * study: the text traces back to a Bloomberg feature about immortalised cell lines,
 * relayed via Natural News and the National Pulse.
 */
const FAKE_ARTICLE: DemoChunkSpec = {
  title: 'Study: Bill Gates’ Lab Grown Meat Causes Cancer in Humans',
  byline: 'Sean Adl-Tabatabai',
  source: 'The People’s Voice',
  time: '21 Feb 2023',
  // Verbatim opening of the article.
  text:
    'Bill Gates’ lab-grown meat causes cancer in humans who consume it, according to a disturbing new study. ' +
    'Synthetic meat has been heavily promoted by Bill Gates and the globalist elites at the WEF as the solution ' +
    'to so-called climate change. However, this same food has now been shown to cause cancer via the immortalized ' +
    'cell lines used to manufacture it.',
  primaryTopic: 'Medical Health',
  statements: [
    {
      type: 'claim',
      summaryText: 'A new study shows lab-grown meat causes cancer in humans who eat it.',
      analyses: [
        {
          moduleId: 'factChecker',
          problemScore: 0.96,
          confidence: 0.9,
          flags: ['false', 'fabricated-study'],
          explanation:
            'There is no study. Lead Stories traced the claim to an Impossible Foods safety report about a plant-based burger, mixed with a Bloomberg feature about cultivated meat.',
          url: LEAD_STORIES_DEBUNK,
        },
      ],
    },
    {
      type: 'claim',
      summaryText: 'Cultivated-meat companies grow their product from immortalised cell lines.',
      analyses: [
        {
          moduleId: 'factChecker',
          problemScore: 0.15,
          confidence: 0.85,
          flags: ['true'],
          explanation:
            'True, and it comes from the article’s own source. Immortalised is not cancerous: the cells are selected to keep dividing in a bioreactor, not for any ability to form tumours, and they are broken down by cooking and digestion.',
          url: HEALTH_FEEDBACK_DEBUNK,
        },
      ],
    },
  ],
  analyses: [
    {
      moduleId: 'factChecker',
      problemScore: 0.94,
      confidence: 0.9,
      flags: ['false', 'fabricated-study'],
      explanation:
        'The headline claim is false and the cited study does not exist. Fact-checked by Lead Stories and Full Fact; no evidence links cultivated meat to cancer.',
      url: FULL_FACT_DEBUNK,
    },
    {
      moduleId: 'biasDetector',
      problemScore: 0.7,
      confidence: 0.78,
      flags: ['conspiracy-framing'],
      explanation:
        '"Globalist elites at the WEF" and "so-called climate change" frame a food-technology story as an elite plot, and the piece is sourced from Natural News rather than the research it claims to report.',
    },
    {
      moduleId: 'antiManipulation',
      problemScore: 0.6,
      confidence: 0.72,
      flags: ['low-credibility-source', 'engagement-bait'],
      explanation:
        'The People’s Voice has published fabricated stories for years under three names, and the article is interrupted by a "BYPASS THE CENSORS" email capture.',
      url: PUBLISHER_PROFILE,
    },
  ],
};


/**
 * Example 3: the sidebar teaser next to the article — an invented celebrity quote. No
 * interview, statement or report exists; the site manufactures these, and Snopes has
 * debunked the same byline's Epstein-cannibalism story.
 */
const DENZEL_TEASER: DemoChunkSpec = {
  title: 'Denzel Washington: NYPD Covered-Up Taylor Swift ‘Satanic Sacrifices’ Involving Missing Kids',
  byline: 'Baxter Dmitry',
  source: 'The People’s Voice',
  time: '30 Aug 2026',
  text:
    'EDITOR’S PICKS Denzel Washington: NYPD Covered-Up Taylor Swift ‘Satanic Sacrifices’ ' +
    'Involving Missing Kids by Baxter Dmitry in News',
  markers: ['Denzel Washington: NYPD Covered-Up Taylor Swift'],
  primaryTopic: 'Pop Culture',
  statements: [
    {
      type: 'claim',
      summaryText: 'Denzel Washington said the NYPD covered up satanic sacrifices involving Taylor Swift.',
      analyses: [
        {
          moduleId: 'factChecker',
          problemScore: 0.97,
          confidence: 0.9,
          flags: ['false', 'fabricated-quote'],
          explanation:
            'No interview, statement or report carries this quote. Invented celebrity quotes are this site’s stock in trade — Snopes debunked the same author’s claim that the Epstein files showed Leonardo DiCaprio eating "child meat".',
          url: SNOPES_CELEBRITY_CLAIM,
        },
      ],
    },
  ],
  analyses: [
    {
      moduleId: 'factChecker',
      problemScore: 0.97,
      confidence: 0.9,
      flags: ['false', 'fabricated-quote'],
      explanation:
        'A quote attributed to a real person with no source behind it, naming another real person as a criminal.',
      url: SNOPES_CELEBRITY_CLAIM,
    },
    {
      moduleId: 'antiManipulation',
      problemScore: 0.7,
      confidence: 0.75,
      flags: ['low-credibility-source', 'fabricated-quote'],
      explanation:
        'Poynter counted this site debunked more than 80 times in 2017-18, and the byline "Baxter Dmitry" was previously run behind a stolen profile photo.',
      url: PUBLISHER_PROFILE,
    },
    {
      moduleId: 'defuseRagebait',
      problemScore: 0.6,
      confidence: 0.7,
      flags: ['fear', 'conspiracy'],
      explanation:
        'Satanic-panic framing around missing children — built to be shared in alarm rather than read.',
    },
  ],
};

/** Example 4: the same shape in the sidebar spotlight, so the demo shows a page carrying
 *  several fabrications at once rather than one bad story. */
const SILVERSTONE_TEASER: DemoChunkSpec = {
  title: 'Alicia Silverstone Reveals 4 More Epstein Victims Will Die as ‘Sacrifice Season’ Rips Through Hollywood',
  byline: 'Baxter Dmitry',
  source: 'The People’s Voice',
  time: '29 Aug 2026',
  text:
    "Alicia Silverstone Reveals 4 More Epstein Victims Will Die as 'Sacrifice Season' Rips Through Hollywood",
  markers: ['4 More Epstein Victims Will Die', 'Alicia Silverstone'],
  primaryTopic: 'Pop Culture',
  statements: [
    {
      type: 'claim',
      summaryText: 'Alicia Silverstone said four more Epstein victims will die in a Hollywood "sacrifice season".',
      analyses: [
        {
          moduleId: 'factChecker',
          problemScore: 0.96,
          confidence: 0.88,
          flags: ['false', 'fabricated-quote'],
          explanation:
            'There is no such statement. The headline also predicts named deaths, which no source could support.',
          url: SNOPES_CELEBRITY_CLAIM,
        },
      ],
    },
  ],
  analyses: [
    {
      moduleId: 'factChecker',
      problemScore: 0.96,
      confidence: 0.88,
      flags: ['false', 'fabricated-quote'],
      explanation:
        'An invented quote plus an unfalsifiable prediction of deaths, attributed to a real actor.',
      url: SNOPES_CELEBRITY_CLAIM,
    },
    {
      moduleId: 'antiManipulation',
      problemScore: 0.7,
      confidence: 0.75,
      flags: ['low-credibility-source', 'fabricated-quote'],
      explanation:
        'Same publisher and byline as the other fabricated celebrity quotes on this page.',
      url: PUBLISHER_PROFILE,
    },
    {
      moduleId: 'defuseRagebait',
      problemScore: 0.55,
      confidence: 0.7,
      flags: ['fear', 'conspiracy'],
      explanation: 'Promises more deaths to come, which is what keeps the reader clicking through the sidebar.',
    },
  ],
};

const DEMO_PAGE_SPECS: DemoPageSpec[] = [
  {
    urls: [
      'https://x.com/drhossamsamy65/status/2047310606361899350',
      // Offline mirror from renderDemoPage(), for recording without the live site.
      'http://localhost:8080/demo/shared-fake-news-post.html',
    ],
    title: 'X post sharing a fake news link',
    note: 'Step 1 of the demo: the share, flagged in the feed before you click it. High Risk.',
    verified: '2026-08-31',
    chunks: [SHARE_POST],
  },
  {
    urls: [
      'https://thepeoplesvoice.tv/study-bill-gates-lab-grown-meat-causes-cancer-in-humans/',
      'http://localhost:8080/demo/fake-news-article.html',
    ],
    title: 'The People’s Voice — lab-grown meat article',
    note: 'Step 2: the article behind the link, plus two fabricated celebrity teasers in the sidebar. All High Risk.',
    verified: '2026-08-31',
    chunks: [FAKE_ARTICLE, DENZEL_TEASER, SILVERSTONE_TEASER],
  },
];

// --- build ---

function buildAspect(spec: DemoAspectSpec, idSuffix: string): AspectAnalysis {
  return completeAspectAnalysis(spec.moduleId, {
    // Fixed ids: a demo re-run should produce byte-identical results.
    id: `demo-${spec.moduleId}-${idSuffix}`,
    methodName: spec.moduleId,
    model: 'demo',
    problemScore: spec.problemScore,
    confidence: spec.confidence,
    flags: spec.flags,
    explanation: spec.explanation,
    url: spec.url,
  });
}

function buildStatements(spec: DemoChunkSpec, index: number): Statement[] {
  return spec.statements.map((statement, i) => ({
    type: statement.type,
    summaryText: statement.summaryText,
    analyses: statement.analyses.map((a, j) => buildAspect(a, `${index}-s${i}-${j}`)),
  }));
}

function chunkHtml(spec: DemoChunkSpec): string {
  const link = spec.link
    ? `\n    <a class="link-card" href="${spec.link.href}"><span class="link-title">${spec.link.title}</span><span class="link-site">${spec.link.site}</span></a>`
    : '';
  return `<article class="post" data-testid="post">
    <header>
      <span class="author" data-testid="authorName">${spec.byline}</span>
      <span class="handle">${spec.source}</span>
      <time>${spec.time}</time>
    </header>
    <p class="post-text" data-testid="postText">${spec.text}</p>${link}
  </article>`;
}

function buildChunk(pageUrl: string, spec: DemoChunkSpec, index: number): DemoChunk {
  const chunk = createChunk({
    url: pageUrl,
    title: spec.title,
    text: spec.text,
    html: chunkHtml(spec),
    // Matches the DOM that renderDemoPage() produces. On the live pages the chunker
    // supplies the real xpath and demoAnalysisForChunk() matches on title/text instead.
    xpath: `/html/body/main/article[${index + 1}]`,
    tags: ['post'],
    isPrimary: index === 0,
  });
  const analyses = spec.analyses.map((a, i) => buildAspect(a, `${index}-${i}`));
  const analysis: ChunkAnalysis = {
    chunkId: chunk.fingerprint,
    primaryTopic: spec.primaryTopic,
    statements: buildStatements(spec, index),
    analyses,
    summary: buildChunkSummary(analyses),
    xpath: chunk.xpath,
    title: chunk.title,
    tags: chunk.tags,
    url: pageUrl,
    fingerprint: chunk.fingerprint,
  };
  return { chunk, analysis, markers: spec.markers ?? [] };
}

export const DEMO_PAGES: DemoPage[] = DEMO_PAGE_SPECS.map((page) => ({
  urls: page.urls,
  title: page.title,
  note: page.note,
  verified: page.verified,
  chunks: page.chunks.map((spec, i) => buildChunk(page.urls[0], spec, i)),
}));

// --- lookup ---

/** Drop scheme, www, query and trailing slash, so an entry survives being served from a
 *  different port or arriving with tracking params. */
export function normaliseDemoUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function lastSegment(normalised: string): string {
  return normalised.split('/').filter(Boolean).pop() ?? '';
}

/**
 * Match on the full normalised URL, else on filename — so `file://…/social-feed.html` and
 * `http://localhost:9999/social-feed.html` both hit. Keep demo filenames distinctive.
 */
export function findDemoPage(url: string): DemoPage | undefined {
  const target = normaliseDemoUrl(url);
  if (!target) return undefined;
  const targetFile = lastSegment(target);
  return DEMO_PAGES.find((page) =>
    page.urls.some((pageUrl) => {
      const candidate = normaliseDemoUrl(pageUrl);
      if (candidate === target) return true;
      const candidateFile = lastSegment(candidate);
      return !!candidateFile && candidateFile === targetFile;
    })
  );
}

export function demoChunks(url: string): Chunk[] {
  return findDemoPage(url)?.chunks.map((c) => c.chunk) ?? [];
}

export function demoAnalyses(url: string): ChunkAnalysis[] {
  return findDemoPage(url)?.chunks.map((c) => c.analysis) ?? [];
}

/** Letters and digits only. A live chunk carries share counters, newlines and menu text
 *  that the canned copy does not, so compare the words and ignore everything else. */
function matchKey(text: string | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Enough words to identify a chunk without demanding the two texts line up end to end. */
const MATCH_PROBE_LENGTH = 120;

function sameContent(a: string | undefined, b: string | undefined): boolean {
  const keyA = matchKey(a);
  const keyB = matchKey(b);
  if (keyA.length < MATCH_PROBE_LENGTH || keyB.length < MATCH_PROBE_LENGTH) {
    return !!keyA && keyA === keyB;
  }
  // Either can be the longer one: the live chunk may wrap the article in page furniture,
  // or the canned copy may hold more of the article than the chunker captured.
  return keyA.includes(keyB.slice(0, MATCH_PROBE_LENGTH)) || keyB.includes(keyA.slice(0, MATCH_PROBE_LENGTH));
}

/** True when a live chunk is the demo entry: identity, then title, then the words. */
function matchesDemoChunk(entry: DemoChunk, live: Partial<Chunk>): boolean {
  if (live.fingerprint && entry.chunk.fingerprint === live.fingerprint) return true;
  if (live.xpath && entry.chunk.xpath === live.xpath) return true;
  if (live.title && matchKey(live.title) === matchKey(entry.chunk.title)) return true;
  return sameContent(live.text, entry.chunk.text);
}

/** Last resort: a distinctive phrase from the entry appears in the live chunk. */
function hasMarker(entry: DemoChunk, live: Partial<Chunk>): boolean {
  const key = matchKey(live.text);
  if (!key) return false;
  return entry.markers.some((marker) => {
    const needle = matchKey(marker);
    return !!needle && key.includes(needle);
  });
}

/** For pages chunked live: reuse the canned analysis for a chunk the page produced.
 *  Title and text matching are what work on the real sites, where the DOM (and so the
 *  xpath) is not ours to predict. */
export function demoAnalysisForChunk(url: string, chunk: Partial<Chunk>): ChunkAnalysis | undefined {
  const page = findDemoPage(url);
  if (!page) return undefined;
  const match =
    page.chunks.find((entry) => matchesDemoChunk(entry, chunk)) ??
    page.chunks.find((entry) => hasMarker(entry, chunk));
  return match?.analysis;
}

/**
 * Canned results for the chunks a live page produced. Keeps each live chunk's identity —
 * the on-page label is placed by xpath — and swaps in the canned analysis. Live chunks with
 * no canned counterpart are dropped: the demo should label its example, not guess at the
 * rest of the page. If the live chunker recognised nothing (a feed that would not render,
 * say), falls back to the canned chunks so the popup still has something to show.
 */
export function demoResultsForChunks(url: string, chunks: Partial<Chunk>[] = []): DemoChunk[] {
  const page = findDemoPage(url);
  if (!page) return [];
  const taken = new Set<Partial<Chunk>>();
  const results: DemoChunk[] = [];

  for (const entry of page.chunks) {
    // Every instance, not just the first: the same headline appears in the ticker and again
    // in the sidebar, and a label on one of them looks like the other slipped through.
    for (const live of pickLiveChunks(entry, chunks, taken)) {
      taken.add(live);
      results.push({
        ...entry,
        chunk: live as Chunk,
        analysis: {
          ...entry.analysis,
          chunkId: String(live.id ?? live.fingerprint ?? live.xpath ?? entry.analysis.chunkId),
          fingerprint: live.fingerprint ?? entry.analysis.fingerprint,
          xpath: live.xpath ?? entry.analysis.xpath,
          title: live.title ?? entry.analysis.title,
        },
      });
    }
  }

  return results.length ? results : page.chunks;
}

function pickLiveChunks(
  entry: DemoChunk,
  chunks: Partial<Chunk>[],
  taken: Set<Partial<Chunk>>
): Partial<Chunk>[] {
  const free = chunks.filter((c) => !taken.has(c));
  const matched = free.filter((c) => matchesDemoChunk(entry, c));

  // Markers are the loose match: the same headline in the ticker and in the sidebar card
  // are both wanted, but a container that merely holds the phrase (a whole timeline, a
  // whole article) is not. Keep the tightest match and its near-siblings.
  const marked = free
    .filter((c) => hasMarker(entry, c))
    .sort((a, b) => (a.text?.length ?? 0) - (b.text?.length ?? 0));
  const tightest = marked[0]?.text?.length ?? 0;
  const siblings = marked.filter((c) => (c.text?.length ?? 0) <= Math.max(tightest * 2, tightest + 40));

  return [...new Set([...matched, ...siblings])];
}

/** Standalone HTML for the page, for serving locally during a recording. */
export function renderDemoPage(page: DemoPage): string {
  const body = page.chunks.map((c) => c.chunk.html).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title}</title>
  <link rel="canonical" href="${page.urls[0]}">
  <style>
    body { font: 16px/1.5 -apple-system, system-ui, sans-serif; background: #f5f6f8; margin: 0; }
    main { max-width: 600px; margin: 0 auto; padding: 24px 12px; }
    .post { background: #fff; border: 1px solid #dfe2e6; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .post header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 8px; }
    .author { font-weight: 600; }
    .handle, time, footer { color: #667; font-size: 14px; }
    .link-card { display: block; border: 1px solid #dfe2e6; border-radius: 8px; padding: 12px; margin-top: 12px; text-decoration: none; color: inherit; }
    .link-title { display: block; font-weight: 600; }
    .link-site { color: #667; font-size: 14px; }
  </style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}
