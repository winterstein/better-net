# Extension terminology

Prefer the terminology from this file in docs, comments, and file-naming.

Canonical module ids live in `src/settings/modules-esm.ts`. Analysis features: `src/features/registry.ts`. Specs: `specs/`.

## Pipeline

- Chunk — page region we extract and analyze (article, post, advert, search result, …)
- Module — user-togglable feature e.g. Fact Checker
- Aspect — scored concern on a chunk (accuracy, bias, toxicity, clickbait, …)
- Nutrient Label — in-page icon/popup showing analysis for a chunk
- problemScore — higher = worse
- Trace / Span — AIQA record of one page analysis and the steps inside it (`src/tracing/`)

## Modules

- Ad Blocker - hide ads
- Cookier Cutter - cookie / consent UX
- Privacy Shield: tracking / privacy
- Click Unbait: honest summary prefix on clickbait links
- Fact Checker: claims vs fact-check sources
- Bias Detector: political / ideological bias
- Anti-manipulation: dark patterns, urgency tricks
- Ad Revenue: fair ad exchange
- Defuse Ragebait: outrage-bait / harmful language

## UI surfaces

- Toolbar Badge -> Shows status, opens Popup
- Popup — this-domain toggle, page chunk list and results
- Settings — AI model, modules, Off-List, account, data sharing
- Nutrient Label
- Content Analysis modal — Opens from nutrient label. chunk detail, aspect results, feedback
