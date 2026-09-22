# bn-webapp status

Vite + React companion UI, served from `app.better-net.com`. Read-only views on feedback;
unlike the extension, the whole app requires sign-in.

## Works

- Pages, Chunks, Analyze URL, My feedback, and staff All feedback views
- **Auth0 sign-in** (`src/auth/`): `@auth0/auth0-react`, SPA + PKCE, JWT sent as a Bearer
  header by `services/api.ts`. Tenant `better-net.eu.auth0.com`, application
  `BetterNet Webapp` (`WBF8SVYqzsxI37AbH733VNHyQgvPs5ou`), URLs registered for
  `http://localhost:3000` and `https://app.better-net.com`.
- Config in `.env.local` (gitignored), documented in `.env.example`
- Device linking: the extension's one-time code is stashed in `sessionStorage` at startup
  (`main.tsx`) because the Auth0 redirect drops the URL fragment, then redeemed after
  sign-in. Sign-in carries `appState.returnTo`, since Auth0 only returns to the origin.
- The staff nav link only appears for staff, so nobody is invited into a 403
- `npm test` — 22 tests (`test/feedback-viewer.test.ts`), no browser needed

## Blocked

- **The Auth0 API (resource server) does not exist**, so `VITE_AUTH0_AUDIENCE` is commented
  out in `.env.local`. Without it Auth0 issues an opaque access token instead of a JWT:
  sign-in appears to work and every API call returns 401. Setting it before the API exists is
  worse — the login fails outright with "Service not found". Needs
  `https://server.better-net.com/api` created in the tenant; the Auth0 MCP token has no
  `create:resource_servers` scope.

## Next

- Create the API above, uncomment `VITE_AUTH0_AUDIENCE`, and test sign-in end to end with
  bn-server (`AUTH0_DOMAIN` / `AUTH0_AUDIENCE` must match)
- Cert and deploy for `app.better-net.com` — the vhost (`app.better-net.com.nginx`) is
  written but the cert must exist before it is enabled, or nginx takes every site on the
  host down with it
- `npx tsc --noEmit` is noisy: the symlinked `bn-extension-src` has pre-existing implicit-any
  errors. `npm run build` (vite) is the real gate and is clean.
