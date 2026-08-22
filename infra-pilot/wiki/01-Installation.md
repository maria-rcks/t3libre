# Installation

## Full Setup (Recommended)

```bash
git clone https://github.com/drosemann/infra-pilot.git
cd infra-pilot && cp .env.example .env
docker compose up -d
```

This starts: PostgreSQL 16, Redis 7, Orchestrator, Integration Service, Management Panel, Discord Service.

Additional profiles:

```bash
docker compose --profile monitoring up -d   # Prometheus, Grafana
docker compose --profile cli up -d          # ipilot CLI container
```

## CLI Only

```bash
cd cli && pip install -e .
ipilot --version
```

## Prerequisites

| Tool           | Minimum Version |
|----------------|-----------------|
| Docker Compose | 24+ / v2        |
| Python         | 3.9+            |
| Node.js        | 18+             |

---

*Updated: July 2026*
