# Content Classification — sites, pages, chunks

## Overview

Classify before analyzing. Every analysis feature declares what it applies to, and the
engine filters chunks by type before spending an LLM call. A checkout form does not want a
fact-check; it wants dark-pattern detection. A banking dashboard wants neither.

Three levels (site, page, chunk) and three orthogonal axes:

- Type/genre — what the thing is. Drives which analyzers run. This is the new work.
- Topic/subject — what it is about. Drives thresholds, not routing (`ChunkAnalysis.primaryTopic`).
- Actor/provenance — who published it. Drives trust priors and cache strategy.

Conflating these is the trap: "health" is a topic, "form" is a type, "government" is an
actor, and a page can be all three at once.

## Status

Spec only. Today's state:

- `src/types/Tag.ts` — chunk tags: `chunk-type:…` roles plus `advert` / `sponsored`
  modifiers. No forms, no nav, no cookie banners, no CTAs.
  Cookie Cutter product tag `consent-ux` is separate from a future role `chunk-type:cookie_banner`.
- `src/chunking/chunk-tags.ts` — heuristic assignment: platform name → post/search_result,
  ad-label regex + class/id patterns → advert, else `other`.
- `ChunkAnalysis.primaryTopic` — doc-comment says IAB Tier 1, but `engine.ts` hardcodes
  `'unknown'`. Never populated, never read.
- No site-level or page-level type anywhere. `Page.ts` is url/title/domain/author/description.
- No filtering. `analyzeChunk` in `src/analysis/engine.ts` runs every enabled feature on
  every chunk. Gating is user settings only (module toggle, `domainOverrides`, `excludedSites`).

## Relevant links

- Chunk tags: `src/types/Tag.ts`, `src/chunking/chunk-tags.ts`
- Page metadata: `src/types/Page.ts`
- Routing point: `src/analysis/engine.ts` (`analyzeChunk`), `src/features/registry.ts`
- JSON-LD extraction already written: `src/features/click-unbait/fetch-destination.ts`
- Topic axis: `ChunkAnalysis.primaryTopic`
- Settings gating this composes with: `specs/settings.md` (Off-List, module toggles)

## Site type

One primary value per registrable domain. Stable, cacheable for weeks, keyed by domain.

TODO where does this site taxonomy come from?? Does it link up with 3rd party databases??

- news — newspapers, wire services, broadcast news
- magazine — features, opinion, lifestyle, personal blogs
- social — feed platforms (Facebook, X, Threads, Bluesky, Instagram)
- forum — Reddit, Discourse, Q&A, comment-led communities
- video — YouTube, TikTok, streaming
- ecommerce — retailers, marketplaces, booking
- finance — banks, brokers, insurers, crypto exchanges
- government — gov, regulators, public bodies
- health — clinical providers, health information sites
- education — schools, universities, courses
- reference — wikis, documentation, dictionaries, archives
- search — search engines and aggregators
- app — webmail, dashboards, SaaS UI, productivity tools
- corporate — company marketing and brochure sites
- gambling
- adult
- unknown

Actor/provenance rides alongside as a separate optional field: `publisher` (news org,
retailer, government, individual, UGC platform, unknown). Wikidata is a good seed for the
named-outlet case; most sites will stay `unknown` and that is fine.

## Page type

One primary value per URL. Aligned to schema.org so a page's own markup can answer directly.

- article — NewsArticle, BlogPosting, Article, Report
- listing — CollectionPage: a feed, index, or card grid of teasers
- search_results — SearchResultsPage
- thread — DiscussionForumPosting, QAPage: a post plus replies
- product — ItemPage carrying a Product/Offer
- checkout — CheckoutPage, cart, payment
- form — ContactPage, signup, booking, application, survey
- login — sign-in, registration, password reset, MFA
- profile — ProfilePage
- media — a page whose payload is a VideoObject/AudioObject
- reference — docs, wiki, help, legal, policy
- app — authenticated tool UI with no editorial content
- error — 404, blocked, consent wall with nothing behind it
- unknown

`checkout` and `login` are deliberately separate from `form`: they carry the strictest
privacy rule (below), and they are where dark patterns bite hardest.

TODO where does this taxonomy come from?? 

## Chunk type

Chunk `tags` stay an array, but with structure: exactly one role tag, plus zero or more
modifier tags. `setContentTags` already half-implements this by preserving `advert`
alongside a content tag — make it explicit.

