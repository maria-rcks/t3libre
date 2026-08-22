# Docker Panel — Getting Started

Self-hosted Docker management panel with personal and business modes.

## Requirements

- Node.js 18+, npm
- Docker daemon (local or remote)
- Supabase (self-hosted via Docker Compose recommended)

## Installation

```bash
cd services/management-panel
npm install
cp .env.local.example .env.local
```

### Supabase Setup (self-hosted)

Use the [Supabase Docker Compose](https://github.com/supabase/supabase/tree/master/docker):
```bash
docker-compose -f docker-compose.yml up -d
```

Then in `.env.local`:
```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Initialize database via Supabase SQL Editor with `db/schema.sql`.

### Start

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

### Production

```bash
npm run build
# Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL
node server/index.ts  # Daemonize with PM2, systemd, or Docker
```

## Project Structure

```
services/management-panel/
├── public/          # Static assets + PWA manifest + service worker
├── src/
│   ├── pages/       # Page components
│   ├── components/  # Reusable UI components
│   └── lib/         # API client, auth, types
├── server/          # Express API
├── db/              # Schema
├── docs/            # Architecture & setup docs
└── tests/           # Unit, integration, Playwright E2E
```

## Features

- Docker app CRUD with real container control
- Dashboard with live metrics, WebSocket logs
- Server monitoring, health checks, backup jobs
- Audit trail, global search, web terminal
- Config editor, MySQL provisioning, git deploy
- Cron scheduler, modpack installer, prepaid billing
- 2FA/TOTP, PWA, dark mode, notification channels
- Business mode: customers, plans, white-label, RBAC

## License

MIT — see [LICENSE](../../../LICENSE)

## Support

- [Issues](https://github.com/drosemann/infra-pilot/issues)
- [Discussions](https://github.com/drosemann/infra-pilot/discussions)
