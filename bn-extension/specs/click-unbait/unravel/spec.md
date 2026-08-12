# Click Unbait — Unravel

## Overview

For chunks already flagged as clickbait, fetch the linked page, ask the LLM for a short honest summary, and rewrite the on-page link/title as `[honest summary] original title`. Keeps the bait visible but prepends the payoff so users can decide without the click. Surfaces a nutrient label so the rewrite is obvious.

Settings module: `clickUnbait`. Aspect: `AspectType.CLICKBAIT`.

## Status

in progress — v1 implemented (detect via analysis pathway → fetch → rewrite + nutrient label)

## Relevant links

- Settings module id: `clickUnbait` (`src/settings/defaults.ts`)
- Aspect: `AspectType.CLICKBAIT` (`src/types/AspectAnalysis.ts`)
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

- Prefer `[summary] original title`.
- If too long: keep the summary, truncate the original with `…`, full original on hover (`title` attribute).

## Out of scope

- Detecting clickbait (reuse existing chunk tagging / analysis pathway)
- Rewriting images, thumbnails, or video titles
- Infinite-scroll re-fetch / re-unbait as the page grows (v1: initial pass only)
- Server-side cache of rewrites
- Changing where the link goes (URL stays the same)

## Build plan

1. Wire `clickUnbait` into the feature analysis pipeline; map module → `AspectType.CLICKBAIT` in aspect maps if missing.
2. For clickbait-tagged chunks with a usable link: background/offscreen fetch destination HTML (or extractable text); skip quietly on failure / non-HTML / blocked.
3. LLM prompt: given destination content + original title → short honest summary (bracket-ready).
4. DOM rewrite: `[summary] original`; truncate original when over a length budget; `title` hover = full original.
5. Nutrient label on rewritten chunks (same pattern as other modules).
6. Respect module toggle + Off-List.

## Test plan

- Unit: rewrite formatter — normal, long original (truncation + hover), empty/failed summary (no rewrite or leave original).
- Unit: only acts on chunks already tagged clickbait; ignores others.
- Integration / fixture: mock destination fetch + LLM → assert rewritten link text and nutrient label on a sample search/article chunk.
- Manual: enable module, open a page with known clickbait headlines, confirm rewrite + label; disable module, confirm no change.
