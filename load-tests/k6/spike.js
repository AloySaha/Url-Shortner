/**
 * Spike test — sudden traffic burst (e.g. campaign launch).
 *
 *   k6 run load-tests/k6/spike.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { baseUrl, jsonHeaders, shortenPayload } from './helpers.js';

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 10 },
        { duration: '10s', target: 100 }, // spike
        { duration: '1m', target: 100 },
        { duration: '20s', target: 10 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.1'],
    http_req_duration: ['p(95)<1500'],
  },
};

export function setup() {
  const root = baseUrl();
  const codes = [];
  for (let i = 0; i < 80; i++) {
    const res = http.post(`${root}/api/shorten`, shortenPayload(), { headers: jsonHeaders() });
    if (res.status === 201) {
      try {
        codes.push(res.json('code'));
      } catch {
        /* ignore */
      }
    }
  }
  if (!codes.length) throw new Error('setup failed');
  return { codes };
}

export default function (data) {
  const root = baseUrl();
  // Spike traffic is mostly redirects (real-world short-link pattern).
  if (Math.random() < 0.15) {
    const res = http.post(`${root}/api/shorten`, shortenPayload(), { headers: jsonHeaders() });
    check(res, { shorten: (r) => r.status === 201 });
  } else {
    const code = data.codes[Math.floor(Math.random() * data.codes.length)];
    const res = http.get(`${root}/${code}`, { redirects: 0 });
    check(res, { redirect: (r) => r.status === 302 || r.status === 301 });
  }
  sleep(0.1);
}
