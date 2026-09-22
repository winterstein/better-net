# bn-webapp status

Vite + React companion UI, served from `app.better-net.com`. Read-only views on feedback;
unlike the extension, the whole app requires sign-in.

## Works

- Pages, Chunks, Analyze URL, My feedback, and staff All feedback views
- **Auth0 sign-in** (`src/auth/`): `@auth0/auth0-react`, SPA + PKCE, JWT sent as a Bearer
  header by `services/api.ts`. Tenant `better-net.eu.auth0.com`, application
  `BetterNet Webapp` (`WBF8SVYqzsxI37AbH733VNHyQgvPs5ou`), URLs registered for
  `http://localhost:3000` and `https://app.better-net.com`.
- Config in `.env.local` (gitignored), documented in `.env.example`. The API (resource
  server) `https://server.better-net.com/api` now exists in the tenant, so
  `VITE_AUTH0_AUDIENCE` is live rather than commented out — that is the setting that makes
  Auth0 issue a JWT instead of an opaque token.
- Device linking: the extension's one-time code is stashed in `sessionStorage` at startup
  (`main.tsx`) because the Auth0 redirect drops the URL fragment, then redeemed after
  sign-in. Sign-in carries `appState.returnTo`, since Auth0 only returns to the origin.
- The staff nav link only appears for staff, so nobody is invited into a 403
- `npm test` — 22 tests (`test/feedback-viewer.test.ts`), no browser needed

## Blocked

- **End-to-end sign-in is still unproven.** Config is in place on both sides, but nobody has
  signed in since, so "JWT accepted by bn-server" is inference, not a result.
- **There is no webapp deploy workflow** (`.github/workflows/` has `server-deploy.yml` only),
  so `app.better-net.com` is a manual `npm run build` + copy — and the build bakes in
  `VITE_AUTH0_*`, which must therefore be present on whichever machine builds it.

## Next

- Test sign-in end to end against bn-server: `npm run dev` here (port 3000, the registered
  callback) plus bn-server on 3001, then check `/api/account/me` returns the account — and
  whether it carries an email, which tells you if the post-login Action is bound to the flow
- Cert and deploy for `app.better-net.com` — the vhost (`app.better-net.com.nginx`) is
  written but the cert must exist before it is enabled, or nginx takes every site on the
  host down with it
- `npx tsc --noEmit` is noisy: the symlinked `bn-extension-src` has pre-existing implicit-any
  errors. `npm run build` (vite) is the real gate and is clean.
