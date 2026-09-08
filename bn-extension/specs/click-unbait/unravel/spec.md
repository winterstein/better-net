# Click Unbait — Unravel

## Overview

For chunks already flagged as clickbait, fetch the linked page, ask the LLM for a short honest summary, and rewrite the on-page link/title as `[honest summary] original title`. Keeps the bait visible but prepends the payoff so users can decide without the click. Surfaces a nutrient label so the rewrite is obvious.

Settings module: `clickUnbait`. Product tag: `clickbait`.

## Status

working end-to-end in the default configuration (local mode, no model downloaded, no API
key). Measured on live pages: upworthy.com 12 of 26 chunks rewritten, bbc.co.uk/ 2 of 50.

Target tags (terminology.md):

- clickbait — signal scorer + optional remote LLM (working)

Remedy: destination fetch + honest summary prefix (working). Non-product diagnostics
(signal ids, quiz out of scope, unbaited) live in metadata, not tags[].

v1 shipped the four steps but only the formatter worked. Detection scored 0 on every
headline on upworthy.com and buzzfeed.com; the destination picker took the chunk's first
link, which on a card grid is the *next* card's story; the extractor's 4,000-character head
slice landed entirely in nav and never reached the article; and in local mode the "honest
summary" was the destination's `<title>`, which is the same clickbait headline — so the
page read `[bait] bait`. All four are fixed and covered by tests.

## Relevant links

- Detection signals: `src/features/click-unbait/clickbait-signals.ts`
- Labelled corpus: `test-data/clickbait-headlines.json`
- Headline → link resolution: `src/chunking/headline-link.ts`
- Settings module id: `clickUnbait` (`src/settings/defaults.ts`)
- Product tag: `clickbait` (`terminology.md`, `ModuleAnalysis.tags`)
- Feature: `src/features/click-unbait/`
- DOM rewrite: `src/content/apply-click-unbait.ts`
- Shared analysis: `src/ai/run-feature-analysis.ts`, chunk tags / analysis pipeline
- Related: nutrient labels (fact-checker / anti-manipulation pattern)

## Examples

Happy path (search result / headline link):

1. Chunk is tagged clickbait (existing analysis pathway).
2. Extension loads the destination URL for that chunk’s link.
3. LLM returns a short honest summary of what the page actually says.
4. On-page text becomes e.g.  
   `[Try a healthy breakfast] The One Thing You're Doing Wrong Each Morning`
5. Nutrient label marks the chunk as clickbait / unbaited.

Long title:

- Always `[summary] original title`, with the original kept whole — an `…` where the headline used to be is a second curiosity gap.
- The length cap applies to the original alone (`DEFAULT_MAX_TITLE_LEN`), so a longer summary never eats into the headline.
- Only a runaway original (past the cap) is truncated, cut back to a word break, with the full original on hover (`title` attribute).

## Detection