Role tags (extends the current seven):
See Tag.ts

- article, post, comment, search_result, sidebar, other — unchanged
- headline_link — a teaser or card that links elsewhere. Click Unbait's real target;
  currently these land in `article` or `other`.
- review — user or editorial review of a product/place
- product_card — item tile with price/rating
- form — input group: fields plus a submit
- chrome - header, footer, navigation, widgets, etc.
- cta — button or banner pushing one action (subscribe, buy, sign up)
- paywall — subscription/registration wall
- modal — interstitial, newsletter popup, app-install prompt
- media — video/audio content

Modifier tags (orthogonal, may stack):

- advert — paid placement (existing behaviour, keep as modifier)
- sponsored — disclosed native/affiliate content
- ugc — user-generated
- paywalled — truncated behind a wall
- countdown — contains a live timer or scarcity counter

Every chunk gets a role. `other` remains the honest fallback, but it means "we could not
tell", not "unremarkable" — see the unknown-handling rule below.

TODO where does this taxonomy come from?? 

## Routing

Each entry in `src/features/registry.ts` declares an `appliesTo` block; the engine filters
before building tasks. Features may not opt themselves out inside `analyze` — routing lives
in one place so it can be read and evaluated.

factChecker (accuracy)
- Chunk roles: article, post, comment, search_result, headline_link, review
- Skip roles: form, cta, cookie_banner, paywall, modal, nav, media, product_card, sidebar
- Skip modifiers: advert
- Skip pages: checkout, login, app, form, profile, error
- Raise sensitivity on health, finance, and elections topics
- Adverts are skipped for now, despite false health and investment claims being a wanted
  target. Ad slots are inserted dynamically and carry their claim in the image, so the text
  we can reach is usually a brand name and a disclosure label — a hard target that would
  spend calls to find nothing. Revisit when ad chunks can capture the creative.

biasDetector
- Chunk roles: article, post, comment, search_result, headline_link
- Skip roles: everything transactional or furniture
- Skip pages: checkout, login, app, product, form, error

antiManipulation (scams, dark patterns)
- Chunk roles: form, cta, cookie_banner, paywall, modal, product_card, advert, post, article
- Skip roles: nav, comment, search_result, media
- Priority pages: checkout, product, form, login — the inversion of the fact-check list
- The `countdown` modifier is a strong prior, not a verdict: real deadlines exist

defuseRagebait (toxicity)
- Chunk roles: post, comment, article, headline_link
- Skip roles: form, cta, product_card, nav, cookie_banner, paywall, media
- Skip pages: checkout, login, app, product, error

clickUnbait
- Chunk roles: headline_link, search_result, post, article
- Requires a resolved `primaryLink`; without one there is nothing to unravel
- Skip pages: checkout, login, app, form, error

Site-level hard skips (no content analysis at all, regardless of settings):

- Page type `login` or `checkout`, on any site
- Site type `app` or `finance`, unless the user opts in per domain

That is a privacy rule as much as a relevance one: we should not be sending a bank
dashboard or a webmail thread to an LLM. Ad-blocker, cookie-cutter, and privacy-shield are
unaffected — they never read content off to a model.

## How classification is derived

Cheap first, escalate only when the cheap answer is `unknown` and the page looks like content.

Site
1. In-memory + `chrome.storage.local` cache, keyed by registrable domain, TTL ~30 days.
2. A compact category bundle shipped with the extension and refreshed by update-manager,
   built from UT1 (see datasources). Covers the head of the web in a few hundred KB.
3. Heuristics: known platform list (the chunking extractors already name them), TLD
   (.gov, .edu, .bank), and page-level evidence accumulated across visits.
4. `unknown` otherwise. Never a live per-domain lookup — see the privacy note.

Page
1. JSON-LD `@type` from `application/ld+json`. Direct hit for schema-marked pages.
   Extraction already exists in `click-unbait/fetch-destination.ts`; lift it to a shared
   `src/classify/` module rather than copying.
2. `og:type` (article, product, profile, video).
3. URL path patterns (`/checkout`, `/cart`, `/login`, `/search`, `/tag/`, `?q=`).
4. DOM shape: password field → login; form field count and submit semantics → form/checkout;
   `<article>` plus prose length → article; repeated card structure → listing.
5. `unknown`.

Chunk
- Extend the existing `chunk-tags.ts` heuristics: element semantics (`<form>`, `<nav>`,
  `role="dialog"`, button density, price patterns, timer elements) plus the page type as a
  prior — a card grid on a `listing` page yields `headline_link`, the same markup on a
  `product` page yields `product_card`.
