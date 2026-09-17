/**
 * Canned chunks + analysis for product-demo recordings: url -> chunks + ChunkAnalysis.
 *
 * Live analysis is slow and non-deterministic (model download, LLM latency, rate limits),
 * which makes it a bad thing to film. Each entry pins one real page URL to the chunks a
 * chunker would emit plus the analysis the pipeline would return, so a demo run is instant
 * and repeatable.
 *
 * Every URL below is genuine and still live, and every verdict cites a published
 * fact-check. Two of them are the two halves of one story: an X post sharing a link to a
 * fake news article, and the article it links to.
 *
 * Scores are hand-set to land in the intended Nutrient Label band (see RiskLevel.ts).
 * buildChunkSummary averages the chunk-level analyses, so only list the features that
 * actually fired — padding with near-zero scores washes the label out.
 *
 * Two seams into this file, both used by background.ts performAnalysis:
 * `findDemoPage()` matches the page being analysed, and `demoLinkResultsForChunks()`
 * matches a canned headline wherever it turns up as a link — which is what the
 * click-unbait example needs, since the whole point is the link you have not clicked.
 */

import { createChunk } from '../types/Chunk.js';
import type { Chunk } from '../types/Chunk.js';
import { buildChunkSummary } from '../types/ChunkAnalysis.js';
import type { ChunkAnalysis } from '../types/ChunkAnalysis.js';
import { completeModuleAnalysis } from '../types/ModuleAnalysis.js';
import type { ModuleAnalysis } from '../types/ModuleAnalysis.js';
import type { Statement } from '../types/Statement.js';
import { formatUnbaitTitle } from '../features/click-unbait/format-unbait-title.js';

/** The Demo URLs for easy reference by6yccfkj developers */
const DEMO_URLS = [
  'https://x.com/drhossamsamy65/status/2047310606361899350',
  'https://thepeoplesvoice.tv/study-bill-gates-lab-grown-meat-causes-cancer-in-humans/',
  'https://x.com/realMaalouf/status/2094452781843100052',
  'https://www.upworthy.com/harvard-psychiatrist-reveals-the-fastest-way-to-change-your-life-using-just-one-post-it-note/',
];
// Build then serve: npm run build:demo && npx serve -l 8080 --no-clean-urls demo/
// (serve mounts demo/ at /, so paths have no /demo/ prefix)
const DEMO_URLS_OFFLINE_MIRROR = [
  'http://localhost:8080/shared-fake-news-post.html',
  'http://localhost:8080/fake-news-article.html',
  'http://localhost:8080/unsourced-statistic-post.html',
  'http://localhost:8080/clickbait-headline-link.html',
];

/** One feature's verdict, keyed by settings module id. */
interface DemoModuleSpec {
  moduleId: 'factChecker' | 'biasDetector' | 'antiManipulation' | 'defuseRagebait' | 'clickUnbait';
  problemScore: number;
  confidence: number;
  tags: string[];
  explanation: string;
  /** Fact-check or source page, shown as a link in the Content Analysis modal. */
  url?: string;
  /** clickUnbait only: what the unravel step would return after reading the destination.
   *  buildModule turns it into the displayTitle/hoverTitle metadata that
   *  apply-click-unbait.ts rewrites the on-page link with, using the same formatter the
   *  live feature uses — so the demo cannot show a rewrite the feature could not produce. */
  honestSummary?: string;
  /** clickUnbait only: the link the headline goes to. */
  destinationUrl?: string;
}

interface DemoStatementSpec {
  type: 'claim' | 'opinion';
  summaryText: string;
  analyses: DemoModuleSpec[];
}

