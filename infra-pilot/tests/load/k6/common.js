// Shared helpers for the Infra Pilot load test scenarios.
//
// Environment variables (all optional except where noted):
//   K6_TARGET_ORCHESTRATOR  Base URL of the orchestrator agent.
//                           Default: http://localhost:8500
//   K6_TARGET_PANEL         Base URL of the management panel backend.
//                           Set to an empty value to disable panel checks
//                           (used in CI where only the orchestrator runs).
//   K6_FEDERATION_TOKEN     Bearer token for /api/ routes. When set on the
//                           server the orchestrator fails closed, so the
//                           client token must match it.
//   K6_GITOPS_WEBHOOK_TOKEN HMAC-SHA256 key used to sign /webhook/gitops
//                           POSTs. Must match GITOPS_WEBHOOK_TOKEN of the
//                           orchestrator.
//   K6_MANIFEST_COUNT       Instances per deployment manifest (default 1).
//
// Every request carries the tag `type`, which the scenario files use to
// define per-endpoint thresholds, e.g. http_req_duration{type:deployments}.
import http from 'k6/http';
import { check } from 'k6';
import crypto from 'k6/crypto';

export const TARGET_ORCHESTRATOR =
  __ENV.K6_TARGET_ORCHESTRATOR || 'http://localhost:8500';
// The panel checks are disabled when the variable is unset OR empty
// (in CI only the orchestrator runs, so "" must not fall back to a URL).
const panelTarget = __ENV.K6_TARGET_PANEL;
export const TARGET_PANEL =
  panelTarget === undefined || panelTarget === '' ? '' : panelTarget;

const FEDERATION_TOKEN = __ENV.K6_FEDERATION_TOKEN || '';
const GITOPS_TOKEN = __ENV.K6_GITOPS_WEBHOOK_TOKEN || '';

export function federationHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (FEDERATION_TOKEN) {
    headers.Authorization = `Bearer ${FEDERATION_TOKEN}`;
  }
  return headers;
}

function hmacSha256Hex(secret, message) {
  const hasher = crypto.createHMAC('sha256', secret);
  hasher.update(message);
  return hasher.digest('hex');
}

// Signs the exact string that is sent over the wire. The orchestrator
// expects X-Timestamp within its replay window and X-Signature-256 =
// sha256=<HMAC-SHA256(GITOPS_WEBHOOK_TOKEN, "<X-Timestamp>\n<body")>.
export function gitopsHeaders(bodyString) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = 'sha256=' + hmacSha256Hex(GITOPS_TOKEN, `${timestamp}\n${bodyString}`);
  return {
    'Content-Type': 'application/json',
    'X-Timestamp': timestamp,
    'X-Signature-256': signature,
  };
}

// Builds a valid InfraFile manifest. dry_run requests never touch the
// compute provider, so load tests stay free of real Docker containers.
export function makeManifest(seed) {
  const count = Number(__ENV.K6_MANIFEST_COUNT) || 1;
  const instances = [];
  for (let i = 0; i < count; i++) {
    instances.push({
      name: `loadtest-${seed}-${i}`,
      provider: 'docker',
      image: 'ubuntu:22.04',
      cpu: 0.5,
      memory_mb: 256,
      storage_gb: 1,
      ports: {},
      env: {},
      labels: {},
      region: 'default',
      ssh_keys: [],
      user_data: '',
      network: '',
      health_check: null,
      auto_remediate: true,
    });
  }
  return {
    api_version: 'v1',
    kind: 'InfraFile',
    metadata: {
      name: 'loadtest',
      region: 'default',
      project: 'default',
      environment: 'test',
      labels: { source: 'k6' },
    },
    spec: { instances, networks: [], storage: [] },
  };
}

// Hits every orchestrator endpoint. `writes` enables RBAC create calls,
// which persist rows and grow in-memory state; scenarios that run for a
// long time (soak, spike) keep writes off so state stays bounded.
export function hitOrchestrator(seed, { writes = false } = {}) {
  const auth = federationHeaders();

  const healthy = http.get(`${TARGET_ORCHESTRATOR}/health`, {
    tags: { type: 'health' },
  });
  check(healthy, { 'orchestrator /health 2xx': (r) => r.status >= 200 && r.status < 300 });

  const metricsRes = http.get(`${TARGET_ORCHESTRATOR}/metrics`, {
    tags: { type: 'metrics' },
  });
  check(metricsRes, { 'orchestrator /metrics 200': (r) => r.status === 200 });

  const federationStatus = http.get(
    `${TARGET_ORCHESTRATOR}/api/v1/federation/status`,
    { headers: auth, tags: { type: 'federation-status' } }
  );
  check(federationStatus, { 'federation status 200': (r) => r.status === 200 });

  const roles = http.get(`${TARGET_ORCHESTRATOR}/api/v1/rbac/roles`, {
    headers: auth,
    tags: { type: 'rbac-roles' },
  });
  check(roles, { 'rbac roles list 200': (r) => r.status === 200 });

  const orgs = http.get(
    `${TARGET_ORCHESTRATOR}/api/v1/rbac/orgs?user_id=loadtest-user-${__VU}`,
    { headers: auth, tags: { type: 'rbac-orgs' } }
  );
  check(orgs, { 'rbac orgs list 200': (r) => r.status === 200 });

  if (writes) {
    // One role per VU, created on the first iteration. Later iterations
    // get 400 for the duplicate, which is expected and accepted.
    const roleCreate = http.post(
      `${TARGET_ORCHESTRATOR}/api/v1/rbac/roles`,
      JSON.stringify({
        name: `loadtest-role-${__VU}`,
        permissions: ['manifest:deploy', 'instance:read'],
      }),
      { headers: auth, tags: { type: 'rbac-role-create' } }
    );
    check(roleCreate, {
      'rbac role create 201 or 400': (r) => r.status === 201 || r.status === 400,
    });
  }

  const deployBody = JSON.stringify({
    manifest: makeManifest(seed),
    dry_run: true,
  });
  const deploy = http.post(
    `${TARGET_ORCHESTRATOR}/api/v1/deployments`,
    deployBody,
    { headers: auth, tags: { type: 'deployments' } }
  );
  check(deploy, { 'deployments dry-run 2xx': (r) => r.status === 200 || r.status === 207 });

  const gitopsBody = JSON.stringify({
    manifest: makeManifest(seed + 1000),
    dry_run: true,
  });
  const gitops = http.post(
    `${TARGET_ORCHESTRATOR}/webhook/gitops`,
    gitopsBody,
    { headers: gitopsHeaders(gitopsBody), tags: { type: 'gitops-webhook' } }
  );
  check(gitops, {
    'gitops webhook 2xx': (r) => r.status === 200 || r.status === 207,
  });
}

// Hits the management panel backend. Skipped entirely when
// K6_TARGET_PANEL is empty (e.g. CI jobs without a panel instance).
export function hitPanel() {
  if (!TARGET_PANEL) {
    return;
  }

  const healthy = http.get(`${TARGET_PANEL}/health`, {
    tags: { type: 'panel-health' },
  });
  check(healthy, { 'panel /health 200': (r) => r.status === 200 });

  const demoFlag = http.get(`${TARGET_PANEL}/api/demo/flag`, {
    tags: { type: 'panel-demo-flag' },
  });
  check(demoFlag, { 'panel demo flag 200': (r) => r.status === 200 });

  const setupStatus = http.get(`${TARGET_PANEL}/api/setup/status`, {
    tags: { type: 'panel-setup-status' },
  });
  check(setupStatus, { 'panel setup status 200': (r) => r.status === 200 });
}