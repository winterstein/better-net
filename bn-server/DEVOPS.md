# bn-server DevOps

## DNS

Cloudflare: point `api.betternet.org` (or your API hostname) at the Hetzner server IP.

## Server

Hetzner: Ubuntu. App lives at `/opt/betternet/server`, managed by systemd as `bn-server`.

### One-time host setup

```bash
sudo mkdir -p /opt/betternet/server
# This line attempts to create a system user named 'bn' (with home directory /opt/betternet/server and no login shell)
# It will not error if the user already exists, due to '|| true'.

sudo useradd --system --home /opt/betternet/server --shell /usr/sbin/nologin bn || true
```

Also copy a couple of these files to the server

scp bn-server.service aberdeen:~

Then:

```bash
sudo cp bn-server.service /etc/systemd/system/bn-server.service
sudo systemctl daemon-reload
sudo systemctl enable bn-server
```

Allow the GitHub deploy user to restart the service without a password (adjust user name):

```text
# /etc/sudoers.d/bn-deploy
deployuser ALL=(ALL) NOPASSWD: /bin/systemctl stop bn-server, /bin/systemctl start bn-server, /bin/systemctl restart bn-server, /bin/systemctl status bn-server, /bin/systemctl daemon-reload
deployuser ALL=(ALL) NOPASSWD: /bin/mv, /bin/mkdir, /bin/rmdir, /bin/rm, /bin/chown, /bin/chmod
```

Install Node 20 and PostgreSQL on the host. Create the `betternet` database and a DB user matching GitHub secrets.

### How to Deploy

Automatic: push to `main` when `bn-server/**` or `bn-extension/src/**` changes. Workflow: [`.github/workflows/server-deploy.yml`](../.github/workflows/server-deploy.yml).

Manual: GitHub → Actions → **Deploy Server** → **Run workflow**.

#### GitHub Environment `prod`

| Kind | Name | Notes |
|------|------|-------|
| var | `DEPLOY_HOST` | Hetzner server IP or hostname |
| var | `DEPLOY_USER` | SSH user for deploy |
| var | `DEPLOY_PORT` | SSH port (default 22) |
| var | `SERVER_PORT` | Listen port (default 3001) |
| var | `SERVER_HOST` | Bind address (default 0.0.0.0) |
| var | `DB_HOST` | Postgres host |
| var | `DB_PORT` | Postgres port (default 5432) |
| var | `DB_NAME` | Database name (default betternet) |
| var | `DB_USERNAME` | Postgres user |
| var | `BN_AIQA_ENDPOINT` | Optional AIQA traces URL |
| var | `RUN_AS_USER` | Service owner (default: `DEPLOY_USER`; prefer `bn`) |
| secret | `DEPLOY_SSH_KEY` | Private key for `DEPLOY_USER` |
| secret | `DB_PASSWORD` | Postgres password |
| secret | `BN_OPENAI_API_KEY` | Optional LLM key |
| secret | `BN_ANTHROPIC_API_KEY` | Optional LLM key |
| secret | `BN_GOOGLE_API_KEY` | Optional fact-check key |

Deploy flow: CI builds and tests → SCP `dist/` + lockfile to `server.new` → swap into `/opt/betternet/server` → `npm ci --omit=dev` on host → write `.env` → `systemctl restart bn-server`.

Rollback: previous `dist` is kept briefly as `dist.old.old` on the host; restore manually if needed.

### How to Setup and Run Local

```bash
cd bn-server
npm install
cp env.example .env   # add DB_* and optional BN_* keys
npm run dev           # tsx watch, port 3001
# or
npm run build && npm start
```

Health check: `curl http://localhost:3001/health`

Tests: `npm test` (requires local Postgres; see `env.example`).