interface DemoChunkSpec {
  /** How the offline mirror renders it: a post (default) or a link card pointing elsewhere. */
  kind?: 'post' | 'teaser';
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
  analyses: DemoModuleSpec[];
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
  /** Set by demoResultsForChunks when nothing on the page matched and it fell back to the
   *  canned chunk. Such a result has no element and so cannot be labelled on the page. */
  canned?: boolean;
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
// All three URLs are real and were live on 2026-09-01 (HTTP 200). Post text is verbatim from
// the API; the article excerpt is verbatim from the page. Verify they still load before a
// recording — a deleted post is the one thing this file cannot fake convincingly.
//
// Every verdict below cites a published fact-check, and the wording is held to what that
// fact-check actually establishes: where a claim mixes a defensible number with an invented
// one (example 3), the label says so rather than dismissing the lot.
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

/** dpa (17 Jul 2026) on the exact "50 million / 40 million" wording: no reputable evidence,
 *  no study confirms it, and the 80% traces to a Lebanese TV presenter's opinion. Also
 *  records where it acquired its official veneer — an August 2013 written question to the
 *  European Parliament from Lega Nord that repeated it without checking. */
const DPA_WELFARE_DEBUNK = 'https://dpa-factchecking.com/netherlands/260717-99-85419/';
/** Newtral (2 Sep 2020) rated the same claim Falso and asked Eurostat directly: it keeps no
 *  statistics by ethnic group, so the denominator for a figure like this does not exist. */
const NEWTRAL_WELFARE_DEBUNK = 'https://www.newtral.es/bulo-musulmanes-asistencia-social-europa/20200902/';

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
          tags: ['false-claim'],
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
      tags: ['false-claim'],
      explanation:
        'The headline being shared is false and was debunked in February 2023. The FDA says it is "not aware of evidence or a credible mechanism to support the claim that cultured animal cells used as food cause cancer."',
      url: LEAD_STORIES_DEBUNK,
    },
    {
      moduleId: 'antiManipulation',
      problemScore: 0.62,
      confidence: 0.72,
      tags: ['fringe-view'],
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
          tags: ['false-claim'],
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
          tags: ['verified-claims'],
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
      tags: ['false-claim'],
      explanation:
        'The headline claim is false and the cited study does not exist. Fact-checked by Lead Stories and Full Fact; no evidence links cultivated meat to cancer.',
      url: FULL_FACT_DEBUNK,
    },
    {
      moduleId: 'biasDetector',
      problemScore: 0.7,
      confidence: 0.78,
      tags: ['fringe-view'],
      explanation:
        '"Globalist elites at the WEF" and "so-called climate change" frame a food-technology story as an elite plot, and the piece is sourced from Natural News rather than the research it claims to report.',
    },
    {
      moduleId: 'antiManipulation',
      problemScore: 0.6,
      confidence: 0.72,
      tags: ['fringe-view'],
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
          tags: ['false-claim'],
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
      tags: ['false-claim'],
      explanation:
        'A quote attributed to a real person with no source behind it, naming another real person as a criminal.',
      url: SNOPES_CELEBRITY_CLAIM,
    },
    {
      moduleId: 'antiManipulation',
      problemScore: 0.7,
      confidence: 0.75,
      tags: ['fringe-view'],
      explanation:
        'Poynter counted this site debunked more than 80 times in 2017-18, and the byline "Baxter Dmitry" was previously run behind a stolen profile photo.',
      url: PUBLISHER_PROFILE,
    },
    {
      moduleId: 'defuseRagebait',
      problemScore: 0.6,
      confidence: 0.7,
      tags: ['fear', 'fringe-view'],
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
          tags: ['false-claim'],
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
      tags: ['false-claim'],
      explanation:
        'An invented quote plus an unfalsifiable prediction of deaths, attributed to a real actor.',
      url: SNOPES_CELEBRITY_CLAIM,
    },
    {
      moduleId: 'antiManipulation',
      problemScore: 0.7,
      confidence: 0.75,
      tags: ['fringe-view'],
      explanation:
        'Same publisher and byline as the other fabricated celebrity quotes on this page.',
      url: PUBLISHER_PROFILE,
    },
    {
      moduleId: 'defuseRagebait',
      problemScore: 0.55,
      confidence: 0.7,
      tags: ['fear', 'fringe-view'],
      explanation: 'Promises more deaths to come, which is what keeps the reader clicking through the sidebar.',
    },
  ],
};

/** The clickbait headline's destination: a real Upworthy piece by Cecily Knobler,
 *  1 Sep 2026. Nothing in it is false — which is the point of having it here. */
const CLICKBAIT_DESTINATION =
  'https://www.upworthy.com/harvard-psychiatrist-reveals-the-fastest-way-to-change-your-life-using-just-one-post-it-note/';
/** Affect labelling — putting a feeling into words damps the reaction to it — is the
 *  ordinary, decades-old technique under the headline. Backs the one statement in this
 *  chunk, which is true: it is the packaging that is the problem, not the content. */
const AFFECT_LABELLING = 'https://en.wikipedia.org/wiki/Affect_labeling';

