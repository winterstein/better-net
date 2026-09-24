# bn-server DevOps

## Host

- App: `/opt/betternet/server`, systemd unit `bn-server`
- Public API: `https://server.better-net.com` (nginx + cert on the host)
- Database: Neon Postgres (not installed on the Hetzner box). Set `DB_*` from the Neon console

## One-time host setup

```bash
sudo mkdir -p /opt/betternet/server
sudo useradd --system --home /opt/betternet/server --shell /usr/sbin/nologin bn || true
# DEPLOY_USER must own /opt/betternet so SCP can create server.new
sudo chown $DEPLOY_USER:$DEPLOY_USER /opt/betternet
```

Install the unit and enable it:

```bash
sudo cp bn-server.service /etc/systemd/system/bn-server.service
sudo systemctl daemon-reload
sudo systemctl enable bn-server
```

Allow the deploy user to restart without a password (adjust the username):

```text
# /etc/sudoers.d/bn-deploy
deployuser ALL=(ALL) NOPASSWD: /bin/systemctl stop bn-server, /bin/systemctl start bn-server, /bin/systemctl restart bn-server, /bin/systemctl status bn-server, /bin/systemctl daemon-reload
deployuser ALL=(ALL) NOPASSWD: /bin/mv, /bin/mkdir, /bin/rmdir, /bin/rm, /bin/chown, /bin/chmod
```

Install Node 20 on the host. Postgres stays on Neon.

## Deploy

Automatic: push to `main` when `bn-server/**` or `bn-extension/src/**` changes.
Workflow: [`.github/workflows/server-deploy.yml`](../.github/workflows/server-deploy.yml).

Manual: GitHub → Actions → Deploy Server → Run workflow.

### GitHub Environment `prod`

Variables: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT`, `SERVER_PORT`, `SERVER_HOST`,
`DB_PORT`, `DB_NAME`, `DB_USERNAME`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`,
`BN_AIQA_ENDPOINT`, `RUN_AS_USER`.

Secrets: `DEPLOY_SSH_KEY`, `DB_HOST`, `DB_PASSWORD`, `BN_PSEUDONYM_SECRET`,
optional `BN_OPENAI_API_KEY` / `BN_ANTHROPIC_API_KEY` / `BN_GOOGLE_API_KEY`.

Auth0 tenant is `better-net.eu.auth0.com`. Audience must match the webapp's
`VITE_AUTH0_AUDIENCE` (`https://server.better-net.com/api`).

Flow: CI tests + build → SCP to `server.new` → `npm ci` in staging while live stays up →
directory swap → restart → health poll. Failed health rolls back to `server.prev`.

## Local

```bash
cd bn-server
npm install
cp .env.example .env   # Neon or local Postgres
npm run dev            # port from .env / 3001
```

Tests need local Postgres. `.env.test` is committed and overrides `.env` for `npm test`.

## bn-webapp

Static bundle at `/opt/betternet/webapp`, nginx vhost `app.better-net.com`.
Deploy: [`.github/workflows/webapp-deploy.yml`](../.github/workflows/webapp-deploy.yml)
(push to `main` touching `bn-webapp/**`).

One-off: cert first, then enable the vhost (see the workflow header comments).

Vite build vars (prod environment): `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`,
`VITE_AUTH0_AUDIENCE`, `VITE_API_BASE`.
