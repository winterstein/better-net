# bn-extension status

**v0.3.x** (manifest, auto-increment on build) / **v0.1.0** (package.json)

## Works

- MV3 extension shell: background worker, content script, popup, options
- **TypeScript**: all `src/` modules are `.ts`; esbuild bundles entrypoints to `.js` in `dist/`; `npm run type-check` (`strict: false`, tighten later)
- **Build**: `npm run build` bundles background, content, offscreen, options, popup, settings defaults + copies WASM
- **Tests**: `npm test` (via `tsx`) — chunking, chunk-tags, chunk-title, mock fact-check, Facebook ad-blocker, local model client + model-manager; `npm run test:e2e:smoke` — fast Playwright checks (service worker, popup, options); `npm run test:e2e` — smoke + fixture analysis; `npm run test:online` — Playwright on live sites (network); `npm run test:mobilebert` — real MobileBERT download (manual, not CI)
- Page chunking: platform extractors + regex fallback; chunks carry `tags[]` (`advert`, `article`, `post`, `search_result`, …) and heuristic `title` (first h1/h2/h3 in chunk HTML, else first sentence); advert tag drives ad-blocker partition; tags shown in chunk detail modal
- Analysis orchestration: per-feature folders (`factChecker`, `biasDetector`, `antiManipulation`, `defuseRagebait`, `clickUnbait`) + Google fact-check when keyed; shared `ai/llm-client.ts` + `ai/run-feature-analysis.ts`; chunk **Content Analysis** modal title includes truncated chunk title when available
- **Click Unbait (unravel)**: clickbait-scored chunks → fetch destination → `[honest summary] original title` rewrite (truncate + hover) + nutrient label; module toggle / Off-List via analysis pipeline
- Popup: expand page chunks list; click chunk to highlight on page
- **Toolbar badge**: per-tab progress (`…` while analyzing, count when done); popup shows stage detail (no on-page “Analyzing page…” overlay)
- **Local models**: Settings → AI Model lists each catalog model with downloaded badge, progress while fetching, and **Delete download**; download starts async (offscreen) so the button is not blocked by multi‑minute HF fetches
- **Settings** (`options/`): AI Model (incl. local models), Modules, Off-List, Account (incl. server endpoint), Data Sharing
- **Chunk feedback** (v1): thumbs up/down per aspect in Content Analysis modal → `POST /api/feedback` when Data Sharing + server endpoint configured; offline queue in `chrome.storage.local`
- **Update manager** (v1): bundled snapshots for `domain-off-defaults` and `chunking-xpath-patterns`; seeds `chrome.storage.local`, daily alarm + `BN_UPDATE_DATA` messages (`get` / `list` / `check` / `seed`); remote fetch from `updates.betternet.org` when available

## Recent fixes

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

## Still prototype / partial

- **Ad Blocker**: chunker → detect → hide pipeline for generic pages; Facebook feed/sidebar + mutation observer when module + “page ads” enabled; YouTube not implemented yet
- Local models require Chromium with `offscreen` API; first download is large (~25–300 MB per model)
- Firefox build (`manifest.firefox.json`) not wired for local models yet
- Most analysis features still fall back to heuristics when local model not downloaded
- No `icons/` in repo (build warns); load unpacked from `dist/chrome/`

## Next

Wire update-manager bundles into chunking and `isModuleEnabled` (apply `domain-off-defaults` on analysis). Host update manifests on bn-server. Extend ad-blocker (generic pages, YouTube). Wire cookie-cutter, privacy-shield, etc. Chrome Web Store CSP review for `wasm-unsafe-eval`. Polish Facebook/Twitter chunking; server cache. Manual pass on live clickbait headlines for Click Unbait.