/**
 * Example 3: a fabricated statistic, posted with no source at all. Posted 31 Aug 2026 by an
 * account with ~502k followers; 259k views, 18k likes and 6.8k reposts within a day.
 *
 * Worth having in the demo because it is a different failure from example 1: nothing is
 * linked, so there is no article to open and check — the post *is* the claim. The number is
 * also not simply invented on the spot, which is what makes it durable: a TV presenter's
 * aside in 2012 was repeated in a 2013 European Parliament question, and has been recycled
 * in several languages ever since.
 *
 * Note the population figure is roughly right (Pew: ~45.5m Muslims in Europe in 2020,
 * counting Russia and the Balkans) — it is the 40 million that is fabricated. Saying
 * otherwise would make our own label wrong.
 */
const WELFARE_STAT_POST: DemoChunkSpec = {
  title: 'Shocking data revealed: Out of 50 million Muslims in Europe, 40 million are on welfare',
  byline: 'Dr. Maalouf',
  source: '@realMaalouf',
  time: '31 Aug 2026',
  text:
    'Shocking data revealed: Out of 50 million Muslims in Europe, 40 million are on welfare ' +
    'and receive social benefits.',
  markers: ['Out of 50 million Muslims in Europe', 'realMaalouf'],
  primaryTopic: 'News and Politics',
  statements: [
    {
      type: 'claim',
      summaryText:
        '40 of the 50 million Muslims in Europe live on welfare and receive social benefits.',
      analyses: [
        {
          moduleId: 'factChecker',
          problemScore: 0.95,
          confidence: 0.9,
          tags: ['false-claim'],
          explanation:
            'No study reports this. Producing the figure would need a dataset that records both religion and welfare receipt, comparably, across every European country — and no such dataset exists: Eurostat told Newtral it keeps no statistics by ethnic group. The EU Agency for Fundamental Rights (2024) found 63% of Muslims surveyed gave paid work as their main activity, against 75% of the general population — nothing like 80% on benefits.',
          url: DPA_WELFARE_DEBUNK,
        },
      ],
    },
  ],
  analyses: [
    {
      moduleId: 'factChecker',
      problemScore: 0.95,
      confidence: 0.9,
      tags: ['false-claim'],
      explanation:
        'dpa checked this exact wording in July 2026 and found no reputable evidence for it. The population figure is about right; the 40 million is not a measurement of anything.',
      url: DPA_WELFARE_DEBUNK,
    },
    {
      moduleId: 'antiManipulation',
      problemScore: 0.72,
      confidence: 0.8,
      tags: ['suspect-claim'],
      explanation:
        'The number began as a remark by a presenter on Lebanese TV in 2012 — misattributed ever since to the Egyptian researcher he was interviewing, who disagreed with him on air — and was then repeated in a 2013 written question to the European Parliament, which is where it picked up the look of an official statistic.',
      url: NEWTRAL_WELFARE_DEBUNK,
    },
    {
      moduleId: 'biasDetector',
      problemScore: 0.8,
      confidence: 0.75,
      tags: ['ragebait'],
      explanation:
        'Assigns a single behaviour to 50 million people identified only by religion, using a statistic that does not exist.',
      url: DPA_WELFARE_DEBUNK,
    },
    {
      moduleId: 'defuseRagebait',
      problemScore: 0.66,
      confidence: 0.7,
      tags: ['ragebait'],
      explanation:
        '"Shocking data revealed" with no data attached, on a topic chosen to provoke: 259,000 views in a day.',
      url: DPA_WELFARE_DEBUNK,
    },
  ],
};

/**
 * The clickbait example: clickbait, and nothing worse than clickbait.
 *
 * Every trick in one line. Borrowed authority ("Harvard psychiatrist"), an unbeatable
 * promise ("the fastest way to change your life"), and then the withholding: it dangles a
 * single Post-it note and refuses to say what is written on it. Clicking is the only way to
 * find out, which is the whole design. (It is not even one note — the piece uses four.)
 *
 * There is no false claim in it, and the technique it describes is real and old, so this is
 * the demo's counterweight to the fake-news examples: the chunk lands on Caution rather
 * than High Risk, and the fact-checker's one verdict is *true*. What Click Unbait does is
 * close the curiosity gap in place — the link text becomes `[honest summary] original
 * title`, so the reader gets the answer without the click and can still take it if they
 * want the rest.
 *
 * It is also the reason `demoLinkResultsForChunks()` exists. A clickbait headline is
 * something you meet as a link on some other page, so this entry is matched by its headline
 * on whatever page carries it, not by a demo URL.
 */
