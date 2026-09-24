# bn-webapp

Vite + React companion UI at `https://app.better-net.com`. Sign-in required (Auth0).
Talks to bn-server for feedback and chunk/page views.

## Local

```bash
cd bn-webapp
cp .env.example .env.local   # Auth0 + API base
npm install
npm run dev                  # proxies /api to local bn-server
```

## Deploy

GitHub Actions: [`.github/workflows/webapp-deploy.yml`](../.github/workflows/webapp-deploy.yml)
on push to `main`. Host setup and cert notes are in that file and `bn-server/DEVOPS.md`.

## Auth

Tenant `better-net.eu.auth0.com`, SPA client in `.env.example`. Audience must match the
server's `AUTH0_AUDIENCE` (`https://server.better-net.com/api`).

See `status.md` and `specs/feedback/feedback-viewer/spec.md`.
