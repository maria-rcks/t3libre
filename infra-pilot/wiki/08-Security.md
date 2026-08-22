# Security

## AI Data

If you enable AI features, some server data may be sent to the AI provider.

**Local mode** (data stays on your machine):

```env
AI_API_ENDPOINT=http://localhost:1234/v1
AI_API_KEY=not-needed
AI_MODEL=llama3-8b
```

## Tracking

None. The tool does not track you. No data is sent home.

## Secrets Management

- `.env` is ignored by git — never commit it
- Use environment variables or a secrets tool (Vault works)
- TLS for data in transit. Fernet for data at rest.

## Security Features

JWT auth · RBAC · 2FA/TOTP · WebAuthn/Passkeys · PAM (JIT access) · Audit trail

## Deploy Chain & API Auth

The deployment chain is **CLI → Management Panel (3001) → Orchestrator (8500)**:

1. `ipilot deploy <server> <branch> [--repo-url <git-url>]` sends the
   deployment to the panel's `POST /api/deployments` (default API URL is
   the panel; override with `IPILOT_API_URL`).
2. The panel stores the record in `shared_config` and — when
   `ORCHESTRATOR_API_TOKEN` is configured (see helm `managementPanel.env`) —
   forwards an `InfraFile` manifest to the orchestrator's
   `POST /api/v1/deployments`. Without the token configured the panel
   keeps its store-only behavior.
3. The orchestrator runs `ManifestEngine.reconcile` against the compute
   providers. The federation token fails closed in production
   (`FEDERATION_API_TOKEN` required); an optional `user_id`+`org_id` pair
   in the body is checked against the `manifest:deploy` RBAC permission.

GitOps push webhook: `POST /webhook/gitops` accepts the same manifest body
and runs the identical reconcile path, guarded by an HMAC-SHA256 signature
(`X-Signature-256: sha256=<hex>`) computed with `GITOPS_WEBHOOK_TOKEN` over
the `X-Timestamp` header and the exact request body bytes
(`sha256=HMAC(GITOPS_WEBHOOK_TOKEN, "{X-Timestamp}\n{body}")`). The
timestamp must be inside the replay window and each signature is accepted
only once (fails closed when the token is unset), which blocks replays of
captured requests. GitHub's own webhook signing covers only the body, so a
direct GitHub webhook must be routed through a proxy that injects the
timestamp and signature.

RBAC state persistence: `rbac_store` persists organization, custom-role and
role-assignment **creations and updates** best-effort to Postgres and
re-loads them on orchestrator start. Deletions and revocations are **not**
persisted, so a deleted organization or a revoked assignment can reappear
after a restart. A missing database degrades to the in-memory engine
instead of blocking the API, and persistence failures are surfaced as
`rbac_persist_failures_total` on `/metrics`.

## Reporting Issues

**Do not** open public issues. Email the maintainers (see [`SECURITY.md`](https://github.com/drosemann/infra-pilot/blob/main/SECURITY.md)). Expect a reply within 48 hours.

---

*See [SECURITY.md](https://github.com/drosemann/infra-pilot/blob/main/SECURITY.md) for the full security policy.*