- Heuristics first, but this is the level most likely to move to a local model (below).
  Whatever runs here runs on every chunk of every page, so it must stay cheap.

Unknown handling
- Unknown page type + content-shaped page (prose present, no password field, no cart) →
  treat as `article` and analyze. Better to over-analyze an essay than miss it.
- Unknown page type + no content shape → no content analysis.
- Unknown chunk role inside an analyzed page → treat as `other` and skip everything except
  antiManipulation, which is the one feature that copes with unstructured UI.

Confidence is recorded per level (0-1) so evaluation can separate "classified wrong" from
"analyzed wrong". Anything below ~0.5 is treated as unknown.

## Classifiers

Classification is a labelling problem, not a reasoning one, so the long-term aim is a local
classifier: it runs on every chunk of every page, must not cost an API call, and must not
send page content anywhere. Local is the preferred mode once it earns its accuracy, with
heuristics as the floor and remote LLM as an override for the hard cases.

Local does not mean a local LLM. Ranked by fit:

- Structural feature model — DOM features (tag path, field counts, button density, link
  ratio, price/timer patterns) into a small logistic regression or gradient-boosted tree,
  plain JS, no WASM, sub-millisecond. Chunk role is mostly a structural signal, not a
  semantic one, so this is the right shape for it and the cheapest thing to try first.
- Embedding + nearest centroid — sentence embeddings (e.g. MiniLM) against centroids from a
  labelled set. Gets page and chunk type without fine-tuning, and new labels are added by
  adding examples rather than retraining.
- Fine-tuned classification head — DistilBERT/MobileBERT with a real head. Best accuracy,
  needs a labelled corpus first.
- Zero-shot NLI — what we already have, and measured poor for this job: Click Unbait found
  MobileBERT zero-shot anti-correlated on a similar labelling task and FLAN-T5-Small echoing
  the prompt back. Not a starting point.

### Configuration

One file, `src/classify/classifier-config.ts`, holds the whole mapping of classifier to
label. It should be readable end to end without following imports — the question "what
decides whether a chunk is a cookie banner?" must have a one-line answer.

Two tables. A registry of classifiers, each declaring kind, cost, and the labels it can
emit:

```ts
export const CLASSIFIERS = {
  'jsonld':            { kind: 'heuristic', cost: 'free',  emits: PAGE_TYPES },
  'url-shape':         { kind: 'heuristic', cost: 'free',  emits: ['checkout','login','search_results','listing'] },
  'dom-shape':         { kind: 'heuristic', cost: 'free',  emits: PAGE_TYPES },
  'consent-selectors': { kind: 'heuristic', cost: 'free',  emits: ['cookie_banner'] },
  'ad-labels':         { kind: 'heuristic', cost: 'free',  emits: ['advert'] },
  'chunk-role-tree':   { kind: 'local',     cost: 'cheap', model: 'chunk-role-tree-v1', emits: CHUNK_ROLES },
  'page-type-embed':   { kind: 'local',     cost: 'medium', model: 'minilm-l6-v2',      emits: PAGE_TYPES },
  'llm-page-type':     { kind: 'remote',    cost: 'call',  emits: PAGE_TYPES },
};
```

And a chain per label group — ordered, first answer above `minConfidence` wins:

```ts
export const CLASSIFIER_CHAINS = {
  'site.type':           ['domain-bundle', 'platform-list', 'tld'],
  'page.type':           ['jsonld', 'og-type', 'url-shape', 'dom-shape', 'page-type-embed'],
  'chunk.role':          ['element-semantics', 'page-prior', 'chunk-role-tree'],
  'chunk.cookie_banner': ['consent-selectors'],
  'chunk.advert':        ['ad-labels', 'ad-selectors', 'facebook-sponsored'],
  'topic':               ['iab-tier1-embed'],
};
```

Rules that keep this honest:

- Chains are per label group, not per level, so a single stubborn label (cookie_banner,
  advert) can have its own classifier without disturbing the rest.
- Every classifier implements one interface — `classify(input) => { label, confidence }` —
  so heuristic, local model, and remote LLM are interchangeable and a chain entry can be
  swapped by editing one string.
- A classifier that names a `model` resolves it through `src/ai/model-catalog.ts`, and is
  skipped silently when those weights are not downloaded. The chain falls through to the
  next entry, so a fresh install still classifies.
