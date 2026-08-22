# Auth Matrix

Every HTTP route in the project with its auth layer, status and notes.
"Status" reflects the last security pass; anything not listed here is a
finding and must be fixed or explicitly accepted.

> **How to keep this current:** every PR that adds or changes a route
> must update this table in the same commit.

## Conventions

| Term | Meaning |
|------|---------|
| `verifyAuth` | Express middleware: Supabase JWT, falls back to scrypt-hashed API key |
| federation token | Bearer token, constant-time compare, **fails closed in production** |
| HMAC-SHA256 | GitHub webhook signature, fails closed (503) when secret unset |
| public | No auth by design; must be documented here |

## Orchestrator Agent (`services/orchestrator-agent`, port 8500)

| Route | Method | Auth | Status | Notes |
|-------|--------|------|--------|-------|
| `/health` | GET | public | ok | Docker healthcheck |
| `/api/health` | GET | public | ok | CLI compatibility |
| `/metrics` | GET | public | ok | Prometheus scrape, no sensitive data |
| `/api/v1/federation/status` | GET | federation token | ok | Info only |
| `/api/v1/rbac/roles` | GET/POST | federation token | ok | |
| `/api/v1/rbac/orgs` | GET/POST | federation token | ok | |
| `/api/v1/rbac/assign` | POST | federation token | ok | |
| `/api/v1/rbac/orgs/{org_id}/permissions` | GET | federation token | ok | |
| `/api/v1/rbac/orgs/{org_id}/members` | GET | federation token | ok | |
| `/webhook/github[/{deploy_id}]` | POST | HMAC-SHA256 | ok | Only mounted when `GitDeployer` cog is loaded |
| `/webhook/gitops` | POST | HMAC-SHA256 (`GITOPS_WEBHOOK_TOKEN` over `X-Timestamp` + body) | ok | Mounted unconditionally; one signature per replay window |

**Production default:** without `FEDERATION_API_TOKEN` every `/api/` route
returns 503. In development a missing token logs a warning and allows
requests (matches `validate_secrets` convention in `config.py`).

## Management Panel (`services/management-panel`, port 3001)

188 routes total: 170 protected with `verifyAuth`, 18 public.

### Public (by design)

| Route | Method | Status | Notes |
|-------|--------|--------|-------|
| `/health` | GET | ok | Docker healthcheck |
| `/api/health` | GET | ok | CLI compatibility |
| `/api/setup/status` | GET | ok | First-run check |
| `/api/setup/init` | POST | ok | Creates first admin; `loginLimiter` applied; refuses re-init |
| `/api/auth/login` | POST | ok | API key login; `loginLimiter` applied |
| `/api/auth/logout` | POST | ok | No server state to revoke |
| `/api/validate/discord-token` | POST | ok | Validates a Discord token; no data returned |
| `/api/demo/flag` | GET | ok | Feature-gating flag, no data leak |
| `/api/sso/providers` | GET | ok | Only returns enabled/disabled booleans |
| `/api/openapi.json`, `/api/docs` | GET | ok | API surface is public by design |
| `/api/auth/2fa/verify` | POST | ok | Pre-auth step of login flow |
| `/api/auth/2fa/verify-backup` | POST | ok | Pre-auth step of login flow |

### Findings (open)

| Route | Method | Issue | Severity |
|-------|--------|-------|----------|
| `/api/runbooks` | GET | Reads all runbooks incl. user-created ones without `verifyAuth`; its POST siblings require auth | high |
| `/api/auth/2fa/setup` | POST | No auth; should require an authenticated session (setting up 2FA presumes login) | medium |
| `/api/auth/2fa/verify-setup` | POST | No auth; should require an authenticated session | medium |
| `/api/auth/2fa/disable` | POST | No auth; anyone could disable 2FA if they reach the proxy | medium |

### Protected (`verifyAuth`)

All `/api/apps*`, `/api/customers*`, `/api/metrics*`, `/api/backup*`,
`/api/alert-*`, `/api/scheduled-tasks*`, `/api/maintenance-windows*`,
`/api/workspaces`, `/api/secrets*`, `/api/webhooks*`, `/api/apikeys*`,
`/api/inventory*`, `/api/templates*`, `/api/runbooks` (POST/execute),
`/api/assistant/*`, `/api/graphql`, `/api/auth/2fa/backup-codes` — all
checked at last audit (170 routes).

## Update History

- 2026-08-08: initial matrix; federated `/api/` made fail-closed in
  production; runbooks GET and 2FA setup/verify-setup/disable flagged
  and fixed; audit payloads centrally sanitized (no tokens, secrets,
  env vars or webhook URLs in audit events).
