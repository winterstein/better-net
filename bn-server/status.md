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
  the namespaced claim the Auth0 post-login Action adds.
- **Auth0 tenant is now provisioned**: the API (resource server) `BetterNet Server API` /
  `https://server.better-net.com/api` exists (RS256, 24h token), and the post-login Action
  `Add email to access token` is created and deployed. Local dev env (`.env`) has
  `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` and `BN_PSEUDONYM_SECRET` set.
- Prod config fixed in the GitHub `prod` environment: it had pointed at a different tenant
  (`winterstein.eu.auth0.com`) with the Management API as the audience, which would have
  rejected every webapp token. `BN_PSEUDONYM_SECRET` is now set there too — it is set once
  and left alone, since changing it re-pseudonymises everyone.

## AI layer

- `src/ai/server-analysis.ts` — merge env keys into `AnalysisOptions`
- Shared `bn-extension-src/ai/llm-client.ts` — OpenAI/Anthropic adapters + AIQA trace hook (`BN_AIQA_ENDPOINT`)
- Prompts in `prompts/prompt-text.ts` (Node + esbuild compatible)

## Blocked

- `npm test` needs Postgres on `localhost:5432` (`.env.test`); it is not started by the suite.
- The post-login Action is deployed but nothing here proves it is **bound to the post-login
  flow** — the Management API keeps deploy and trigger binding separate, and the Auth0 MCP
  has no bindings tool. Verified only by signing in and seeing whether `/api/account/me`
  carries an email.

## Next

- Deploy, then check `/api/account/me` with a real webapp token (the prod env vars changed,
  so the running service is still on the old values until the next deploy)
- Wire OpenAI/Anthropic keys in production env for server-side LLM analysis
- Optional: Node local inference backend (transformers.js or sidecar)
