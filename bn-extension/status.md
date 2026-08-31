# bn-extension status

**v0.3.x** (manifest, auto-increment on build) / **v0.1.0** (package.json)

## Works

- MV3 extension shell: background worker, content script, popup, options
- **TypeScript**: all `src/` modules are `.ts`; esbuild bundles entrypoints to `.js` in `dist/`; `npm run type-check` (`strict: false`, tighten later)
- **Build**: `npm run build` bundles background, content, offscreen, options, popup, settings defaults + copies WASM
- **Tests**: `npm test` (via `tsx`) — chunking, chunking on real saved pages, chunk-tags, chunk-title, mock fact-check, Facebook ad-blocker, local model client + model-manager; `npm run test:e2e:smoke` — fast Playwright checks (service worker, popup, options); `npm run test:e2e` — smoke + fixture analysis; `npm run test:online` — Playwright on live sites (network); `npm run test:mobilebert` — real MobileBERT download (manual, not CI)
- Page chunking: platform extractors (Google, DuckDuckGo, Facebook, Reddit, Threads, Bluesky, **X**) + regex fallback;
  single-page apps render after `load`, so chunking now retries on a backoff (0/0.5/1/2/4s) until
  content appears — x.com returned 0 chunks on every visit before this. `chunking-headlines.ts`
  adds the teaser headlines around a story (ticker, sidebar, related posts): they sit below
  `minTextLength` so they were never labelled. Selector-free (same-site link + headline-shaped
  text, furniture and in-article links excluded), so it works beyond one theme. Items inside a
  rotating ticker are skipped: the strip clips the label and cycles, so a badge there is either
  invisible or sitting over a different headline; chunks carry `tags[]` (`advert`, `article`, `post`, `search_result`, …) and heuristic `title` (first h1/h2/h3 in chunk HTML, else first sentence); advert tag drives ad-blocker partition; tags shown in chunk detail modal
