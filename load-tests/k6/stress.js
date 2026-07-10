/**
 * Stress test — ramp past expected capacity to find breaking points.
 *
 *   k6 run load-tests/k6/stress.js
 *   k6 run -e BASE_URL=http://localhost:3000 load-tests/k6/stress.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { baseUrl, jsonHeaders, shortenPayload } from './helpers.js';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '1m', target: 150 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Stress is expected to degrade — track but allow higher error/latency.
    http_req_failed: ['rate<0.15'],
    http_req_duration: ['p(95)<2000'],
  },
};

export function setup() {
  const root = baseUrl();
  const codes = [];
  for (let i = 0; i < 100; i++) {
    const res = http.post(`${root}/api/shorten`, shortenPayload(), { headers: jsonHeaders() });
    if (res.status === 201) {
      try {
        codes.push(res.json('code'));
      } catch {
        /* ignore */
      }
    }
  }
  if (!codes.length) throw new Error('setup failed — API unreachable?');
  return { codes };
}

export default function (data) {
  const root = baseUrl();
  const code = data.codes[Math.floor(Math.random() * data.codes.length)];
  const roll = Math.random();

  if (roll < 0.25) {
    const res = http.post(`${root}/api/shorten`, shortenPayload(), {
      headers: jsonHeaders(),
      tags: { name: 'shorten' },
    });
    check(res, { created: (r) => r.status === 201 });
  } else if (roll < 0.4) {
    const res = http.get(`${root}/api/stats/${code}`, { tags: { name: 'stats' } });
    check(res, { stats: (r) => r.status === 200 });
  } else {
    const res = http.get(`${root}/${code}`, { redirects: 0, tags: { name: 'redirect' } });
    check(res, { redirect: (r) => r.status === 302 || r.status === 301 });
  }

  sleep(0.05);
}
