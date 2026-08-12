# bn-server status

## Works

- Fastify REST API: chunk, page, site, user, feedback routes
- Postgres storage; shared types via `src/bn-extension-src` symlink
- **Shared analyzers**: `POST /api/chunk/:id/analyze` runs extension `analysis/engine` + feature modules
- Server defaults: `heuristic` mode when no API keys; `localBackend: null` (no Chrome offscreen)
- `npm run build` compiles shared analyzer subset + server code
- `npm test` includes chunk analyze integration test

## AI layer

- `src/ai/server-analysis.ts` — merge env keys into `AnalysisOptions`
- Shared `bn-extension-src/ai/llm-client.ts` — OpenAI/Anthropic adapters + AIQA trace hook (`BN_AIQA_ENDPOINT`)
- Prompts in `prompts/prompt-text.ts` (Node + esbuild compatible)

## Next

- Wire OpenAI/Anthropic keys in production env for server-side LLM analysis
- Optional: Node local inference backend (transformers.js or sidecar)
- Fix flaky timezone assertion in `test_db.ts`
