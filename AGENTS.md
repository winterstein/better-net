# BetterNet — agent guide

User-first browser AI: label misleading/toxic content, reduce manipulative UX, and treat advertising as a fair exchange. Monorepo with three packages:

| Package | Role |
|---------|------|
| `bn-extension` | MV3 browser extension (chunking, analysis, popup) — main product |
| `bn-server` | Fastify + Postgres backend (cache, APIs) |
| `bn-webapp` | Vite + React companion UI |

## Specs, Status and docs

- Specifications for the product: per-package in `bn-<name>/specs`
- **Per-package task/status**: `bn-<name>/status.md` — read before work, update when you change scope or fix blockers.
- **Product blurb**: `blurb.md`
- **Extension details**: `bn-extension/README.md`, `QUICKSTART.md`

`bn-extension` is an early prototype (build/analysis wiring incomplete). Treat `bn-extension/status.md` as source of truth for what works vs broken.

## Code Organisation

Use typescript for preference.

Follow KISS and DRY. Code should be simple and modular.

Code can be duplicated between bn-server, bn-webapp, and bn-extension for easier compilation.

### bn-extension 

The main user-level features (settings, ad-blocker, click-unbait, cookie-cutter, privacy-shield, fact-checker, etc) have separate folders in src and test.

Several features share a common pipeline:
1. Chunk page (which can use domain-specific or generic chunking)
2. Analyze chunks via `src/analysis/engine.js` and `src/features/<feature>/` (ids match settings modules, e.g. `factChecker`, `biasDetector`)
3. Adjust page content e.g. adding a Nutrient Label

### bn-server

### bn-webapp


## Conventions

- Keep changes **minimal** and scoped to the package you are touching.
- Match existing style (TypeScript, esbuild in extension; `tsc`/`tap` on server; Vite on webapp).
- Do not commit secrets (`.env`, API keys).
- Commits and PRs only when the user asks.

## Commands (run from package dir)

```bash
# bn-extension
npm install && npm run build && npm test

# bn-server
npm install && npm run build && npm test

# bn-webapp
npm install && npm run dev
```

## When editing

1. Identify the right `bn-*` package.
2. Check that package’s `status.md` (create if missing).
3. After meaningful work, refresh `status.md` (done / blocked / next).
