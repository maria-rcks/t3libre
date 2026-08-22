# Infra Pilot

A multi-hypervisor cloud orchestration platform with GitOps, SSH session management, secret management, deployment templates, and more. Manage everything from CLI, web panel, or Discord.

## Quick Start

```bash
git clone https://github.com/drosemann/infra-pilot.git
cd infra-pilot && cp .env.example .env
docker compose up -d
pip install ./cli
ipilot doctor
```

| Service | URL                   |
|---------|-----------------------|
| Panel   | http://localhost:5173 |
| API     | http://localhost:3001 |

## New Features

| Feature | Description |
|---------|-------------|
| [GitOps (IaC)](05-CLI-Reference.md#gitops) | YAML-based infrastructure as code: `ipilot gitops apply/plan` |
| [SSH Sessions](05-CLI-Reference.md#ssh) | Jump hosts, session recording, saved hosts |
| [Server Inventory](05-CLI-Reference.md#inventory) | Metadata, tags, filtering: `ipilot inventory list --tag production` |
| [Secret Store](05-CLI-Reference.md#secrets) | Encrypted, versioned, auto-rotation, RBAC |
| [Deployment Templates](05-CLI-Reference.md#templates) | Node.js, Python, Docker Compose, Nginx, PostgreSQL, Redis, Traefik |
| [Plugin System](05-CLI-Reference.md#plugins) | Extensible via `plugins/`, 9 built-in providers |
| [Webhooks](05-CLI-Reference.md#webhooks) | Event-driven HTTP callbacks with logs |
| [API Keys](05-CLI-Reference.md#apikeys) | Role-based programmatic access |
| [Runbooks](05-CLI-Reference.md#runbooks) | Automated workflows with built-in templates |
| [AI Assistant](05-CLI-Reference.md#assistant) | Natural language → plan → confirm → execute |
| [Developer Tools](05-CLI-Reference.md#doctor) | `ipilot doctor --fix`, `benchmark`, `diagnose`, TUI |

## Next Steps

[Installation](01-Installation) · [First Deployment](02-First-Deployment) · [Usage Examples](04-Usage-Examples) · [CLI Reference](05-CLI-Reference) · [Contributing](07-Contributing)

---

*[GitHub](https://github.com/drosemann/infra-pilot) · MIT*
