# bn-webapp status

Vite + React companion UI, served from `app.better-net.com`. Read-only views on feedback;
unlike the extension, the whole app requires sign-in.

## Works

- **Deploy workflow**: `.github/workflows/webapp-deploy.yml` — tests, builds, SCPs the
  bundle and swaps `/opt/betternet/webapp` on the host, triggered by pushes touching
  `bn-webapp/**`. Vite inlines `VITE_*` at build time, so the workflow checks the values are
  present *and* that they reached the bundle: a dropped env var otherwise produces a healthy
  looking build that 401s on every call. No nginx or certbot commands — the deploy user's
  sudo is a narrow allowlist.
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

- **Sign-in half-proven.** A real localhost login works and Auth0 issues an access token for
  the right audience (`https://server.better-net.com/api`, confirmed in the tenant log), but
  bn-server 401'd every guarded call — it never read its `.env`, so `AUTH0_DOMAIN` was unset
  and `auth.ts` refused the token. Fixed in bn-server; not yet re-tested in the browser.
- The production build needs `VITE_API_BASE=https://server.better-net.com/api`.
  `app.better-net.com` serves static files and proxies nothing, so the `/api` default only
  works in dev, where Vite proxies it.
- **The deploy workflow needs four prod variables that are not set yet**:
  `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` and `VITE_API_BASE`
  (GitHub -> Settings -> Environments -> prod -> variables; values in `.env.example`, all
  public). The workflow refuses to build without them rather than shipping a bundle whose
  API calls all 401.
- **`app.better-net.com` has no cert or vhost yet**, so a deploy puts files in place and
  nothing serves them (the workflow says so instead of passing quietly). Cert first, then
  enable the vhost: nginx loads the whole host's config atomically, so enabling a site whose
  cert is missing is an `[emerg]` that takes every other vhost down with it.

## Next

- Test sign-in end to end against bn-server: `npm run dev` here (port 3000, the registered
  callback) plus bn-server on 3001, then check `/api/account/me` returns the account — and
  whether it carries an email, which tells you if the post-login Action is bound to the flow
- Cert and deploy for `app.better-net.com` — the vhost (`app.better-net.com.nginx`) is
  written but the cert must exist before it is enabled, or nginx takes every site on the
  host down with it
- `npx tsc --noEmit` is noisy: the symlinked `bn-extension-src` has pre-existing implicit-any
  errors. `npm run build` (vite) is the real gate and is clean.
