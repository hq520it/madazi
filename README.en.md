# madazi · 码搭子

> 🌐 [English](README.en.md) | 简体中文

> A self-hostable AI application building platform — all-in-one AI collaboration infrastructure for multiple users, multiple projects, and multiple sessions.
> Two deployment forms: **Standalone** (no Docker / no Kubernetes — run on one machine with Node.js + PostgreSQL) and **K8s cloud** (multi-node / public domain, see "Self-hosted deployment (k8s cloud)").

madazi is built on the DeepSeek Harness agent kernel, with tenant-level security isolation on a shared single-process instance.
It packs the whole IT-team workflow — project creation → requirement conversation → coding → testing → preview → deployment — into one self-hosted platform.

## Features

- **Multi-user & multi-project collaboration**: multiple accounts, project members with roles, shared in-project sessions; session visibility & file access are dynamically authorized by the **currently active operator**, eliminating privilege escalation via shared sessions
- **AI agent workbench**: DeepSeek Harness based conversational development with terminal, filesystem sandbox, Skills, and subagents
- **Template marketplace**: publish – review – one-click install loop for project templates; automatic scan for suspected secrets on publish
- **Skill sharing**: install, share, and reuse a skill catalog across projects
- **Project preview**: built-in preview runtime — start/stop and preview your generated app anytime (optional; requires local Docker)
- **Security gateway**: login gate + project permission trimming (3-layer API/WS access control) + cross-project sandbox clamping
- **Private deployment**: run locally, fully self-contained data & code
- **Built-in browser & AI browser control**: let the agent operate pages like a human

## Quick start (standalone)

Supported platforms: **macOS / Linux** (both x86_64 and arm64).

### Prerequisites

- Node.js ≥ 22
- PostgreSQL ≥ 14 (installed and running locally; or spin up one with Docker — see "Database setup" below)
- pnpm (`npm i -g pnpm`)
- (optional) Docker — only required for "project preview"

### 1) One-shot install (fork kernel artifacts + platform plugins + workbench profiles)

```bash
bash scripts/standalone/bootstrap.sh
```

The script automatically: builds the dsh-src fork artifacts (if missing) → installs the dsh carrier →
installs the madazi-server platform dependencies → overlays the fork kernel artifacts (connection / ui-skill / ui-workspace) →
lays in the madazi plugins (login gate + platform panel) → assembles the workbench profiles.

> Defaults to the npmmirror registry for faster downloads in China; overseas users can switch to the official registry:
> `NPM_REGISTRY=https://registry.npmjs.org bash scripts/standalone/bootstrap.sh`

### 2) Database setup (first time only)

The platform connects to `postgres://madazi:madazi_dev_2026@localhost:5432/madazi` by default. Create it with local PG:

```bash
psql postgres -c "CREATE ROLE madazi LOGIN PASSWORD 'madazi_dev_2026'; CREATE DATABASE madazi OWNER madazi;"
```

Or run one with Docker (connection string matches the default):

```bash
docker run -d --name madazi-pg -p 5432:5432 -e POSTGRES_PASSWORD=madazi_dev_2026 -e POSTGRES_USER=madazi -e POSTGRES_DB=madazi postgres:16
```

### 3) Start the platform (two processes: dsh web + madazi server)

```bash
bash scripts/standalone/start.sh
```

- Browser entry: http://localhost:3456/dsh-web/ (server does same-origin aggregation: proxies the dsh web page, serves `/api/*` platform APIs directly)
- Default account: `admin / admin123` (auto-created on first start, **change it immediately**)
- New user registration requires an invite code (generated in "Admin → Invite codes")
- Stop: `Ctrl+C` (stops both processes together)

### Environment variables (optional)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://madazi:madazi_dev_2026@localhost:5432/madazi` | Platform database |
| `PORT` | `3456` | Server listening port |
| `DSH_WEB_PORT` | `3080` | dsh web port (fixed to 127.0.0.1) |
| `DSH_HOME` | `~/.madazi/dsh-home` | dsh data dir (sessions/config/db files — back it up to migrate) |
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | npm/pnpm registry (set to `https://registry.npmjs.org` overseas) |
| `NO_OPEN=1` | off | Do not auto-open the browser |

### Troubleshooting