- Cost ordering is enforced: a chain may not put a costlier classifier before a cheaper one.
- Users see this as a mode (Heuristics / Local model / Best available) in Settings, not as a
  chain editor. The per-label detail stays a developer-facing file.

Each chain entry is separately evaluable, which is the point: replacing `dom-shape` with
`page-type-embed` becomes a measured change rather than a rewrite.

## Reusable ontologies and datasources

- schema.org — the page and chunk type vocabulary above, and simultaneously a datasource,
  because sites publish their own `@type`. Roughly half of content pages carry usable
  JSON-LD; the rest need heuristics. Free, stable, already partly parsed in this codebase.
- IAB Content Taxonomy 3.x — the topic axis, already the stated intent of
  `ChunkAnalysis.primaryTopic`, and consistent with privacy-shield's use of IAB TCF. Tier 1
  only. Topics, not types — do not let it do both jobs.
- UT1 blacklists (Université Toulouse, free and open) — domain → category lists covering
  news, shopping, forum, bank, government, adult, gambling, phishing. Best open option for
  seeding the site-type bundle. Cloudflare Radar's domain-intel API is the commercial-grade
  alternative if coverage proves thin.
- Dark pattern taxonomy — use Mathur et al. (2019): urgency, scarcity, social proof,
  obstruction, sneaking, misdirection, forced action. The UK CMA and OECD taxonomies map
  onto it. Gives antiManipulation a vocabulary shared with the research literature and with
  regulators, instead of an invented one. Its categories become `flags` on the
  ModuleAnalysis.tags (issue tags), not chunk role tags.
- Wikidata — outlet provenance (P31 → online newspaper, public broadcaster, government
  agency) for the actor axis, as a curation input rather than a runtime lookup.

Rejected: Curlie/DMOZ (stale), and any commercial URL-categorisation API as a hard runtime
dependency.

## Privacy

Site classification must not become a browsing-history feed. Ship the category bundle
locally and look up offline. If a server lookup is ever added it must be k-anonymous
(hash prefix), opt-in under Data Sharing, and cached hard. Page and chunk classification are
local-only by construction.

## Data model changes

- New `src/types/Classification.ts`: `SiteType`, `PageType`, `ChunkRole`, `ChunkModifier`,
  and a `Classification { value, confidence, source }` wrapper.
- New `src/classify/`: the shared JSON-LD/DOM extraction, the classifier implementations,
  and `classifier-config.ts` (registry + chains, above). `source` on a `Classification`
  records which classifier answered, so a bad label is traceable to one chain entry.
- `Tag.ts`: split `CHUNK_TYPE_TAGS` into role and modifier lists. Keep the existing seven
  values so stored data and the chunk-detail modal keep working.
- `Page.ts`: add `pageType` and `siteType`.
- `Chunk`: role tag guaranteed present after `finalizeChunk`.
- `registry.ts`: `appliesTo: { roles, skipRoles, skipPages, skipSites }` per feature.
- `engine.ts`: filter chunks per feature before building tasks; record skips as trace
  attributes so a missing analysis is visible in AIQA rather than silent.

## Evaluation

Classification is a labelling task, so it belongs in the algorithm-eval harness
(`specs/evaluation/algorithm-eval/spec.md`) rather than getting its own. Needed:

- A labelled page set: URL → site type, page type. Fifty pages spanning news, retail,
  checkout, login, forum, app is enough to catch gross errors.
- A labelled chunk set reusing the saved-page fixtures already in `test-data/`.
- The metric that matters is not overall accuracy but the two asymmetric errors: a checkout
  page classified as `article` (privacy and noise), and an article classified as `app`
  (silent under-analysis). Report those separately.
- Score per chain entry, not just per level. That is what makes "can a local model beat the
  heuristics here" a question with an answer, and it is the gate for promoting a local
  classifier ahead of `dom-shape` or `element-semantics`.

## Out of scope

- Multi-label page types. One primary value; a shopping site's blog is an `article` page on
  an `ecommerce` site, which the two levels already express.
- Per-chunk topic classification. Topic is page-level until there is evidence it needs to
  be finer.
- Language and reading-level detection.
- Re-classification on DOM mutation. Classify once per page load; infinite-scroll chunks
  inherit the page type.
- A user-facing UI for types. Internal routing first; surfacing "this is a checkout page"
  can come later if it earns its place.
