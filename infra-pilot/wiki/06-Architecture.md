# Architecture

## High-Level Overview

```
┌─ Clients ──────────────────────────────────────────┐
│ CLI (ipilot)   Web Panel (React)   Discord Bot     │
└────────────────────────┬───────────────────────────┘
                         ▼
┌─ Orchestrator Agent (Python, port 8500) ───────────┐
│                                                     │
│  ┌──────────────────┐   ┌──────────────────────┐   │
│  │ Compute Providers│   │ GitOps Manifests     │   │
│  │ (Docker, AWS...) │   │ (YAML → reconcile)   │   │
│  └──────────────────┘   └──────────────────────┘   │
│                                                     │
│  ┌──────────────────┐   ┌──────────────────────┐   │
│  │ RBAC (org/team)  │   │ Billing & Metering   │   │
│  └──────────────────┘   └──────────────────────┘   │
│                                                     │
│  ┌──────────────────┐   ┌──────────────────────┐   │
│  │ Self-Healing     │   │ Auto-Scaling         │   │
│  └──────────────────┘   └──────────────────────┘   │
│                                                     │
│  ┌──────────────────┐   ┌──────────────────────┐   │
│  │ Region/Federation│   │ VPS Manager (Docker) │   │
│  └──────────────────┘   └──────────────────────┘   │
└─────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐ ┌────────────┐ ┌────────────────┐
│  PostgreSQL  │ │  Redis     │ │  Prometheus/   │
│  (metadata)  │ │  (cache)   │ │  Grafana       │
└──────────────┘ └────────────┘ └────────────────┘
```

## Service Table

| Service | Language | Port | Purpose |
|---------|----------|------|---------|
| Orchestrator Agent | Python (discord.py, aiohttp) | 8500 | Core engine: VPS mgmt, GitOps, RBAC, billing, healing, scaling, federation |
| Integration Service | Python | 9000 | External API integrations, user sync |
| Management Panel | TS/React/Express | 5173/3001 | Web dashboard |
| Discord Service | Node.js | 3002 | Standalone Discord bot (legacy) |
| PostgreSQL | — | 5432 | Primary metadata store |
| Redis | — | 6379 | Caching, rate limiting |
| Prometheus | — | 9090 | Metrics collection |
| Grafana | — | 3000 | Dashboards |
| CLI (ipilot) | Python (Typer) | — | Terminal client |

## Orchestrator Agent Internals

### Module Breakdown

| Module | Purpose |
|--------|---------|
| `compute/` | Plugin-based compute provider abstraction. `DockerProvider` wraps VPSManager. Add new providers (Proxmox, AWS, GCP) by implementing `ComputeProvider`. |
| `manifest/` | GitOps engine. Define infrastructure in `InfraFile` YAML. `ManifestEngine` detects drift between desired and actual state and reconciles. `ManifestWatcher` polls Git repos. |
| `rbac/` | Multi-tenant RBAC. Org → Project → Team hierarchy. 38 fine-grained `Permission` values. Built-in roles (owner, admin, operator, developer, viewer, billing) plus custom roles. |
| `billing/` | Usage metering & billing. `UsageMeter` polls providers for resource consumption. `BillingEngine` aggregates into invoices with configurable pricing tiers. |
| `healing/` | Self-healing engine. Monitors health checks, applies remediation policies (restart, recreate, migrate, escalate). Rate limited with configurable cooldowns. |
| `region/` | Multi-datacenter support. `Region`/`Datacenter` capacity models. `Federation` manages peer-to-peer cross-region orchestration with token authentication. |
| `scaling/` | Auto-scaling engine. Evaluates rules from `scaling_rules` DB table against live CPU/memory stats. Scales up/down via Docker `container.update()`. |
| `vps_manager.py` | Core Docker container manager. Create, start, stop, restart, delete, stats, backups, snapshots, clone, migrate, health checks, benchmarks. |
| `db.py` | Async PostgreSQL pool (asyncpg) and sync helpers (psycopg2). |
| `integration.py` | Database schema (50+ tables) and notification proxying. |
| `main.py` | Entry point: DB migrations, aiohttp webhook/API server, lifecycle wiring. |

### Discord Commands

All Discord functionality lives in the unified JavaScript bot at `services/discord-service/` (single bot, all slash commands ported from the former Python cogs — VPS lifecycle, billing/credits, monitoring, backups, health checks, alerts, scheduling, templates, resource pools, databases, maintenance).

## Data Flow

1. **User action** comes via CLI, web panel, or Discord slash command
2. **Orchestrator Agent** validates via RBAC, checks quotas, and acts:
   - VPS lifecycle → `VPSManager` → Docker SDK
   - Manifest reconcile → `ManifestEngine` → compute providers
   - Billing → `BillingEngine` → `usage_records` / `invoices`
3. **Background loops** run continuously:
   - Monitoring (60s): stats collection, alert evaluation
   - Billing (1h): usage metering, invoice generation, prepaid deduction
   - Healing (30s): health checks, remediation
   - Auto-scaling (60s): threshold evaluation, resource adjustment
4. **Metrics** exposed at `/metrics` for Prometheus scraping
5. **Federation** peers connect via authenticated REST API at `/api/v1/*`

## Key Design Decisions

- **Plugin providers**: Compute back-ends are hot-pluggable via `ProviderRegistry`. The `ComputeProvider` ABC defines 11 methods that every provider must implement.
- **GitOps-first**: Infrastructure state is declared in YAML. The engine reconciles desired → actual, not the other way around.
- **Concurrent breach counting**: Auto-scaling requires N consecutive breaches before acting, preventing flapping.
- **Cooldown isolation**: Every scaling rule and healing action has an independent cooldown timer.
- **Async everywhere**: The agent uses asyncio throughout — all provider calls, DB queries, and HTTP requests are non-blocking.

---

*See [Security](08-Security) for data privacy details.*