const CLICKBAIT_TEASER: DemoChunkSpec = {
  kind: 'teaser',
  title: 'Harvard psychiatrist reveals ‘the fastest way to change your life’ using just one Post-it note',
  byline: 'Cecily Knobler',
  source: 'upworthy.com',
  time: '1 Sep 2026',
  // The headline plus the furniture a feed card puts round it, which is all a link gives you.
  text:
    'Harvard psychiatrist reveals ‘the fastest way to change your life’ using just one ' +
    'Post-it note upworthy.com · Cecily Knobler · 1 Sep 2026',
  link: {
    href: CLICKBAIT_DESTINATION,
    title: 'Harvard psychiatrist reveals ‘the fastest way to change your life’ using just one Post-it note',
    site: 'upworthy.com',
  },
  markers: ['the fastest way to change your life', 'using just one Post-it note'],
  primaryTopic: 'Healthy Living',
  statements: [
    {
      type: 'claim',
      // Deliberately the only statement, and it is true. A demo that flagged this as
      // misinformation would teach the wrong lesson about what the labels mean: the
      // advice is sound, it is the headline that is working the reader.
      summaryText:
        'Naming a feeling in words, instead of reacting to it, reduces how strongly you react.',
      analyses: [
        {
          moduleId: 'factChecker',
          problemScore: 0.15,
          confidence: 0.8,
          tags: ['verified-claims'],
          explanation:
            'True, and unremarkable. Affect labelling has been studied since the 2000s and putting a name to a feeling before acting on it is standard in CBT and in mindfulness practice — what the headline sells as a Harvard secret is in every therapy handbook.',
          url: AFFECT_LABELLING,
        },
      ],
    },
  ],
  analyses: [
    {
      moduleId: 'clickUnbait',
      problemScore: 0.66,
      confidence: 0.82,
      tags: ['clickbait'],
      explanation:
        'The headline withholds the one thing it is about: what the note says. The answer is the word "awareness" — noticing the feeling before reacting to it — which takes six words to state and costs the publisher a click to give away. "Harvard psychiatrist" and "the fastest way to change your life" are there to make the gap unbearable.',
      honestSummary: 'The note says ‘awareness’',
      destinationUrl: CLICKBAIT_DESTINATION,
    },
  ],
};

const DEMO_PAGE_SPECS: DemoPageSpec[] = [
  {
    urls: [
      'https://x.com/drhossamsamy65/status/2047310606361899350',
      // Offline mirror from renderDemoPage(), for recording without the live site.
      'http://localhost:8080/shared-fake-news-post.html',
    ],
    title: 'X post sharing a fake news link',
    note: 'Step 1 of the demo: the share, flagged in the feed before you click it. High Risk.',
    verified: '2026-08-31',
    chunks: [SHARE_POST],
  },
  {
    urls: [
      'https://thepeoplesvoice.tv/study-bill-gates-lab-grown-meat-causes-cancer-in-humans/',
      'http://localhost:8080/fake-news-article.html',
    ],
    title: 'The People’s Voice — lab-grown meat article',
    note: 'Step 2: the article behind the link, plus two fabricated celebrity teasers in the sidebar. All High Risk.',
    verified: '2026-08-31',
    chunks: [FAKE_ARTICLE, DENZEL_TEASER, SILVERSTONE_TEASER],
  },
  {
    urls: [
      'https://x.com/realMaalouf/status/2094452781843100052',
      'http://localhost:8080/unsourced-statistic-post.html',
    ],
    title: 'X post with a fabricated statistic',
    note: 'Standalone example: nothing is linked, so there is no article to open and check — the post is the claim. High Risk.',
    verified: '2026-09-01',
    chunks: [WELFARE_STAT_POST],
  },
  {
    urls: [
      // The destination, so opening the article rewrites its own headline too.
      CLICKBAIT_DESTINATION,
      'http://localhost:8080/clickbait-headline-link.html',
    ],
    title: 'Clickbait headline, rewritten',
    note:
      'The clickbait example: sound advice behind a headline that will not give it up. ' +
      'Caution, not High Risk — the link text is rewritten in place instead. Also matched as ' +
      'a link on any other page, via demoLinkResultsForChunks().',
    verified: '2026-09-02',
    chunks: [CLICKBAIT_TEASER],
  },
];