By curiosity-gap structure, not by catchphrase. What modern clickbait shares is that the
headline names the *reaction* to the payoff rather than the payoff: "…and it's eye-opening"
rates a list it has not shown you; "reveals the fastest way to change your life" promises a
method and withholds it; "And He Has Just 1 Wish" counts a thing without naming it. A
straight news headline spends its words on the outcome instead ("Bank of England holds
interest rates at 4.5%"), which is what the concreteness credit recognises.

Sixteen weighted signals, a concreteness credit capped so it cannot cancel a strong stack,
and a lone *weak* signal discounted — soft feature writing on a straight news site trips one
routinely, and labelling those teaches readers to ignore the label.

Deliberately **not** routed through the on-device model. Measured on real headlines both
local options are worse than the signal scorer: MobileBERT zero-shot with this feature's
label pair is anti-correlated (a plain BBC headline scored 0.52; Upworthy's Harvard Post-it
headline scored 0.15), and FLAN-T5-Small answers the JSON detection prompt by repeating the
headline back. Remote LLMs (`openai` / `anthropic`) still run the prompt, with the signal
scorer as the fallback.

Held out from tuning: dailymail.co.uk flagged 5 of 34 — three affiliate teasers, one
"reveals astonishing details", one borderline — and left every hard-news headline alone.

## Out of scope

- Quizzes and personality tests. Engagement bait, but there is no withheld answer sitting on
  a destination page, so there is nothing honest to put in the brackets. `isQuizHeadline`
  scores them 0.
- Rewriting images, thumbnails, or video titles
- Infinite-scroll re-fetch / re-unbait as the page grows (v1: initial pass only)
- Server-side cache of rewrites
- Changing where the link goes (URL stays the same)

## Build plan

1. Wire `clickUnbait` into the feature analysis pipeline; emit product tag `clickbait`.
2. For clickbait-tagged chunks with a usable link: background/offscreen fetch destination HTML (or extractable text); skip quietly on failure / non-HTML / blocked.
3. LLM prompt: given destination content + original title → short honest summary (bracket-ready).
4. DOM rewrite: `[summary] original`; truncate original when over a length budget; `title` hover = full original.
5. Nutrient label on rewritten chunks (same pattern as other modules).
6. Respect module toggle + Off-List.

## Test plan

`test/click-unbait.test.ts`:

- Detector, against `test-data/clickbait-headlines.json` — 131 real headlines captured from
  live upworthy.com and buzzfeed.com and from the saved BBC pages, hand-labelled
  `bait` / `plain` / `quiz` / `unclear`. Asserts recall ≥ 90% on `bait` and at most 2 of 61
  `plain` headlines flagged. A regression that reintroduces the old catchphrase list is
  invisible without this.
- Destination selection: matching link text, matching slug when the anchor has no text,
  furniture rejected, `primaryLink` preferred over the link list, and **null when nothing
  matches** — no link beats the wrong link.
- `findHeadlineLink` on the card-grid shape that caused the off-by-one: story anchor wrapping
  the image, before the heading in document order, headline only in `aria-label`.
- Extraction: numeric entities, site-suffix stripping, furniture dropped so the article
  survives the cap, JSON-LD `articleBody` preferred.
- Echo guard: the exact `[bait] bait` string the old heuristic produced must yield no rewrite.
- Cache and per-page fetch budget.
- Formatter: normal, long original (truncation + hover), empty summary.

Manual: enable the module, open upworthy.com or buzzfeed.com, confirm rewrites and labels;
open a straight news front page, confirm it stays nearly silent; disable, confirm no change.

## Architecture invariants

Enforced by tests, because both have been broken once already:

- **No feature hard-codes a provider name.** `llm-client.ts` owns the `PROVIDERS` registry;
  everything else asks `isRemoteProvider(mode)` or calls `createLLMClient` and checks for
  null. Adding a provider is one registry entry plus a client class. A feature carrying
  `mode === 'openai' || mode === 'anthropic'` would silently fall back to heuristics for the
  new provider instead of failing — the worst kind of regression to find.
- **Every detection signal carries its own description.** `singular_tease` was added to the
  scorer and forgotten in a separate description map, so every headline it caught alone read
  "sensational framing".

Two related rules that fall out of the same thinking: an explicitly injected `llmClient`
always beats `mode` (`run-feature-analysis.ts`), and model capability comes from
`canGenerate` / `canClassify` in the catalog rather than a regex over the pipeline name.

Summary tiers are an ordered list, not an if/else chain, so every candidate — remote, local
or the page's own description — passes the same `acceptSummary` gate, and an unavailable
tier falls through to the next instead of skipping the rest.

## Known limits

- One false positive in the corpus: "People shared what they loved about their childhood
  home. An overwhelming number said trees." is bait-shaped but answers itself in its last
  three words.
- The heuristic summary tier is the publisher's own `og:description`. Honest and specific,
  but it is the publisher's framing, not an independent reading of the article.
- FLAN-T5 (small and base) produces an extractive sentence rather than the withheld payoff.
  Better than the bait repeated, short of the goal. Remote models do the job properly.
