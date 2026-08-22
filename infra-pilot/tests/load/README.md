# Load Testing (k6)

[k6](https://k6.io) scenarios that exercise the orchestrator-agent API
(`:8500`) and the management panel backend (`:3001`) for real. The
deployment endpoints always run with `dry_run: true`, so no production
Docker containers are ever created by a load test.

## Scenarios

| File        | Purpose                                                             | Default load           |
|-------------|---------------------------------------------------------------------|------------------------|
| `smoke.js`  | Every endpoint under minimal traffic; tight thresholds. Runs in CI on every PR touching `tests/load/**`. | 2 VUs, 45s |
| `soak.js`   | Sustained medium traffic to surface memory leaks and pool exhaustion. | 50 VUs, 30m |
| `spike.js`  | Ramp 0 -> N VUs in 1 minute to find timeouts and crashes.           | 500 VUs peak, 4m |

All scenarios fail (non-zero exit) when a threshold is exceeded, which
makes them usable as CI gates. Thresholds live at the top of each file
(`options.thresholds`) and are per endpoint via the `type` tag, e.g.
`http_req_duration{type:deployments}`.

## Environment variables

| Variable                  | Default               | Use                                                        |
|---------------------------|-----------------------|------------------------------------------------------------|
| `K6_TARGET_ORCHESTRATOR`  | `http://localhost:8500` | Orchestrator base URL                                    |
| `K6_TARGET_PANEL`         | `http://localhost:3001` | Panel backend base URL; empty disables panel checks      |
| `K6_FEDERATION_TOKEN`     | *(empty)*             | Bearer token for `/api/` routes. Must match the server's `FEDERATION_API_TOKEN` |
| `K6_GITOPS_WEBHOOK_TOKEN` | *(empty)*             | HMAC key for signed `/webhook/gitops` POSTs. Must match `GITOPS_WEBHOOK_TOKEN` |
| `K6_MANIFEST_COUNT`       | `1`                   | Instances per deployment manifest                        |
| `K6_SOAK_VUS`             | `50`                  | Soak concurrent users                                     |
| `K6_SOAK_DURATION`        | `30m`                 | Soak run length (k6 duration, e.g. `30m`, `2h`)           |
| `K6_SPIKE_MAX_VU`         | `500`                 | Spike peak virtual users                                  |

## Running locally (Docker Compose)

The `loadtest` compose service (profile `loadtest`) waits for the
orchestrator healthcheck and runs the scenario selected via `K6_SCENARIO`
(default `smoke`), writing `loadtest-results.json` into
`tests/load/k6/` (gitignored).

```bash
# 1. Prepare .env (POSTGRES_PASSWORD etc.)
cp .env.example .env && bash scripts/generate-env.sh

# 2. Start the stack (postgres, redis, orchestrator, panel)
docker compose --profile loadtest up postgres redis orchestrator-agent management-panel -d

# 3. Run the smoke scenario
docker compose --profile loadtest run --rm loadtest

# Soak / spike (compose interpolates K6_SCENARIO from the environment)
K6_SCENARIO=soak docker compose --profile loadtest run --rm loadtest
K6_SCENARIO=spike docker compose --profile loadtest run --rm loadtest
```

Or via the Makefile targets: `make load-smoke`, `make load-soak`,
`make load-spike`.

Install k6 on the host to run without Docker: `winget install grafana.k6`,
then `k6 run tests/load/k6/smoke.js`.

## Running in CI

`.github/workflows/load-test.yml` starts a throwaway orchestrator
(postgres + redis as service containers), applies the alembic schema
and runs k6:

- **Pull requests** touching `tests/load/**`: smoke scenario only.
- **Manual dispatch** (`Actions` -> `Load Test` -> `Run workflow`):
  choose `smoke`, `soak` or `spike` and optional tuning inputs. Soak
  defaults to 10 minutes in CI to fit runner time limits.

Results are attached as a workflow artifact (`k6-<scenario>-results.json`).

## Rules for meaningful results

1. **Never point scenarios at production.** Deployments are dry-run, but
   the RBAC smoke writes and rate limiters still affect shared state.
   Use a staging stack (own postgres, own Docker daemon).
2. **Keep client tokens in sync with the server.** When
   `FEDERATION_API_TOKEN` is set on the orchestrator, `/api/` routes
   fail closed; a mismatch turns every request into a 401 and the test
   fails loudly, which is the correct behaviour.
3. **Soak/spike keep RBAC writes disabled** on purpose: create calls
   persist rows and grow in-memory state, so unbounded iterations would
   test state growth instead of the code under test. To profile state
   growth, run the smoke scenario with `--vus` and `--duration` overrides
   instead.
4. **Beware the 429s.** If you add rate-limited panel endpoints
   (`/api/customers`, `/api/metrics/realtime`, ...) to a scenario,
   count 429 responses as expected in the checks and exempt them from
   the `http_req_failed` threshold.
5. **Tune thresholds to your hardware.** The defaults assume a healthy
   dev/staging box; document the p95/p99 numbers you measure and the
   concurrency at which latency first breaks (your documented capacity).