- **PostgreSQL not running / Connection refused**: `brew services start postgresql@16` (macOS) or `sudo systemctl start postgresql` (Linux), or use the Docker command above.
- **Dependency install is slow / times out**: switch registry and rerun — `NPM_REGISTRY=https://registry.npmjs.org bash scripts/standalone/bootstrap.sh`.
- **bootstrap failed midway**: fix the cause and rerun; every step is idempotent, already-installed parts are reused.
- **Browser doesn't open after start**: run `NO_OPEN=1 bash scripts/standalone/start.sh` and visit http://localhost:3456/dsh-web/ manually.
- **Where are the logs**: `/tmp/madazi-dsh.log` (dsh web) and `/tmp/madazi-server.log` (platform server).
- **Forgot the admin password**: recreate the database (data is cleared) or see the init logic in `src/middleware/initAdmin.js`.

## Architecture (standalone)

```
Browser ──▶ madazi-server (0.0.0.0:3456)
              ├── /dsh-web/ page proxy ──▶ dsh web (127.0.0.1:3080, fork kernel + workbench plugin)
              ├── /api/* platform API family ──▶ platform routes (auth/projects/templates/skills/preview)
              ├── other /api + data plane (RPC/WS event stream) ──▶ dsh web
              └── LLM gateway (model proxy + usage metering) ──▶ upstream model service
Data layer: PostgreSQL (business) / DSH_HOME (sessions + config) / generated/ (project sources)
```

Core components:

| Component | Description |
|---|---|
| `madazi-server/` | Platform API + dsh reverse-proxy gateway + login gate + project permission/terminal/collab |
| `wb-src/` | DeepSeek Harness Web UI customized fork (3-pane workbench, sandbox clamp, browser control) |
| `dsh-src/` | DeepSeek Harness kernel source fork (local build replaces npm packages, includes madazi kernel customizations) |
| `madazi-server/docker/acp/plugins/` | Platform plugins (login gate / project panel: src/*.js → build.cjs → client.js) |
| `templates/` | Project templates (vue/react/uniapp × springboot/node) |
| `scripts/standalone/` | Standalone install & start scripts |
| `k8s/`, `deploy/` | K8s cloud deployment manifests (bare + Helm chart) |

## Self-hosted deployment (K8s cloud)

> The standalone edition is the quick-start form; for multi-node / public-domain / HA, use the **K8s cloud edition** (single-node K3s or managed Kubernetes).

You need: a Kubernetes cluster (K3s can be installed with one command) + Docker (to build images) + a domain (optional). Core flow: **build images → import into the cluster (`k3s ctr -n k8s.io images import`) → `kubectl apply -f k8s/` → entry via traefik**.

```bash
# One-shot (local K3s; set REMOTE=user@host for a remote box)
./deploy-k3s.sh all         # build + import + apply + wait + verify

# dsh-web workbench image is built separately (full pipeline incl. PVC version management)
bash scripts/build-dsh-web.sh

# Health & status
./deploy-k3s.sh verify      # entry reachability + /api/health + login page (VERIFY_URL configurable)
./deploy-k3s.sh status
```

- Entry: `https://<your-domain>/dsh-web/`; default account `admin / admin123`
- Full prerequisites, configuration (JWT / PG password / preview domain), managed-K8s registry flow, and troubleshooting: **[k8s/README.md](k8s/README.md)**; deployment chain & WebSocket map: **docs/ARCHITECTURE.md**

## Security

madazi implements tenant-level isolation on a shared single-process agent host:

- Session visibility & file access are dynamically authorized by the **currently active operator** (not the session owner), fail-closed on any uncertain state
- The `danger-full-access` sandbox mode is semantically redefined at the policy-resolution layer as "the current operator's authorized scope", consistently clamped across all execution exits
- Permission revocation takes effect in seconds through the push channel
- After deployment: change the default admin password and rotate production credentials (`JWT_SECRET`, etc.)

## License & Third-party components

This repository is open-sourced under [Apache-2.0](LICENSE).

Component provenance:

| Component | Origin | License |
|---|---|---|
| Platform itself (madazi-server / plugins / launcher / deploy) | This project | Apache-2.0 |
| [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) official kernel | Official open-source project; `dsh-src/` forked from its `dsh-v0.1.5-rc.1` tag with madazi kernel customizations | MIT |
| [deepseek-harness-workbench-plugin](https://github.com/loadingvx/deepseek-harness-workbench-plugin) (`wb-src/` fork source) | Third-party open-source project | MIT |

Copyright and license notices of upstream projects are preserved in their respective directories.

## Credits

Thanks to **DeepSeek Harness (dsh)** and the DeepSeek team — the agent workbench kernel this platform runs on originates from their open-source project.

Thanks to **[deepseek-harness-workbench-plugin](https://github.com/loadingvx/deepseek-harness-workbench-plugin)** — madazi's 3-pane workbench UI is forked from it.

And thanks to all open-source contributors.