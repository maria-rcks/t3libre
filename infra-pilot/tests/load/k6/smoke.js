// Smoke test: low traffic over every endpoint to verify the stack
// responds correctly under minimal load. Runs on every PR that touches
// tests/load/** in CI, so thresholds are tight.
import { sleep } from 'k6';
import { hitOrchestrator, hitPanel } from './common.js';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 2,
      duration: '45s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{type:health}': ['p(95)<300'],
    'http_req_duration{type:metrics}': ['p(95)<300'],
    'http_req_duration{type:federation-status}': ['p(95)<500'],
    'http_req_duration{type:rbac-roles}': ['p(95)<500'],
    'http_req_duration{type:rbac-orgs}': ['p(95)<500'],
    'http_req_duration{type:rbac-role-create}': ['p(95)<500'],
    'http_req_duration{type:deployments}': ['p(95)<1500', 'p(99)<2500'],
    'http_req_duration{type:gitops-webhook}': ['p(95)<1500', 'p(99)<2500'],
    'http_req_duration{type:panel-health}': ['p(95)<300'],
    'http_req_duration{type:panel-demo-flag}': ['p(95)<500'],
    'http_req_duration{type:panel-setup-status}': ['p(95)<500'],
  },
};

export default function () {
  // Writes are enabled: two VUs create one role each at most, then keep
  // hitting the faster duplicate path for the rest of the run.
  hitOrchestrator(__VU * 100000 + __ITER, { writes: true });
  hitPanel();
  sleep(1);
}