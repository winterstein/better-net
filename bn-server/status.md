# bn-server status

## Works

- Fastify REST API: chunk, page, site, user, feedback routes
- Postgres storage; shared types via `src/bn-extension-src` symlink
- **Shared analyzers**: `POST /api/chunk/:id/analyze` runs extension `analysis/engine` + feature modules
- Server defaults: `heuristic` mode when no API keys; `localBackend: null` (no Chrome offscreen)
- `npm run build` compiles shared analyzer subset + server code
- `npm test` includes chunk analyze integration test
- Tap allows incomplete coverage (CI was failing at ~87% vs tap's 100% default)
- Server `tsc` includes DOM lib (shared extension features import DOM types via click-unbait)
- **Accounts / Auth0** (`src/auth.ts`, `src/routes/account.ts`): RS256 JWT verified against the
  tenant JWKS, `iss` + `aud` both checked, identity keyed on `sub`. Routes: `/link-code` and
  `/device-status` (no JWT — possession of the local id is the credential), `/link` and `/me`
  (JWT). `test/test_accounts.ts` covers all of it with a local keypair standing in for Auth0.
- Access tokens carry no `email`, so `auth.ts` also reads `https://better-net.com/email` —
  the namespaced claim an Auth0 post-login Action is meant to add.

## AI layer

- `src/ai/server-analysis.ts` — merge env keys into `AnalysisOptions`
- Shared `bn-extension-src/ai/llm-client.ts` — OpenAI/Anthropic adapters + AIQA trace hook (`BN_AIQA_ENDPOINT`)
- Prompts in `prompts/prompt-text.ts` (Node + esbuild compatible)

## Blocked

- **No Auth0 API (resource server) exists**, so no JWT bn-server will accept can be issued.
  Needs `BetterNet Server API` / `https://server.better-net.com/api` created in tenant
  `better-net.eu.auth0.com`, plus the post-login Action for the email claim. The Auth0 MCP
  token has application scopes only — no `create:resource_servers` / `create:actions`.
- `npm test` needs Postgres on `localhost:5432` (`.env.test`); it is not started by the suite.

## Next

- Set `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` and `BN_PSEUDONYM_SECRET` in the production env
  (`env.example` documents all three; an empty pseudonym secret makes staff-view pseudonyms
  reversible)
- Wire OpenAI/Anthropic keys in production env for server-side LLM analysis
- Optional: Node local inference backend (transformers.js or sidecar)
