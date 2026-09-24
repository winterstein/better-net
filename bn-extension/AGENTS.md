# bn-extension — agent guide

Read the monorepo guide first: `../AGENTS.md`. It covers layout, conventions, writing style, and workflow. This file only adds package-specific notes.

MV3 browser extension — the main product. Early prototype, so `status.md` is the source of truth for what works vs broken.

## No need to protect legacy data

This project is early stage. It can change data-types and tags without having to preserve legacy data.

## Key files

- `status.md` — read before work, update after meaningful changes
- `specs/` — product specifications
- `terminology.md` — module and concept names
- `code-guidelines.md` — code style and review principles
- `README.md`, `QUICKSTART.md` — build and load instructions

## Layout

- `src/features/<feature>/` — user modules (fact-checker, click-unbait, …); ids match settings
- Ad blocker lives in `src/ad-blocker/` (not under features/)
- `src/chunking/`, `src/analysis/engine.ts`, `src/ai/` — the shared pipeline: chunk page, analyze chunks, adjust page content
- `src/background/`, `src/content/`, `src/options/`, `src/popup/` — MV3 entry points
- `test/` mirrors `src/`; `test_integration/`, `e2e/` for slower suites

## Commands

```bash
npm install && npm run build && npm test
```
