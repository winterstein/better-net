# bn-extension status

**v0.3.x** (manifest, auto-increment on build) / **v0.1.0** (package.json)

## Works

- MV3 extension shell: background worker, content script, popup, options
- **Build**: `npm run build` bundles background, content, offscreen + copies WASM
- **Tests**: `npm test` — chunking, mock fact-check, Facebook ad-blocker, local model client + model-manager; `npm run test:mobilebert` — real MobileBERT download + zero-shot (Node, needs network first run)
- Page chunking: platform extractors + regex fallback
- Analysis orchestration: per-feature folders (`factChecker`, `biasDetector`, `antiManipulation`, `defuseRagebait`) + Google fact-check when keyed
- Popup: expand page chunks list; click chunk to highlight on page
- **Toolbar badge**: per-tab progress (`…` while analyzing, count when done); popup shows stage detail (no on-page “Analyzing page…” overlay)
- **Local models**: Settings → AI Model lists each catalog model with downloaded badge, progress while fetching, and **Delete download**; download starts async (offscreen) so the button is not blocked by multi‑minute HF fetches
- **Settings** (`options/`): AI Model (incl. local models), Modules, Off-List, Account, Data Sharing

## Still prototype / partial

- **Ad Blocker**: chunker → detect → hide pipeline for generic pages; Facebook feed/sidebar + mutation observer when module + “page ads” enabled; YouTube not implemented yet
- Local models require Chromium with `offscreen` API; first download is large (~25–80 MB)
- Firefox build (`manifest.firefox.json`) not wired for local models yet
- Most analysis features still fall back to heuristics when local model not downloaded
- No `icons/` in repo (build warns); load unpacked from `dist/chrome/`

## Next

Extend ad-blocker (generic pages, YouTube). Wire cookie-cutter, privacy-shield, etc. Chrome Web Store CSP review for `wasm-unsafe-eval`. Polish Facebook/Twitter chunking; server cache.
