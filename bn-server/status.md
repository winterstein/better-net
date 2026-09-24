# bn-server status

## Works

- Fastify REST API: chunk (writes and analyze require a JWT), feedback, account routes
- page/site/user routes exist as in-memory stubs, not production storage
- Postgres storage; shared types via `src/bn-extension-src` symlink
- **Shared analyzers**: `POST /api/chunk/:id/analyze` runs extension `analysis/engine` + feature modules
- Server defaults: `heuristic` mode when no API keys; `localBackend: null` (no Chrome offscreen)
- `npm run build` compiles shared analyzer subset + server code
- `npm test` includes chunk analyze integration test
- Tap allows incomplete coverage (CI was failing at ~87% vs tap's 100% default)
- Server `tsc` includes DOM lib (shared extension features import DOM types via click-unbait)
- **Accounts / Auth0** (`src/auth.ts`, `src/routes/account.ts`): RS256 JWT verified against the
  tenant JWKS, `iss` + `aud` both checked (if `AUTH0_AUDIENCE` is unset the check fails closed
  rather than skipping `aud`), identity keyed on `sub`. Routes: `/link-code` and
  `/device-status` (no JWT — possession of the local id is the credential), `/link` and `/me`
  (JWT). `test/test_accounts.ts` covers all of it with a local keypair standing in for Auth0.
- Access tokens carry no `email`, so `auth.ts` also reads `https://better-net.com/email` —
  the namespaced claim the Auth0 post-login Action adds.
- **Auth0 tenant is now provisioned**: the API (resource server) `BetterNet Server API` /
  `https://server.better-net.com/api` exists (RS256, 24h token), and the post-login Action
  `Add email to access token` is created and deployed. Local dev env (`.env`) has
  `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` and `BN_PSEUDONYM_SECRET` set.
- Prod config fixed in the GitHub `prod` environment and **deployed**: it had pointed at a
  different tenant (`winterstein.eu.auth0.com`) with the Management API as the audience,
  which would have rejected every webapp token. `BN_PSEUDONYM_SECRET` is now set there too —
  it is set once and left alone, since changing it re-pseudonymises everyone. Live server
  answers `/health` 200 and returns a clean 401 (not a 500) on a guarded route with no
  token, which is what a configured server should do.
- **`src/server.ts` loads `dotenv`**, which it did not before: `npm run dev` ignored `.env`
  entirely, so `AUTH0_DOMAIN` was unset and every guarded route 401'd a perfectly valid
  token. Production is unaffected either way (systemd `EnvironmentFile`), but `dotenv` moved
  from devDependencies to dependencies — prod installs with `--omit=dev`, so a runtime
  import of a dev-only package would crash-loop the service.
- **`db_init` serialises table creation on a Postgres advisory lock.** `CREATE TABLE IF NOT
  EXISTS` is not race-safe, and tap runs test files in parallel against one database, so CI
  on a fresh Postgres failed with `duplicate key value violates unique constraint
  "pg_class_relname_nsp_index"`. Reproducible with 4 concurrent `db_init()` processes
  against an empty database.
- The post-login Action is bound to the flow — the tenant log shows an `Update trigger
  bindings` event, and a login issues a token for `https://server.better-net.com/api`.
- **The deploy health check polls** instead of curling once three seconds after restart.
  `db_init`'s first connection wakes Neon's compute from autosuspend, which can outlast a
  fixed sleep: one deploy failed on a server that was in fact serving, and the next passed
  on attempt 2 — so the old check was a coin toss. It gives up early if the unit is not
  active, so a crash loop still fails fast rather than waiting out the full minute.
- Advisory locks work fine through Neon's pooled endpoint (measured: lock in 63ms, unlock
  returns true), so the `db_init` lock is safe against the production database and not just
  local Postgres.

- Chunk create/update/delete and `POST /:id/analyze` require a JWT. `GET /api/chunk?sort=`
  only accepts a fixed list of columns. Item logs no longer include `ownerKey` or SQL values.
  Deploys run on `main` only, with a concurrency group; `npm ci` happens in staging so a
  failed install leaves the live service up.
- DEVOPS.md refreshed (host setup, main-only deploy, Neon, no Elasticsearch).

## AI layer

- `src/ai/server-analysis.ts` — merge env keys into `AnalysisOptions`
- Shared `bn-extension-src/ai/llm-client.ts` — OpenAI/Anthropic adapters + AIQA trace hook (`BN_AIQA_ENDPOINT`)
- Prompts in `prompts/prompt-text.ts` (Node + esbuild compatible)

## Blocked

- `npm test` needs Postgres on `localhost:5432` (`.env.test`); it is not started by the suite.

## Next

- Check `/api/account/me` with a real webapp token from `https://app.better-net.com`. Every
  piece is configured and deployed, but no signed-in call has succeeded anywhere yet, so
  this is the one step that turns the whole account path from inference into a result.
- Wire OpenAI/Anthropic keys in production env for server-side LLM analysis
- Optional: Node local inference backend (transformers.js or sidecar)
