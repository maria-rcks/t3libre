# Docker Panel

Self-hosted Docker container management panel with personal mode and optional business mode.

## Quick Start

```bash
cd services/management-panel
cp .env.local.example .env.local
npm install && npm run dev
```

Open http://localhost:5173 — first-time setup guides you through mode selection and admin account creation.

## Overview

### Personal Mode (default)
- Docker app CRUD with container start/stop/restart via real Docker API
- Dashboard with real-time metrics, live logs via WebSocket
- Port mapping, env vars, volume mounts, CPU/memory limits
- Web terminal (browser shell via docker exec)
- Backup jobs with retention policies, audit trail
- Notification channels (email, webhook, Telegram)
- Global search (Cmd+K), PWA support, dark mode
- 2FA/TOTP, config editor, MySQL provisioning, git deploy webhooks
- Cron scheduler, modpack installer, prepaid billing

### Business Mode (roadmap)
- Customer management, plans/pricing, white-label, staff RBAC, advanced analytics

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + TypeScript + Tailwind |
| Backend | Express.js |
| Database | PostgreSQL + Supabase |
| Auth | Supabase auth (JWT) |

## Key Endpoints

| Group | Routes |
|-------|--------|
| Apps | `GET/POST /api/apps`, `GET/PATCH/DELETE /api/apps/:id` |
| Container | `POST /api/apps/:id/start\|stop\|restart` |
| WebSocket | `ws://host:3001?appId=<id>` — live logs & metrics |
| Monitoring | `GET /api/apps/:id/metrics`, `GET /api/metrics/aggregated` |
| Backups | `GET/POST /api/backup-jobs`, `GET /api/backup-jobs/:id/status` |
| Billing | `GET /api/billing/balance`, `/topup`, `/transactions`, `/cost-estimate` |
| Config | `GET/POST /api/apps/:id/config`, `/api/config/validate` |
| Audit | `GET /api/audit-log` |
| Notifications | `GET/POST/PATCH/DELETE /api/notification-channels` |

Full OpenAPI spec at `GET /api/openapi.json` or Swagger UI at `GET /api/docs`.

## Development

```bash
npm run dev      # Frontend :5173 + Backend :3001
npm run build    # Production build
npm run lint     # Lint & type check
```

## Docker Integration

Manages containers via `docker` CLI calls. Real-time monitoring via:
- WebSocket streaming (`docker logs -f`, `docker stats`)
- In-browser terminal (`docker exec` via WebSocket)
- Server metrics (CPU, memory, TPS, player count)

## Project Structure

```
src/
├── pages/        # Setup, Dashboard, AppForm, AppDetail, Monitoring, Backups, Reports, Settings, AuditLog, Billing
├── components/   # Layout, Sidebar, NavBar, OnboardingWizard, GlobalSearch, WebTerminal
├── lib/          # API client, auth, types
├── App.tsx       # Router + mode provider
├── main.tsx      # Entry point + PWA
server/
├── index.ts      # Express + WebSocket (70+ routes)
├── presets.ts    # Server presets
└── openapi.ts    # OpenAPI spec
```

## Support

- [Issues](https://github.com/drosemann/infra-pilot/issues)
- [Discussions](https://github.com/drosemann/infra-pilot/discussions)
- [Full docs](docs/)
- [Getting Started Guide](README-DOCKER-PANEL.md)

MIT — see [LICENSE](../../LICENSE)
