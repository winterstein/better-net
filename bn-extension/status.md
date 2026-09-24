# bn-extension status

**v0.4.36** (manifest, auto-increment on build) / **v0.1.0** (package.json)

## Works

- MV3 extension shell: background worker, content script, popup, options
- **Module / Tag terminology**: analysis results are `ModuleAnalysis` with product `IssueTag[]`
  (`strength` high|medium|low|none, `problemScore` high|medium|low — see `terminology.md` /
  `types/Score.ts`); feedback target is `module` (legacy `aspect` accepted by bn-server).
  Chunk roles use `chunk-type:…` on `chunk.tags[]`; Ad Blocker `advert` / `sponsored` are
  modifiers on the same array, as is `product` (the chunk offers something for sale — a shop
  listing, or a commercial landing page's main chunk).
- **Content classification — routing + page type**: `specs/content-classification.md`.
  Vocabularies in `types/Classification.ts` (site / page / chunk role / modifier, each answer
  carrying confidence + which classifier said so, gated at 0.5). `features/module-routing.ts`
  is the one routing table: each module declares the chunk roles it wants, the modifiers that
  veto it, and the page types it must not touch; `registry.ts` exposes it as `appliesTo` and
  `engine.ts` enforces it, recording every skip on the chunk span as
  `betternet.routing.skipped` so a missing analysis is explainable in AIQA. Adverts no
  longer get fact-checked, bias-checked, or unbaited, and a `product` chunk gets the
  fact-check and the dark-pattern check but not bias or toxicity — nothing assigns that
  modifier automatically yet, but the modal offers it and routing honours it. `classify/page-type.ts` derives page
  type in the content script — password field / checkout-login URL first, then JSON-LD
  `@type`, `og:type`, URL shape, DOM shape — and a confident `login` or `checkout` page gets
  no content analysis at all, with the reason shown in the popup's diagnostics banner.
  Unknown means analyze: a chunk with no role and a page we could not read are both still
  analysed, because silent under-analysis is the worse error.
  The page type is shown and correctable in the Content Analysis modal's "This page"
  section (feedback target `page`, a select since a page has one type); a correction goes
  to bn-server as two statements — old type off, new type on — and is applied locally, so
  routing follows the user for whatever is analysed next. Developer Mode shows which
  classifier answered and how sure it was.
- **TypeScript**: all `src/` modules are `.ts`; esbuild bundles entrypoints to `.js` in `dist/`; `npm run type-check` (`strict: false`, tighten later)
- **Build**: `npm run build` bundles background, content, offscreen, options, popup, settings defaults + copies WASM
- **Tests**: `npm test` (via `tsx`) — chunking, chunking on real saved pages, chunk-tags, chunk-title, module routing, page type, mock fact-check, Facebook ad-blocker, local model client + model-manager; `npm run test:e2e:smoke` — fast Playwright checks (service worker, popup, options); `npm run test:e2e` — smoke + fixture analysis; `npm run test:online` — Playwright on live sites (network); `npm run test:mobilebert` — real MobileBERT download (manual, not CI)
- Page chunking: platform extractors (Google, DuckDuckGo, Facebook, Reddit, Threads, Bluesky, **X**) + regex fallback;
  single-page apps render after `load`, so chunking now retries on a backoff (0/0.5/1/2/4s) until
  content appears — x.com returned 0 chunks on every visit before this. `chunking-headlines.ts`
  adds the teaser headlines around a story (ticker, sidebar, related posts): they sit below
  `minTextLength` so they were never labelled. Selector-free (same-site link + headline-shaped
  text, furniture and in-article links excluded), so it works beyond one theme. Items inside a
  rotating ticker are skipped: the strip clips the label and cycles, so a badge there is either
  invisible or sitting over a different headline; chunks carry `tags[]` (`advert`, `article`, `post`, `search_result`, …) and heuristic `title` (first h1/h2/h3 in chunk HTML, else first sentence); advert tag drives ad-blocker partition; tags shown in chunk detail modal
- Analysis orchestration: per-feature folders (`factChecker`, `biasDetector`, `antiManipulation`, `defuseRagebait`, `clickUnbait`) + Google fact-check when keyed; shared `ai/llm-client.ts` + `ai/run-feature-analysis.ts`; chunk **Content Analysis** modal title includes truncated chunk title when available
- **Click Unbait (unravel)**: clickbait-scored chunks → fetch destination → `[honest summary] original title` rewrite + nutrient label; module toggle / Off-List via analysis pipeline. The original headline is kept **whole**: the cap (`DEFAULT_MAX_TITLE_LEN`, 140) applies to the original alone, so a wordier summary never eats into it, and only a runaway headline is truncated — cut back to a word break, full original on hover.
  Working end-to-end in the **default** configuration (local mode, no model downloaded, no
  API key): live upworthy.com rewrites 12 of 26 chunks, bbc.co.uk/ 2 of 50 — and both BBC
  hits are real bait (`An unthinkable tragedy changes a woman's life forever` turns out to
  be a Jenna Coleman drama). Detection is a curiosity-gap scorer
  (`clickbait-signals.ts`), measured against `test-data/clickbait-headlines.json`: 131 real
  hand-labelled headlines, 95% recall on the 41 `bait` rows, 1 false positive in 61 `plain`
  rows. Quizzes are scored 0 — engagement bait, but with no withheld answer on a destination
  page there is nothing honest to put in the brackets
- Popup: expand page chunks list; click chunk to highlight on page
- **Analysis scheduling** (`specs/analysis-scheduling.md`): the first label arrives sooner on
  a long page. Chunks are analysed biggest-and-highest-first
  (`content/chunk-scheduler.ts`), chunks below the fold wait until they scroll into view
  (IntersectionObserver, 600px margin; off switch in Settings -> AI Model; a chunk with no
  box on the page cannot be observed, so it is analysed at once rather than lost), and the
  background analyses them as a stream of passes over a queue that takes work mid-flight
  (`analysis/engine.ts` createChunkQueue) rather than one fixed batch. Each pass publishes a
  cumulative result, so the popup shows live counts — found / analysed / in progress /
  waiting until you scroll — and results that fill in as the page is read. A superseded page
  view (SPA navigation) no longer publishes its results over the current page. Demo pages
  are exempt from gating, so recordings analyse the whole page at once
- **Nutrient Label headline**: the badge (and the modal's "Overall") reads the worst module
  score, not the mean of all of them, from the same bands as the traffic light
  (`riskLevelForScore`). The page verdict in the toolbar/popup uses the same rule: worst
  chunk, not the mean of modules. Averaging let a mild module cancel a severe one.
- **Nutrient Label threshold**: Settings -> AI Model -> *Label content rated* picks the lowest risk band that earns a label (Safe / Caution / High Risk). Default Caution, so safe chunks are unlabelled. Bands live in `src/types/RiskLevel.ts` and drive both the traffic light and the threshold; changes apply to open tabs without a reload
- **Chunk overlay** (debug aid, Settings -> Advanced -> *Show chunk overlay*): draws a
  transparent coloured box with `#index chunk-id` over every chunk the page produced, so
  chunking can be seen rather than inferred from console text — wrong element, a box round a
  whole page region, two chunks over one headline, a teaser never chunked. Colour is a hash
  of the chunk id, so a box keeps its colour across redraws; hover gives tags and xpath;
  `pointer-events: none` so the page stays usable. Toggling applies to the open page without
  a reload. `src/content/chunk-overlay.ts`
- **Toolbar badge**: per-tab progress (`…` while analyzing, count when done); popup shows stage detail (no on-page “Analyzing page…” overlay)
- **Local models**: Settings → AI Model lists each catalog model with downloaded badge, progress while fetching, **Cancel** while busy, and **Delete download**; download starts async (offscreen) so the button is not blocked by multi‑minute HF fetches.
  Lifecycle status lives in `src/ai/model-status.ts` and is shared by the worker, offscreen,
  background and Settings. `loading` was split into `downloading` (fetching bytes) and
  `initialising` (building the ONNX session, after a download or on a warm load), plus an
  `installed` flag: a teardown now sends an initialising-but-installed model back to `ready`
  instead of `not_installed`, so Clear runtime memory no longer offers a re-download of
  weights that never left the cache. Cancel and Clear runtime memory are one
  `resetBusyModels` helper that writes storage *while the offscreen document is down* — a
  live document is seeded from storage on connect and its next sync overwrites the whole
  map, so resetting after the restart was silently reverted. A failed warm load now posts
  `error` (it used to sit at `loading` forever, silently skipping the model on every later
  page), and the download → initialising switch needs both a near-complete byte count and
  all known files finished, so an under-estimated catalog size cannot report a running
  download as done
- **Settings** (`options/`): AI Model (incl. local models), Modules, Off-List, Account, Data Sharing (incl. server cache + AIQA tracing toggles), Advanced (Developer Mode, chunk overlay, server endpoint, AIQA API key / server / sampling). Diagnostic `logit()` output is off unless Advanced → Developer Mode is on; the pre-v0.5 `consoleLogging` value is migrated on start (`settings/migrate-settings.ts`)
- **Feedback** (`specs/feedback.md`): thumbs up/down in the Content Analysis modal on four
  targets — the summary, each feature card, the chunk, and the chunker (page-level). Thumbs
  up submits and is done; thumbs down submits straight away *then* opens preset issue
  buttons for that target ("This isn't clickbait", "This shouldn't be a chunk", …) plus
  Other… with a free-text box. Preset lists are data (`feedback/feedback-issues.ts`) with
  stable ids, so labels can be reworded without breaking counts. Clicking the same thumb
  again retracts. A follow-up issue or note updates the record the thumb created, keyed on a
  client-generated `localId` that makes `POST /api/feedback` an upsert — one thumbs down is
  one row, offline queue included. Needs Data Sharing + a server endpoint.
  Each record carries the AIQA `traceId` and the `spanId` of the exact step (the feature
  call for a module, the chunk span otherwise), and is mirrored onto that trace as a
  `feedback` span — best-effort, bn-server stays the store of record. In Developer Mode the
  confirmation shows the trace id and a link to it; otherwise it just says "Thanks!".
- **Optional account link** (`specs/accounts/user-identity/spec.md`, `src/accounts/`): the
  extension still never requires an account. Linking is offered at the foot of the popup and
  in Options → Account, and each place shows either a *Link this browser* button or
  *This browser is linked to <email>*. Linking is the one-time code flow — no Auth0 SDK in
  the extension, so the local id never leaves it: request a code from bn-server, open
  `app.better-net.com/feedback#link=CODE`, and the webapp redeems it with its JWT. Status
  comes from `POST /api/account/device-status`; a browser with no local id answers "not
  linked" without a server call, and an unreachable server shows no status rather than
  guessing. `account-link-view.ts` holds the wording and is tested
  (`test/account-link.test.ts`).
- **AIQA tracing** (opt-in, Settings -> Data Sharing): page analysis, chunking and AI
  calls traced to AIQA (`aiqa.winterwell.com`). Off unless the toggle *and* an API key
  (Advanced) are set. Span tree: `betternet.analyze_page` -> `betternet.chunk_page` /
  `betternet.analyze_chunk` -> `betternet.feature.<id>` -> LLM span
  (`local.zero_shot`, `local.generate`, `openai.complete`, `anthropic.complete`, or
  `<prompt-id>.<mode>`, with GenAI attributes + token usage) -> for local models,
  `local.load_model` / `local.infer` as timed inside the inference worker (the parent
  span also covers port hops and a first-call model load, so it is not inference time).
  A cold page-level warm also records `local.load_model` under `betternet.analyze_page`
  (cache hits are not traced).
  The feature span records `betternet.analysis.mode` and `.path`, so a chunk that fell
  back to heuristics is distinguishable from one an LLM judged; provider and on-device
  failures are ERROR spans. Click-unbait's destination fetch is
  `click-unbait.fetch_destination`, with status code + status message, content type,
  extraction source, character counts and an `outcome`
  (`ok` / `cache_hit` / `http_error` / `unsupported_content_type` / `timeout` /
  `budget_exceeded` / …); a quiet failure there is normal, so it stays an OK span.
  Attributes carry lengths/scores, never chunk text or prompts. AIQA's `input` / `output`
  headline pair is set on the three spans worth reading as a QA record: the root
  (`host: title` -> summary verdict), each chunk (its headline, blank when it has none ->
  risk + score + flags) and each feature (same headline -> score, confidence, flags and
  the model's own explanation, capped at 240 chars). A chunk's body text is never used as
  a stand-in for a missing headline.
  `src/tracing/`: `tracer-hook.ts` (zero-dep seam used by analysis code),
  `aiqa-tracer.ts` (background only; OpenTelemetry + `aiqa-client`'s exporter),
  `trace-steps.ts` (content-script step timer, keeps OTel out of that bundle).
  See `aiqa-client-request.md` for the browser-support changes wanted in `aiqa-client`.
- **Demo dataset** (`src/analysis/demo-analysis.ts`): canned url -> chunks + `ChunkAnalysis` for
  product-demo recordings. Four real, live URLs: two forming one story — an X post sharing a fake
  news link, and the article it links to ("Study: Bill Gates' Lab Grown Meat Causes Cancer in
  Humans", The People's Voice, plus its two fabricated celebrity sidebar teasers) — all High Risk,
  every verdict citing a published fact-check
  (Lead Stories, Full Fact, Health Feedback) — plus a standalone third example, an X post
  carrying a fabricated statistic with nothing linked ("Out of 50 million Muslims in Europe,
  40 million are on welfare", 259k views in a day), debunked by dpa and Newtral: no dataset
  records religion alongside welfare receipt across Europe, and the number traces to a TV
  presenter's aside in 2012 that a 2013 European Parliament question repeated as fact. Its
  label distinguishes the roughly-right population figure from the invented one. Verified
  end-to-end against the real saved page (`test-data/pages/x.com-post.html`) rather than
  hand-written chunk text.
  Fourth example, **clickbait -> rewritten headline**: Upworthy's "Harvard psychiatrist
  reveals 'the fastest way to change your life' using just one Post-it note" (Cecily
  Knobler, 1 Sep 2026) — borrowed authority, an unbeatable promise, and then the
  withholding: it dangles one Post-it note and will not say what is written on it. (Four
  notes, in fact.) Deliberately the counterweight to the other three: nothing in it is
  false and the technique is real and old (affect labelling), so the chunk lands on
  **Caution** and its one statement is rated *true* — the packaging is the problem, not
  the content. Click Unbait closes the curiosity gap in place, rewriting the link text to
  `[The note says 'awareness'] Harvard psychiatrist reveals 'the fastest way to change your
  life' using just one Post-it note`, with the link still pointing at the story. The
  rewrite is run through the live `formatUnbaitTitle()` rather than written out, so the demo
  cannot disagree with the feature about how the line is built.
  Because clickbait is something you meet *before* you click, this entry is also matched by
  headline on any page: `demoLinkResultsForChunks()` (`DEMO_LINKS`) recognises it wherever
  it turns up as a link — a feed, a search-results page, a related-stories box — and
  background `performAnalysis` serves those chunks from the dataset while the real pipeline
  handles the rest of the page. That match is headline-only (no xpath or fingerprint
  comparison, since the entry is offered to every page), and the marker fallback is gated on
  the headline being most of the chunk, so a whole feed that merely contains it is not
  labelled. URLs last checked live: first three 2026-09-01, clickbait 2026-09-02; recheck
  before recording.
  Offline mirrors: `npm run build:demo` then `npx serve -l 8080 --no-clean-urls demo/` —
  open `http://localhost:8080/shared-fake-news-post.html` or
  `http://localhost:8080/clickbait-headline-link.html` (etc; no `/demo/` prefix).
  `renderDemoPage()` is the HTML source. Wired into background
  `performAnalysis`: with `demoMode: true` in `chrome.storage.sync`, a matching URL serves the
  canned analysis (keeping each live chunk's xpath so labels land in the right place; one entry
  labels every instance of a repeated headline) instead
  of running the pipeline; canned chunks also stand in when the live chunker finds nothing.
  X posts needed their own chunker (`chunking-x.ts`, `data-testid` hooks) — the generic
  chunker found 0 chunks there, so labels had nothing to attach to. Demo entries can carry
  `markers` (distinctive phrases) for pages whose text will not match verbatim.
  `demoMode` defaults to false while we are recording — set `{ demoMode: true }` in sync
  storage for product demos. No UI toggle.
- **Update manager** (v1): bundled snapshots for `domain-off-defaults` and `chunking-xpath-patterns`; seeds `chrome.storage.local`, daily alarm + `BN_UPDATE_DATA` messages (`get` / `list` / `check` / `seed`); remote fetch from `updates.betternet.org` when available

## Recent fixes

- Security and user-facing bugs from a 2026-09 review (auth, sort allowlist, fact-check
  defaults, host matching, deploy, click-unbait, …).
- DRY/docs pass: shared `parseHTML` and `escapeHtml`; demoMode off by default; dead
  analyzer stubs removed; README / QUICKSTART / DEVOPS / webapp README refreshed.
- **Feedback that cannot be sent is saved, not lost**: a tag edit or thumb queues in
  `chrome.storage.local` when the POST fails, so the background now answers
  `{ ok: false, queued: true }` and the modal keeps the edit with "Saved — will send when
  the server is reachable" instead of reporting an error and putting the chip back. Only a
  rejection (sharing off, unknown target, tag outside the vocabulary) undoes an edit. The
  unreachable endpoint is logged, because that is the real fault — and it currently is one:
  the default `serverEndpoint` `https://server.better-net.com` does not resolve (NXDOMAIN),
  and the deploy host serves the AIQA app for that vhost, so no feedback is reaching
  bn-server. DNS + enabling `bn-server/server.better-net.com.nginx` is the fix; until then
  point Settings -> Advanced -> Server endpoint at a running bn-server
- **Analysis scores no longer read NaN%**: the popup multiplied `problemScore` by 100, but
  it is the `high|medium|low` enum now, so every module card showed `NaN%` (and its colour
  band was wrong). It goes through `fractionFromProblemScore()` like the modal does

- **Local model download stuck at ~100%**: after HF bytes finished, progress callbacks kept
  status as `downloading` while ONNX session init ran (or hung), and a dead worker never
  flipped the card to error — so Settings showed "Downloading… 100%" / "Not on device" with
  no Retry or Remove. Now: ≥99% shows "Loading model…"; worker crashes and Clear memory
  clear in-flight states; Cancel on busy cards; 15‑minute download timeout → error + Retry
- **Click Unbait architecture pass** (model swappability, DRY, minimality). The feature layer
  was the only place outside `llm-client.ts` that knew the strings `'openai'` / `'anthropic'`
  — two disjunctions, so adding a provider meant editing Click Unbait or having it silently
  drop to heuristics. `llm-client.ts` now owns a `PROVIDERS` registry and exports
  `isRemoteProvider`; adding a provider is one entry. Also: an injected `llmClient` now beats
  `mode` (`run-feature-analysis.ts` checked `mode === 'local'` first, so a supplied client was
  silently ignored); model capability comes from `canGenerate` / `canClassify` in the catalog
  instead of `/generation/.test(model.pipeline)`; each detection signal carries its own
  description (`singular_tease` had been added to the scorer and forgotten in a separate map,
  so headlines it caught alone read "sensational framing"); the three summary branches became
  an ordered tier list through one `acceptSummary` gate, which also fixes `mode: 'openai'`
  with no API key skipping a downloaded local model; the destination-fetch budget is per page
  rather than one global counter, so a second tab no longer starts already spent; and
  `Chunk.links` is typed `ChunkLink[]` (it claimed `string[]`, while every chunker emits
  objects — that stale type was what the runtime string/`href` handling existed to survive).
  Two quote bugs fell out of the tidy-up: wrapping quotes were stripped one end at a time, so
  `She called it "the best day of her life"` lost its closing mark, and the dangling-quote
  guard only ran on truncated summaries. Both fixed and covered.

- **Click Unbait did not work on any real page — four separate failures, one per step.**
  The demo looked right because `demo-analysis.ts` served that one Upworthy headline from a
  canned dataset; none of the live path ran. Found by running the pipeline against live
  upworthy.com and buzzfeed.com and by running the shipped models on real headlines.
  1. *Detection scored 0 on everything.* The catchphrase list ("you won't believe", "one
     weird trick") flagged 0 of 26 chunks on upworthy.com and 0 of 50 on buzzfeed.com,
     including the demo's own Post-it headline. Every pattern also used a straight
     apostrophe, so `won’t` as actually published never matched. Nor could a model save it:
     MobileBERT zero-shot with this feature's label pair is anti-correlated (plain BBC
     headline `Storm Eowyn: Thousands without power` → 0.52; real bait → 0.015–0.27), and
     FLAN-T5-Small — the shipped default — answers the JSON detection prompt by repeating
     the headline, which parsed to the hardcoded 0.2 fallback and never crossed the 0.4
     threshold. Replaced with `clickbait-signals.ts`, sixteen curiosity-gap signals scored
     against a concreteness credit, and detection no longer routes through the on-device
     model. `parseAIResponse` now falls back to the signal score instead of 0.2.
  2. *The wrong page was fetched.* `pickDestinationUrl` took the chunk's first http link. On
     Upworthy's grid the story anchor wraps the image, sits *before* the heading in document
     order and carries the headline only in `aria-label`, so the generic chunker filed it
     under the previous card and **every** destination was the neighbour's article; on a
     search page the first link was `google.com/preferences`. A wrong-page summary is worse
     than none — it is a confident sentence about a different article. New
     `chunking/headline-link.ts` resolves the headline's own link from the DOM at chunk time
     (`chunk.primaryLink`), and the analysis-side picker scores links by accessible name and
     URL slug and returns null rather than guess. 18 of 18 correct on Upworthy, 0 wrong,
     and the newsletter signup correctly declines (it used to fetch beehiiv's Terms of Use).
  3. *The article never reached the summariser.* `MAX_BODY_CHARS` sliced the first 4,000
     characters of the whole stripped page; on a real Upworthy article the nav, topic list
     and newsletter form fill the first ~5,200 and the story starts at 5,271, so the model
     was being asked to summarise a menu. Extraction now prefers JSON-LD `articleBody`, then
     `<article>`, then `<main>`, drops furniture regions first, and applies the cap to what
     is left. Numeric entities are decoded (`&#039;` was reaching the page) and the site
     suffix is stripped from the title. Plus a URL→content cache, in-flight dedupe and a
     per-page fetch budget, reset per analysis in `performAnalysis`.
  4. *The "honest summary" was the bait again.* `summarizeDestination` only built an LLM
     client for `openai`/`anthropic`, so in the default local mode it fell through to the
     destination's `<title>` — the same clickbait headline the site put on the link. Output
     was `[You won't believe what this Harvard doctor keeps] You won't believe what this
     Harvard doctor keeps on a Post-it note`. Three tiers now: remote LLM, on-device
     `generate` (a plain "summarise this" — the small FLAN-T5 models cannot follow the JSON
     prompt but do pull a real sentence out of the article), then the publisher's own
     `og:description`. All three pass through `acceptSummary`, which rejects a summary that
     merely echoes the headline, so a failed unravel leaves the headline alone instead of
     looking like it worked.
  Also: `applyClickUnbaitRewrite`'s last-resort "first link with >10 characters of text" is
  gone — prepending a summary to a byline is the same failure as summarising the wrong page.

- **Click Unbait rendering**: the display budget was 90 chars *including* the `[summary] `
  prefix, so a normal headline got chopped — `[The note says 'awareness'] Harvard
  psychiatrist reveals 'the fastest way to change your…`. That trailing `…` is a second
  curiosity gap (is the missing part the interesting bit?), and a longer summary silently
  ate more of the headline. Now the cap applies to the original alone and sits at 140, so
  headlines come through whole; truncation is a runaway guard and cuts back to a word break
  rather than mid-word. `format-unbait-title.ts`, spec updated.
- Offline demo mirrors: URLs assumed `/demo/…` under `npx serve demo/`, which 404s (that
  command mounts `demo/` at `/`). Paths are now root-relative; `npm run build:demo` writes the
  HTML.
- **No label on live x.com — three separate causes**, all found from one saved page and a
  console trace:
  1. *Canned demo chunks carried the offline mirror's xpath.* When the live chunker finds
     nothing (x.com had not rendered on the first attempt), the background stands in the
     canned chunks — whose xpath is `/html/body/main/article[1]`, a DOM only
     `renderDemoPage()` produces. On the live site the label and the popup's highlight both
     aimed at an element that does not exist. Canned chunks now carry an xpath only on the
     mirror, so a missing element is visible rather than silent.
  2. *SPA navigation never re-analysed.* `observeNavigation()` had `// this.analyzePage()`
     commented out, so clicking a post from the x.com timeline — the path a demo takes —
     produced no analysis at all. Re-analysis now runs, debounced by 800ms so the view has
     swapped in, clearing the previous page's labels first.
  3. *A navigation was then dropped by the in-progress guard.* `analyzePage()` skipped
     whenever `isAnalyzing`, and an analysis can run for minutes on the local model, so the
     page the reader is now looking at was skipped while the page they had left finished.
     A navigation now supersedes; results are stamped with the page they belong to and the
     content script ignores any that arrive for a page it has left
- **X: our own labels were being chunked as content.** A page saved from a live session shows
  it: `"…View keyboard shortcuts Safe ×"` arrived as chunk text. After an SPA navigation the
  previous run's nutrient labels are still in the DOM, so re-analysis read them back.
  `OWN_UI_SELECTOR` (in `chunking-utils.ts`) excludes them everywhere
- **X's "To view keyboard shortcuts" heading was chunked as a story.** It uses the clip-rect
  visually-hidden pattern (`position:absolute; clip:rect(1px,1px,1px,1px)`, 1px box) with
  hashed class names we cannot enumerate, so `isElementHidden` now detects that *shape*.
  Covers Bootstrap `.sr-only`, GOV.UK and X alike
- **The third demo URL lost its Nutrient Label again — one junk chunk defeated the render
  backoff.** `https://x.com/realMaalouf/status/2094452781843100052` analysed and scored High
  Risk but placed nothing on the page. From the ANALYZE_CHUNKS payload in a console trace:
  `<main>` held only a spinner, the X chunker correctly found 0, and the *headline* chunker
  returned X's "To view keyboard shortcuts" heading. `extractChunksWhenRendered` breaks as
  soon as `chunks.length` is truthy, so that one chunk ended the 0/500/1000/2000/4000ms
  backoff on attempt 1 and the post was never chunked. Three fixes:
  1. `isElementHidden` already knows the clip-rect pattern, but it was only checked on the
     *card* — and `headlineCard` climbs to a visible wrapper, which on an unrendered page is
     nothing less than `/html/body/div`. The candidate is now checked before the climb, so a
     screen-reader-only heading cannot become a chunk on any site.
  2. `looksUnrendered()` (`chunking.ts`): teasers-only, on a site with a platform chunker,
     means "too early" rather than "chunked", so the content script keeps retrying. Off
     platform, teasers really are the content and it does not fire.
  3. The result was then dropped in silence — `content.ts` guarded on `message.data.xpath`
     with no log, and the background's demo log counted the canned fallback as a match. Both
     now say what happened, which is what made this take a saved page to diagnose.
  Regression cover: `test-data/pages/x.com-post-3-loading.html` is the real pre-render DOM
  and must chunk to nothing; `x.com-post-3.html` is the rendered page and must chunk the post
- **Chunking on index pages was unusable**: `splitBySemanticBoundaries` collected text from
  container elements *and* their descendants, so every string was counted once per nesting
  level — the BBC homepage came out as one 4,533-char chunk with the headline list repeated
  four times, and that repeated soup became the fact-check query. It now collects text nodes
  only, anchors each section on the heading that *opens* it (it used to use the heading that
  ended it, so labels landed on the wrong element), collects the section's links/images, and
  splits regions over 2,000 chars. Screen-reader-only text (`Attribution`, `Comments`,
  `Image source,`, `Video, 00:01:03` — BBC's `visually-hidden` spans) is stripped everywhere,
  including in the headline chunker. Live on bbc.co.uk: 50 one-story chunks and readable
  fact-check queries
- **Platform detection was keyed on hashed CSS class names** (`.wLL07_0Xnd1QZpzpfR4W`), which
  change whenever a site is redeployed, so DuckDuckGo results silently fell through to the
  generic chunker even though `chunking-duckduckgo.ts` handled them correctly. Detection is
  now host-based; a wrong guess costs nothing because an empty platform result already falls
  through
- **`npm test` runs the whole chain again.** `test/chunking.test.ts` was red on
  `bbc.co.uk-news.1` and `duckduckgo.com.hello` (11 chunks), and `&&` stopped CI there. The
  DuckDuckGo failures were the platform-detection bug; the BBC one was the fixture builder
  dropping the element a chunk was recorded from (`metadata.elementType`), so the rebuilt page
  had no `<article>`. No expectations were changed
- **Settings edits reverted by the storage read**: the options page renders from defaults
  immediately and re-renders when `chrome.storage.sync.get` resolves; that second render
  overwrote every form field, so a change made in between (e.g. *Label content rated* ->
  "Everything, including Safe") silently snapped back and Save wrote the old value. Controls
  the user has touched are now left alone until Save (`editedControls` / `editedModules` in
  `options.ts`); untouched fields still take the stored value. Regression test in
  `e2e/smoke.spec.ts` via `window.BN_SETTINGS_CONTROLLER`
- Demo analysis no longer forces `feedbackEnabled: false`; Content Analysis modal thumbs follow Data Sharing + server endpoint, same as live analysis
- `showIndicators` ("Show analysis indicators") was stored and shown in Settings but never read by the content script — the checkbox did nothing. Now honoured alongside the new risk threshold
- **Toolbar Badge -> Popup, root cause**: local inference ran on the offscreen document's *main* thread (`wasm.proxy = false`, `numThreads = 1`, no worker). All same-origin extension pages (popup, options, offscreen) share one renderer main thread, so a multi-second WASM inference stopped the popup painting entirely — clicking the badge did nothing until the extension was reloaded. Measured: a 6s burn on one extension page delayed the popup by 5.8s. Fixed by moving all transformers.js/ONNX work to `offscreen/inference-worker.ts` (module worker; ORT loads its jsep runtime via dynamic `import()`); `offscreen.ts` is now a thin message proxy (1.8MB -> 6.9kB) that owns `modelState` and answers `PING`/`GET_STATUS` on its own thread. Regression tests: `e2e/popup-blocking.spec.ts` (`--project=popup`)
- Note: `performance.memory` is main-thread only, so the Settings -> Runtime memory heap figure no longer counts ONNX session weights (they live in the worker isolate); `loadedModelIds` still comes from the worker
- **Toolbar Badge -> Popup reliability**: popup paints its shell before any `await` (was serialising `tabs.query` + `storage.sync` + `storage.local` + a background round-trip behind the spinner, up to ~13s); every startup call goes through `popup-diagnostics.ts` `runStep` (timeout + timed console line); watchdog reports a popup that never becomes interactive; global `error` / `unhandledrejection` handlers replace a blank popup with a readable message; `pagehide` instead of `beforeunload` and polling stops on completed/error/excluded, so a slow teardown cannot make Chrome drop the *next* toolbar click. Popup opens/failures are logged to the service worker console (`POPUP_OPENED` / `POPUP_ERROR`)
- **Local AI timeout / warm**: offscreen ZERO_SHOT/GENERATE timeout raised to 90s; inference requests are serialised so queue wait does not burn the budget; analysis warms (`LOAD_MODEL`) the selected model before chunks so DistilBERT stays resident across pages; a cold warm records `local.load_model` under the page span (cache hits are silent); Popup shows a diagnostics banner when local inference fails and heuristics take over
- **Toolbar badge**: `chrome.action.*` rejections were escaping `try/catch` (they are promises in MV3) — now caught and logged per tab; badge state changes logged once each
- Options hamburger: stay open across settings reload (storage race was closing `nav-open` with no console output)
- Nutrient labels: `problemScore` stays “higher = worse”; zero-shot raw labels go to each feature’s `parseAIResponse`, which emits matching score + explanation. Recalibrated MNLI label pairs to cut false positives on normal news
- Default local model is FLAN-T5 Small so the LLM writes quoted explanations
- Local model download % no longer jumps: aggregate HF multi-file bytes (ignore initiate/done resets); options updates progress in place
- DistilBERT/large-model OOM: restart offscreen before download (fresh WASM heap); dispose other resident pipelines; clearer allocate-buffer error
- Options: Runtime memory panel shows JS heap + models in RAM, with Clear memory (restarts offscreen worker; downloads stay on disk)
- Popup: no longer stuck on "Loading analysis…" when storage/background is slow; passes tabId to background status query
- Options: safer DOM wiring; local-model refresh errors no longer break the page
- Dev stubs at repo root (`popup/`, `options/`, etc.) show build instructions if the wrong folder is loaded in chrome://extensions
- Options page: render nav/settings immediately from defaults; storage/background calls use timeouts so a dead service worker no longer leaves a blank page
- Build: background/options/popup bundle as IIFE classic scripts (required for MV3 service worker without `"type": "module"`)

## Test data

`test-data/clickbait-headlines.json` holds 131 real headlines captured from live
upworthy.com and buzzfeed.com front pages and from the saved BBC pages, hand-labelled
`bait` / `plain` / `quiz` / `unclear`. Not every headline on a clickbait site is clickbait
and a straight news site runs soft feature headlines, so the labels are per-headline, not
per-source; `unclear` rows are excluded from the thresholds rather than fudged.

`test-data/pages/` holds **real pages saved from the browser** (BBC home, BBC article, the
demo fake-news article, and x.com post / profile / feed) plus a small
`<name>.expected.json` of quality expectations (`mustChunk`, `mustNotAppear`,
`primaryChunk`, chunk-count bounds); `test/chunking-pages.test.ts` also applies invariants to
every page: no chunk repeating a 60-character run of itself, no empty or 20k+ chunks, and
every chunk xpath resolving (jsdom, so `document.evaluate` works). Add one with
`node scripts/capture-page.js <url>`; pages that block automation (x.com) are saved by hand —
see `test-data/pages/README.md`. Everything must go through that script: a raw browser copy
still carries the site's own scripts, which boot on load, wipe the saved markup and navigate
away, so the page chunks to nothing and looks like a chunker bug. The test fails with that
instruction if it finds `<script>` in a fixture. Both X demo posts are also matched against
their saved pages in `test/demo-analysis.test.ts`, so a chunking change that stops a label
landing on the post shows up there.

The older `test-data/*.chunking.json` fixtures generate their HTML from the expected chunks,
so the structure that breaks chunking (nav, tickers, teaser lists, screen-reader spans) is
exactly what they lack. Keep them, but add new coverage as pages.

## Still prototype / partial

- **Ad Blocker**: chunker → detect → hide pipeline for generic pages; Facebook feed/sidebar + mutation observer when module + “page ads” enabled; YouTube not implemented yet
- Local models require Chromium with `offscreen` API; first download is large (~25–300 MB per model)
- Firefox build (`manifest.firefox.json`) not wired for local models yet
- Most analysis features still fall back to heuristics when local model not downloaded
- `npm run type-check` is noisy (pre-existing implicit-any errors). `npm test` and `npm run build` are the gates.

## Next

- **Account linking cannot be finished end to end yet**, and this is a tenant-config gap, not
  a code one: the `BetterNet Server API` resource server does not exist in Auth0
  (`better-net.eu.auth0.com`), so the webapp gets no JWT bn-server accepts and the redeem step
  fails. Also wanted there: a post-login Action adding `https://better-net.com/email`, without
  which the linked status has no email to name. See
  `specs/accounts/user-identity/spec.md` build plan step 5.
- **Content classification — the classifiers** (routing and page type are done, above):
  `specs/content-classification.md`. Routing is in place but barely bites yet, because the
  chunker only ever assigns `article` / `post` / `search_result` / `other`: measured on
  `test-data/pages/`, 0 of 550 module calls are routed out. Next, in order of value:
  chunk roles from element semantics (`form`, `cta`, `cookie_banner`, `modal`,
  `headline_link` — the last is Click Unbait's real target and currently lands in `other`),
  and with them the `product` modifier from price patterns + buy/add-to-cart semantics with
  the `product` page type as a prior;
  then site type from a shipped UT1 bundle, which is what turns on the "no analysis on
  banking apps" rule; then topic (IAB Tier 1) for `primaryTopic`, still hardcoded
  `'unknown'`. A labelled page/chunk set is the gate for any of it — the metric is the two
  asymmetric errors (checkout read as article, article read as app), not accuracy.
  `classifier-config.ts` (declarative registry + per-label chain, heuristics as the floor
  and a local structural model as the preferred mode) earns its keep when a level has two
  classifiers to choose between; with one each, the chain is the function body.
- **Algorithm eval** (spec only): `specs/evaluation/algorithm-eval/spec.md` — gold examples in git, AIQA for experiment reporting, step-shaped datasets. No harness yet.
- Wire update-manager bundles into chunking and `isModuleEnabled` (apply `domain-off-defaults` on analysis). Host update manifests on bn-server. Extend ad-blocker (generic pages, YouTube). Wire cookie-cutter, privacy-shield, etc. Chrome Web Store CSP review for `wasm-unsafe-eval`. Polish Facebook/Twitter chunking; server cache. Click Unbait: the heuristic summary tier is
the publisher's own `og:description` — honest, but the publisher's framing rather than an
independent reading; a local model that can actually answer "what is the withheld payoff"
would close that.