- Analysis orchestration: per-feature folders (`factChecker`, `biasDetector`, `antiManipulation`, `defuseRagebait`, `clickUnbait`) + Google fact-check when keyed; shared `ai/llm-client.ts` + `ai/run-feature-analysis.ts`; chunk **Content Analysis** modal title includes truncated chunk title when available
- **Click Unbait (unravel)**: clickbait-scored chunks → fetch destination → `[honest summary] original title` rewrite (truncate + hover) + nutrient label; module toggle / Off-List via analysis pipeline
- Popup: expand page chunks list; click chunk to highlight on page
- **Nutrient Label threshold**: Settings -> AI Model -> *Label content rated* picks the lowest risk band that earns a label (Safe / Caution / High Risk). Default Caution, so safe chunks are unlabelled. Bands live in `src/types/RiskLevel.ts` and drive both the traffic light and the threshold; changes apply to open tabs without a reload
- **Toolbar badge**: per-tab progress (`…` while analyzing, count when done); popup shows stage detail (no on-page “Analyzing page…” overlay)
- **Local models**: Settings → AI Model lists each catalog model with downloaded badge, progress while fetching, and **Delete download**; download starts async (offscreen) so the button is not blocked by multi‑minute HF fetches
- **Settings** (`options/`): AI Model (incl. local models), Modules, Off-List, Account, Data Sharing (incl. server cache + AIQA tracing toggles), Advanced (console logging, server endpoint, AIQA API key / server / sampling). Diagnostic `logit()` output is off unless Advanced → Console logging is on
- **Chunk feedback** (v1): thumbs up/down per aspect in Content Analysis modal → `POST /api/feedback` when Data Sharing + server endpoint configured; offline queue in `chrome.storage.local`
- **AIQA tracing** (opt-in, Settings -> Data Sharing): page analysis, chunking and AI
  calls traced to AIQA (`aiqa.winterwell.com`). Off unless the toggle *and* an API key
  (Advanced) are set. Span tree: `betternet.analyze_page` -> `betternet.chunk_page` /
  `betternet.analyze_chunk` -> `betternet.feature.<id>` -> LLM span
  (`local.zero_shot`, `local.generate`, `openai.complete`, `anthropic.complete`, with
  GenAI attributes + token usage). Attributes carry lengths/scores, never chunk text.
  `src/tracing/`: `tracer-hook.ts` (zero-dep seam used by analysis code),
  `aiqa-tracer.ts` (background only; OpenTelemetry + `aiqa-client`'s exporter),
  `trace-steps.ts` (content-script step timer, keeps OTel out of that bundle).
  See `aiqa-client-request.md` for the browser-support changes wanted in `aiqa-client`.
- **Demo dataset** (`src/analysis/demo-analysis.ts`): canned url -> chunks + `ChunkAnalysis` for
  product-demo recordings. Two real, live URLs forming one story — an X post sharing a fake
  news link, and the article it links to ("Study: Bill Gates' Lab Grown Meat Causes Cancer in
  Humans", The People's Voice, plus its two fabricated celebrity sidebar teasers) — all High Risk,
  every verdict citing a published fact-check
  (Lead Stories, Full Fact, Health Feedback). URLs last checked live 2026-08-31; recheck
  before recording. `renderDemoPage()` emits an offline mirror. Wired into background
  `performAnalysis`: with `demoMode: true` in `chrome.storage.sync`, a matching URL serves the
  canned analysis (keeping each live chunk's xpath so labels land in the right place; one entry
  labels every instance of a repeated headline) instead
  of running the pipeline; canned chunks also stand in when the live chunker finds nothing.
  X posts needed their own chunker (`chunking-x.ts`, `data-testid` hooks) — the generic
  chunker found 0 chunks there, so labels had nothing to attach to. Demo entries can carry
  `markers` (distinctive phrases) for pages whose text will not match verbatim.
  `demoMode` defaults to true while we are recording — TODO set it false for production. No UI
  toggle; `chrome.storage.sync.set({ demoMode: false })` turns it off
- **Update manager** (v1): bundled snapshots for `domain-off-defaults` and `chunking-xpath-patterns`; seeds `chrome.storage.local`, daily alarm + `BN_UPDATE_DATA` messages (`get` / `list` / `check` / `seed`); remote fetch from `updates.betternet.org` when available

## Recent fixes

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

`test-data/pages/` holds **real pages saved from the browser** plus a small
`<name>.expected.json` of quality expectations (`mustChunk`, `mustNotAppear`,
`primaryChunk`, chunk-count bounds); `test/chunking-pages.test.ts` also applies invariants to
every page: no chunk repeating a 60-character run of itself, no empty or 20k+ chunks, and
every chunk xpath resolving (jsdom, so `document.evaluate` works). Add one with
`node scripts/capture-page.js <url>`; pages that block automation (x.com) are saved by hand —
see `test-data/pages/README.md`.

The older `test-data/*.chunking.json` fixtures generate their HTML from the expected chunks,
so the structure that breaks chunking (nav, tickers, teaser lists, screen-reader spans) is
exactly what they lack. Keep them, but add new coverage as pages.

## Still prototype / partial

- **Ad Blocker**: chunker → detect → hide pipeline for generic pages; Facebook feed/sidebar + mutation observer when module + “page ads” enabled; YouTube not implemented yet
- Local models require Chromium with `offscreen` API; first download is large (~25–300 MB per model)
- Firefox build (`manifest.firefox.json`) not wired for local models yet
- Most analysis features still fall back to heuristics when local model not downloaded
- No `icons/` in repo (build warns); load unpacked from `dist/chrome/`

## Next

Wire update-manager bundles into chunking and `isModuleEnabled` (apply `domain-off-defaults` on analysis). Host update manifests on bn-server. Extend ad-blocker (generic pages, YouTube). Wire cookie-cutter, privacy-shield, etc. Chrome Web Store CSP review for `wasm-unsafe-eval`. Polish Facebook/Twitter chunking; server cache. Manual pass on live clickbait headlines for Click Unbait.
