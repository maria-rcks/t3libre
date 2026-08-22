# Backup & Restore

All Infra Pilot services share a single PostgreSQL database (`infra_pilot` by
default), so one backup covers the orchestrator (Alembic-managed schema),
Discord service (`server_limits`, statistics), and management panel data.

## Backup

```bash
./scripts/db-backup.sh
```

This creates a `pg_dump` custom-format backup at
`backups/infra-pilot_<timestamp>.dump` and keeps only the 10 most recent files.

Options:

| Option        | Description                              |
|---------------|------------------------------------------|
| `--keep N`    | Keep only the N most recent backups      |
| `--out DIR`   | Use a different output directory         |

The script starts the `postgres` container via `docker compose` if the stack
is not running.

## Restore

```bash
./scripts/db-restore.sh backups/infra-pilot_20260701_091500.dump
```

What happens:

1. The script verifies the file is a `pg_dump` custom-format backup.
2. You get a confirmation prompt (skip with `--yes`).
3. It restores into the running `postgres` container using
   `pg_restore --clean --if-exists --no-owner`, i.e. existing tables are
   dropped and recreated from the backup.

### Before restoring

Stop the services that write to the database to avoid conflicts:

```bash
docker compose stop orchestrator-agent discord-service management-panel
```

Restart them after the restore:

```bash
docker compose start orchestrator-agent discord-service management-panel
```

The orchestrator runs `alembic upgrade head` on startup, so the schema is
brought up to date automatically after a restore.

## Cron example

```bash
# docker-compose.yml gets a backup job, or on the host:
0 3 * * * /path/to/infra-pilot/scripts/db-backup.sh --keep 14 >> /var/log/infra-pilot-backup.log 2>&1
```

## Restoring a fresh database

After `docker compose down -v`, start `postgres`, then restore:

```bash
docker compose up -d postgres
./scripts/db-restore.sh backups/infra-pilot_<timestamp>.dump --yes
docker compose up -d
```