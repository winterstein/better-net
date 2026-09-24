# BetterNet extension

MV3 browser extension: chunk pages, analyse for misleading / manipulative content, show
Nutrient Labels. Status of what works: [`status.md`](./status.md).

## Setup

```bash
cd bn-extension
npm install
npm run build          # or build:chrome / build:firefox / build:edge
```

Load unpacked from `dist/chrome` (or `dist/firefox`) in the browser's extensions page.

Optional keys in Settings → Advanced, or `chrome.storage.sync`: `BN_GOOGLE_API_KEY`,
`BN_OPENAI_API_KEY`, `BN_ANTHROPIC_API_KEY`.

## Test

```bash
npm test               # unit suite (tsx)
npm run test:e2e:smoke # Playwright smoke
```

`npm run type-check` is noisy; build + test are the gates.

## Layout

- `src/features/` — user modules (fact-checker, click-unbait, …); ad blocker in `src/ad-blocker/`
- `src/chunking/`, `src/analysis/`, `src/ai/` — shared pipeline
- `src/background/`, `src/content/`, `src/popup/`, `src/options/` — MV3 entry points
- `specs/`, `terminology.md`, `code-guidelines.md`

See also [`QUICKSTART.md`](./QUICKSTART.md) and monorepo [`AGENTS.md`](../AGENTS.md).
