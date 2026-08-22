// Spike test: a sharp ramp from zero to many VUs in one minute to find
// timeouts, crashes and pool exhaustion under sudden traffic. The drop
// back to zero checks graceful shutdown and connection cleanup.
//
// Tuning via environment:
//   K6_SPIKE_MAX_VU  peak concurrent users (default 500)
import { sleep } from 'k6';
import { hitOrchestrator, hitPanel } from './common.js';

const MAX_VU = Number(__ENV.K6_SPIKE_MAX_VU) || 500;

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: MAX_VU },
        { duration: '2m', target: MAX_VU },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{type:health}': ['p(95)<1000'],
    'http_req_duration{type:metrics}': ['p(95)<1500'],
    'http_req_duration{type:federation-status}': ['p(95)<1500'],
    'http_req_duration{type:rbac-roles}': ['p(95)<1500'],
    'http_req_duration{type:rbac-orgs}': ['p(95)<1500'],
    'http_req_duration{type:deployments}': ['p(95)<3000', 'p(99)<5000'],
    'http_req_duration{type:gitops-webhook}': ['p(95)<3000', 'p(99)<5000'],
    'http_req_duration{type:panel-health}': ['p(95)<1000'],
    'http_req_duration{type:panel-demo-flag}': ['p(95)<1500'],
    'http_req_duration{type:panel-setup-status}': ['p(95)<1500'],
  },
};

export default function () {
  // No artificial pacing: VUs hammer the endpoints as fast as possible.
  // Writes stay disabled; a spike creates no state.
  hitOrchestrator(__VU * 100000 + __ITER);
  hitPanel();
  if (__ITER % 10 === 0) {
    sleep(1);
  }
}