// --- build ---

function buildModule(
  spec: DemoModuleSpec,
  idSuffix: string,
  originalTitle: string
): ModuleAnalysis {
  return completeModuleAnalysis(spec.moduleId, {
    // Fixed ids: a demo re-run should produce byte-identical results.
    id: `demo-${spec.moduleId}-${idSuffix}`,
    methodName: spec.moduleId,
    model: 'demo',
    problemScore: spec.problemScore,
    confidence: spec.confidence,
    tags: spec.tags,
    explanation: spec.explanation,
    url: spec.url,
    metadata: unbaitMetadata(spec, originalTitle),
  });
}

/**
 * The shape apply-click-unbait.ts reads: `originalTitle` to find the link on the page,
 * `displayTitle` to put in it, `hoverTitle` for the tooltip. Run through the live
 * feature's own formatter rather than written out by hand, so a change to the length
 * budget shows up in the demo instead of the demo quietly disagreeing with the product.
 */
function unbaitMetadata(
  spec: DemoModuleSpec,
  originalTitle: string
): Record<string, unknown> | undefined {
  if (!spec.honestSummary) return undefined;
  const formatted = formatUnbaitTitle(spec.honestSummary, originalTitle);
  return {
    destinationUrl: spec.destinationUrl,
    originalTitle,
    honestSummary: spec.honestSummary,
    displayTitle: formatted.displayText,
    hoverTitle: formatted.hoverTitle,
    unbaited: true,
  };
}

function buildStatements(spec: DemoChunkSpec, index: number): Statement[] {
  return spec.statements.map((statement, i) => ({
    type: statement.type,
    summaryText: statement.summaryText,
    analyses: statement.analyses.map((a, j) => buildModule(a, `${index}-s${i}-${j}`, spec.title)),
  }));
}

