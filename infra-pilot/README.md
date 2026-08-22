# Infra Pilot

[![CI](https://github.com/drosemann/infra-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/drosemann/infra-pilot/actions/workflows/ci.yml)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> Learning project: a CLI + web dashboard for managing VPS servers.

---

## What This Is

I'm building this to learn full-stack infrastructure tooling – Python CLI, React dashboard, Docker orchestration, PostgreSQL, and everything in between.

It's a work-in-progress and contributions of all kinds are welcome.

---

## Quick Start

```bash
git clone https://github.com/drosemann/infra-pilot.git
cd infra-pilot && cp .env.example .env
bash scripts/generate-env.sh        # fill empty secrets (Windows: powershell -File scripts/generate-env.ps1)
docker compose up -d
pip install ./cli
ipilot login
```

---

## CLI Commands

| Command | What It Does |
|---------|-------------|
| `server` | List, create, delete servers |
| `backup` | Create and list backups |
| `deploy` | Deploy to a server |
| `logs` | Tail server logs |
| `gitops` | YAML-based deployments |
| `ssh` | SSH session management, keys, jump hosts |
| `inventory` | Server metadata and tags |
| `secrets` | Encrypted key-value store |
| `plugins` | Install, update, remove plugins |
| `doctor` | Benchmark and diagnose servers |
| `webhooks` | Create, list, test webhooks |
| `apikeys` | API key CRUD |
| `templates` | Deployment blueprints |
| `tui` | Terminal UI mode |
| `rollback` | Undo/rollback changes |

---

## Architecture

```
┌─ Clients ────────────────────────┐
│ CLI (ipilot)   Web Panel (React) │
└────────────────┬─────────────────┘
                 ▼
┌─ Management Panel (Express) ───────┐
│  REST API · WebSocket · PostgreSQL │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─ Orchestrator Agent (aiohttp) ────┐
│  Compute Providers · GitOps · RBAC │
│  Billing · Self-Healing · Scaling  │
└────────────────────────────────────┘
```

---

## Contributing

All PRs, issues, and ideas are welcome. This is a learning project and every contribution helps.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [wiki/07-Contributing.md](wiki/07-Contributing.md).

---

## License

MIT — see [LICENSE](LICENSE).
