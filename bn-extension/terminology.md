# Extension terminology

Prefer the terminology from this file in docs, comments, and file-naming.

Canonical module ids live in `src/settings/modules-esm.ts`. Analysis features: `src/features/registry.ts`. Specs: `specs/`.

## Pipeline

- Chunk — page region we extract and analyze (article, post, advert, search result, …)
- Module — user-togglable feature e.g. Fact Checker. Modules contain:
   - Analyzer(s) - detect and tag content
   - Remedy - respond to tags e.g. adjusting a clickbait headline. Only a few tags have a remedy; many tags just go into the nutrient label.
- Tags — a specific issue tag (e.g. "clickbait"). Analyzers should output these with a strength (`high` | `medium` | `low` | `none`) and a [0,1] confidence (e.g. 0.95 = 95% = confident) score on a chunk. 
   - "Not tag X" can be conveyed in two ways: via strength:none, and via a "!" prefix e.g. "!clickbait". The "!" prefix is preferred as it can be used in string[] places. Not X will primarily be used for feedback and training. 
   - Binary Tag: a tag which is on/off/unset (e.g. clickbait)
   - key:value Tag (e.g. bias:left, trigger:sexism, chunk-type:article, site-type / page-type).
- Nutrient Label — in-page icon/popup showing analysis for a chunk
- Module problemScore — (`high` | `medium` | `low`), based on the tags
- Trace / Span — AIQA record of one page analysis and the steps inside it (`src/tracing/`)
- Feedback target — what one correction is about: summary, module, chunker, chunk, or page (`specs/feedback.md`)
- Preset issue — the canned "how was it wrong?" buttons shown after a thumbs down

## Modules and Tags

- Content Classifier: classify sites, pages, and chunks.
    - key:value Tags: site-type, page-type, chunk-type (see content-classification.md for values)
- Ad Blocker - hide ads
    - Tags: advert (marks that this chunk is an advert), sponsored (marks advertorials and sponsored articles). These are written onto `chunk.tags[]` for hide/routing (no separate ModuleAnalysis yet).
- Cookier Cutter - cookie / consent UX
    - Tags: consent-ux (marks that this chunk is a cookie consent form)
- Privacy Shield: tracking / privacy
    - No tags on page content - this focuses on js scripts and web requests.
- Click Unbait: honest summary prefix on clickbait links
    - Tags: clickbait (marks a chunk as having a clickbait headline)
- Fact Checker: claims vs fact-check sources. Focuses on news / political / medical / financial claims - ignores mundane facts and everyday statements.
    - Tags: no-claims (this chunk does not contain claims for fact-checking e.g. pure opinion or mundane info), verified-claims (all extracted claims were checked and are correct), false-claim (has a claim that is confirmed false or highly misleading), suspect-claim (has a suspected false claim but not verified either way), fringe-view (e.g. conspiracy theories)
- Bias Detector: political / ideological / commercial bias 
    - Tags: biased (on for any significant bias), bias:neutral, bias:left, bias:right, bias:self (e.g. a company article could be biased towards its own products). Probably other bias:X tags to be added.
- Anti-manipulation: dark patterns, urgency tricks
   - Tags: urgency (pressure to act now), scarcity (e.g. "only 2 left"), sneaky (hidden costs, pre-ticked extras), fear (scaring the user), too-good-to-be-true, phishing
- Ad Revenue: fair ad exchange
    - No tags.
- Defuse Ragebait: outrage-bait / harmful language
    - Tags: ragebait (written to outrage the reader), hate-speech, threat, personal-attack (for over-the-top / nasty vitriolic attacks; legitimate criticism should not be tagged), trigger:X (trigger:racism, trigger:sexism, trigger:lgbt, trigger:country, with sub-tags trigger:country:usa etc, trigger:family-values). Trigger:X tags are for content that will trigger someone who cares about that cause e.g. trigger:sexism would trigger an anti-sexist person (hopefully most of us), trigger:country would trigger a nationalist. Probably other trigger:X tags to be added.

Each module should have a file {module}-tags.ts for defining it's tags.

## UI surfaces

- Toolbar Badge -> Shows status, opens Popup
- Popup — this-domain toggle, page chunk list and results
- Settings — AI model, modules, Off-List, account, data sharing, advanced (Developer Mode)
- Nutrient Label
- Content Analysis modal — Opens from nutrient label. chunk detail, module results, feedback
