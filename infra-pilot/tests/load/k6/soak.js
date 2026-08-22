// Soak test: sustained medium traffic over a long period to surface
// memory leaks, connection-pool exhaustion and slow state growth.
//
// Tuning via environment:
//   K6_SOAK_VUS       concurrent virtual users (default 50)
//   K6_SOAK_DURATION  run length as a k6 duration, e.g. 30m, 2h
//                     (default 30m; use shorter values for CI runtimes)
import { sleep } from 'k6';
import { hitOrchestrator, hitPanel } from './common.js';

const VUS = Number(__ENV.K6_SOAK_VUS) || 50;
const DURATION = __ENV.K6_SOAK_DURATION || '30m';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{type:health}': ['p(95)<300'],
    'http_req_duration{type:metrics}': ['p(95)<500'],
    'http_req_duration{type:federation-status}': ['p(95)<500'],
    'http_req_duration{type:rbac-roles}': ['p(95)<500'],
    'http_req_duration{type:rbac-orgs}': ['p(95)<500'],
    'http_req_duration{type:deployments}': ['p(95)<2000', 'p(99)<4000'],
    'http_req_duration{type:gitops-webhook}': ['p(95)<2000', 'p(99)<4000'],
    'http_req_duration{type:panel-health}': ['p(95)<300'],
    'http_req_duration{type:panel-demo-flag}': ['p(95)<500'],
    'http_req_duration{type:panel-setup-status}': ['p(95)<500'],
  },
};

export default function () {
  // Realistic user pacing: one request mix every 0.5-1.5s per VU.
  // Writes stay disabled so in-memory RBAC state and the database do
  // not grow unboundedly over hours.
  hitOrchestrator(__VU * 100000 + __ITER);
  hitPanel();
  sleep(0.5 + Math.random());
}