function chunkHtml(spec: DemoChunkSpec): string {
  if (spec.kind === 'teaser') return teaserHtml(spec);
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

/**
 * A link to a story on somebody else's page: a feed card, a related-stories box, a
 * chumbox. Click Unbait rewrites the anchor's text, so the headline has to *be* an
 * anchor — a `<p>` of post text would give findTitleTarget() nothing to work with.
 */
function teaserHtml(spec: DemoChunkSpec): string {
  const href = spec.link?.href ?? '#';
  const headline = spec.link?.title ?? spec.title;
  return `<article class="teaser" data-testid="teaser">
    <h3 class="teaser-title"><a href="${href}">${headline}</a></h3>
    <footer><span class="link-site">${spec.link?.site ?? spec.source}</span> · <span class="author">${spec.byline}</span> · <time>${spec.time}</time></footer>
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
    tags: ['chunk-type:post'],
    isPrimary: index === 0,
  });
  const analyses = spec.analyses.map((a, i) => buildModule(a, `${index}-${i}`, spec.title));
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
  const seg = normalised.split('/').filter(Boolean).pop() ?? '';
  // `npx serve` clean-urls redirects foo.html → /foo; match either form.
  return seg.replace(/\.html?$/i, '');
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

/**
 * The offline mirror renders the DOM that `buildChunk` assumes, so its xpaths are real
 * there. On the live site they are not: `/html/body/main/article[1]` does not exist on
 * x.com, and handing it out put the nutrient label — and the popup's highlight — on nothing
 * at all, silently. A canned chunk standing in for a page we could not chunk has no element
 * to point at, and must say so rather than guess.
 */
function isOfflineMirror(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function withoutMirrorXpath<T extends { xpath?: string }>(item: T, url: string): T {
  return isOfflineMirror(url) ? item : { ...item, xpath: undefined };
}

export function demoChunks(url: string): Chunk[] {
  return findDemoPage(url)?.chunks.map((c) => withoutMirrorXpath(c.chunk, url)) ?? [];
}

export function demoAnalyses(url: string): ChunkAnalysis[] {
  return findDemoPage(url)?.chunks.map((c) => withoutMirrorXpath(c.analysis, url)) ?? [];
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
      results.push(replayOnto(entry, live, url));
    }
  }

  if (results.length) return results;
  // Nothing matched: hand back the canned chunks, minus an xpath the live DOM will not have.
  return page.chunks.map((entry) => ({
    ...entry,
    canned: true,
    chunk: withoutMirrorXpath(entry.chunk, url),
    analysis: { ...withoutMirrorXpath(entry.analysis, url), url },
  }));
}

/** Keep the live chunk's identity — the on-page label is placed by its xpath — and swap in
 *  the canned analysis. */
function replayOnto(entry: DemoChunk, live: Partial<Chunk>, url: string): DemoChunk {
  return {
    ...entry,
    chunk: live as Chunk,
    analysis: {
      ...entry.analysis,
      chunkId: String(live.id ?? live.fingerprint ?? live.xpath ?? entry.analysis.chunkId),
      fingerprint: live.fingerprint ?? entry.analysis.fingerprint,
      xpath: live.xpath ?? entry.analysis.xpath,
      title: live.title ?? entry.analysis.title,
      // The page this verdict is for, not the canonical demo URL: the content script
      // drops results belonging to a page it has navigated away from, and on the
      // offline mirror the two differ.
      url,
    },
  };
}

function pickLiveChunks(
  entry: DemoChunk,
  chunks: Partial<Chunk>[],
  taken: Set<Partial<Chunk>>,
  exactMatch: (entry: DemoChunk, live: Partial<Chunk>) => boolean = matchesDemoChunk
): Partial<Chunk>[] {
  const free = chunks.filter((c) => !taken.has(c));
  const matched = free.filter((c) => exactMatch(entry, c));

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

// --- headlines matched on any page ---
//
// Click Unbait acts on the link you have not clicked yet, so its demo cannot be keyed to a
// page URL the way the others are: the headline has to be recognised wherever it turns up —
// a feed, a search-results page, a related-stories box. These entries are matched by their
// headline and replayed onto whichever live chunk carries it.

const DEMO_LINK_SPECS: DemoChunkSpec[] = [CLICKBAIT_TEASER];

export const DEMO_LINKS: DemoChunk[] = DEMO_LINK_SPECS.map((spec, i) => {
  const built = buildChunk(spec.link?.href ?? '', spec, i);
  // These match on pages we know nothing about, so buildChunk's mirror xpath is not just
  // wrong here, it is dangerous: the live chunk's own xpath is the only one that can be right.
  return {
    ...built,
    chunk: { ...built.chunk, xpath: undefined },
    analysis: { ...built.analysis, xpath: undefined },
  };
});

/**
 * Headline-only match. Deliberately narrower than matchesDemoChunk: no xpath or fingerprint
 * comparison, because this entry is offered to every page on the web and an arbitrary page
 * can share `/html/body/main/article[1]` with the offline mirror by coincidence. It cannot
 * share the headline by coincidence.
 */
function matchesDemoLinkTitle(entry: DemoChunk, live: Partial<Chunk>): boolean {
  return !!live.title && matchKey(live.title) === matchKey(entry.chunk.title);
}

/**
 * A link teaser is its headline plus a little furniture: a site name, a byline, a
 * standfirst. A chunk several times longer is a container that happens to hold the headline
 * — a whole feed, a whole sidebar — and rewriting inside it, or badging it, puts the mark on
 * the page instead of on the link. Only gates the marker fallback: a chunk whose *title* is
 * the headline is the link (or the story itself), however much text came with it.
 */
const MIN_HEADLINE_SHARE = 0.35;

function isMostlyHeadline(entry: DemoChunk, live: Partial<Chunk>): boolean {
  const liveLength = matchKey(live.text).length;
  if (!liveLength) return false;
  return matchKey(entry.chunk.title).length / liveLength >= MIN_HEADLINE_SHARE;
}

/**
 * Canned results for demo headlines appearing as links on the page being analysed. One
 * result per live chunk carrying the headline; everything else on the page is left alone,
 * for the caller to run the real pipeline over.
 */
export function demoLinkResultsForChunks(url: string, chunks: Partial<Chunk>[] = []): DemoChunk[] {
  const taken = new Set<Partial<Chunk>>();
  const results: DemoChunk[] = [];
  for (const entry of DEMO_LINKS) {
    for (const live of pickLiveChunks(entry, chunks, taken, matchesDemoLinkTitle)) {
      if (!matchesDemoLinkTitle(entry, live) && !isMostlyHeadline(entry, live)) continue;
      taken.add(live);
      results.push(replayOnto(entry, live, url));
    }
  }
  return results;
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
    .teaser { background: #fff; border: 1px solid #dfe2e6; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .teaser-title { margin: 0 0 8px; font-size: 18px; line-height: 1.3; }
    .teaser-title a { color: #14335c; text-decoration: none; }
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
