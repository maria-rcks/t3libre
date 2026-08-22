# Security Policy & Threat Model

This document is the security contract for Infra Pilot. It states who can do
what through which interface, what the trust boundaries are, and how to report
problems. **Pre-1.0 status: there are no tagged releases yet; treat every
change as unreleased.**

## Reporting a Vulnerability

**Do not** post security issues in public. Email the maintainers instead
(the address is in the repository profile / commit history).

Please include:

- What the problem is
- Which component and endpoint are affected
- How to reproduce it
- How severe you think it is

**We will:** acknowledge within 48 hours, then provide a fix timeline.
Critical issues (remote code execution, credential disclosure, auth bypass)
get a fix before any other work.

## Threat Model

### Components and trust boundaries

```
                      ┌────────────────────────────┐
   Public Internet ──▶│ Orchestrator Agent          │
                      │  - webhook server (:8080)   │
                      │  - Discord bot              │
                      └──────┬───────────┬──────────┘
                             │           │
             Docker socket   │           │  HTTP/DB
                             ▼           ▼
                     Containers (VPS)   PostgreSQL / Redis
```

| # | Boundary | Assets | Trust |
|---|----------|--------|-------|
| B1 | Internet → webhook server | Container lifecycle, deploy pipeline | Untrusted by default; only HMAC/Bearer-authenticated requests pass |
| B2 | Discord API → bot | Command execution, secrets, VPS lifecycle | Discord session tokens; app commands are scoped by RBAC role checks |
| B3 | Orchestrator → Docker daemon | Host access (socket = root equivalent) | Highest privilege in the system; must be minimized per operation |
| B4 | Orchestrator → PostgreSQL/Redis | Users, backups, rotation metadata | Service credentials only; no interactive logins |
| B5 | Management panel ↔ Supabase | Panel data, auth | Supabase key must never leave the server side |
| B6 | CLI ↔ orchestrator API | API keys, config profiles | TLS in production; token stored in `~/.ipilot/config.json` |

### Who can do what via which API

| Interface | Who | What they can do | Guard |
|-----------|-----|------------------|-------|
| `GET /health`, `GET /api/health` | Anyone | Check liveness | No sensitive data returned |
| `GET /metrics` | Anyone (network-restricted) | Read operational metrics | Must not leak secrets/container internals; restrict at network layer |
| `POST /webhook/gitops` | CI/CD systems | Reconcile a manifest (deploy) | `X-Signature-256` = HMAC-SHA256 of `X-Timestamp` + body (`GITOPS_WEBHOOK_TOKEN`), one signature per replay window; **fail closed** (503) if unset |
| `GET /api/v1/federation/status` | Other pilot instances | Read federation status | Constant-time federation token check |
| `POST /api/v1/deployments`, `GET /api/v1/providers` | CLI / management panel | Trigger manifest reconciliation | Federation token (fails closed in production); optional `user_id`+`org_id` checked against `manifest:deploy` permission |
| `/api/v1/rbac/*` | RBAC-authorized principals | Manage roles/orgs/memberships | RBAC engine + per-project scoping |
| Discord app commands | Discord users | Manage VPS, backups, deploy, secrets | Bot-level role/permission checks; container names validated against `SAFE_CONTAINER_PATTERN` |
| `docker exec`/`docker run` (via bot) | RBAC-authorized users | Run commands in containers | **No `--privileged`, no `--cap-add=ALL`**; never `shell=True`; subprocess args passed as lists |

### Secrets and credentials

- Secrets live in environment variables / `.env` files, **never** in code or
  committed files. Placeholders in `.env.example` are `CHANGE_ME`.
- The orchestrator **refuses to start** in production while placeholder
  secrets are set (fail fast).
- Production requires an explicit `POSTGRES_PASSWORD`; no hardcoded defaults.
- The secrets manager encrypts values at rest; keys stay out of the repo.
- Gitleaks scans the full git history on every push; npm audit and pip-audit
  run for dependency CVEs.

### Container isolation (regression contract)

Container spawns MUST NOT:

- run with `--privileged` or `--cap-add=ALL`
- take image/name/command strings built via string interpolation or a shell
- bypass the per-VPS resource limits

Regression tests assert these properties on every CI run
(`test_create_vps_never_spawns_privileged_containers`,
`test_container_name_validation_rejects_injection`).

### Known hardening history

| Date | Issue |
|------|-------|
| 2026-07 | Docker command injection closed; privileged container flags removed |
| 2026-07 | GitHub/GitOps webhooks now verified (HMAC/Bearer), fail closed |
| 2026-07 | Wide-open CORS restricted to configured origins |
| 2026-07 | Hardcoded/placeholder secrets replaced; placeholder secrets rejected in production |
| 2026-08 | Gitleaks + npm audit gates enabled in CI; coverage gates raised |

## Security Best Practices (for contributors)

- Never put passwords or API keys in code. Use environment variables.
- Validate user input; use parameterized database queries everywhere.
- New HTTP endpoints require a guard: HMAC, Bearer token, or RBAC — no
  "trusted by default" routes.
- New container-spawn code paths must keep the isolation contract above.
- Update `SECURITY.md` when you change a trust boundary.

## Tools

| Language   | Tools                           | Gate  |
|------------|---------------------------------|-------|
| Python     | `bandit`, `pip-audit`, `pytest-cov` | CI fails on findings / coverage drop |
| JavaScript | `npm audit`, `node --test`      | CI fails on high+ vulns |
| Everything | `gitleaks` (full history)       | CI fails on leaked secrets |

## Supported Versions

| Version        | Support                       |
|----------------|-------------------------------|
| Pre-1.0 (main) | Patch fixes, no stability promise |
| 1.0+ (planned) | Full security patches         |
