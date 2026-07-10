/**
 * Average-load test — mixed read-heavy traffic (redirects dominate).
 *
 *   k6 run load-tests/k6/load.js
 *   k6 run -e BASE_URL=http://localhost:3000 -e WARMUP=80 load-tests/k6/load.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { baseUrl, defaultThresholds, jsonHeaders, shortenPayload } from './helpers.js';

const WARMUP = Number(__ENV.WARMUP || 60);

export const options = {
  scenarios: {
    average_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '2m', target: 40 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    ...defaultThresholds,
    'http_req_duration{name:redirect}': ['p(95)<300'],
    'http_req_duration{name:shorten}': ['p(95)<800'],
    checks: ['rate>0.97'],
  },
};

// Seed codes once before VUs start (setup runs in init context separately).
export function setup() {
  const root = baseUrl();
  const codes = [];
  for (let i = 0; i < WARMUP; i++) {
    const res = http.post(`${root}/api/shorten`, shortenPayload({ title: `warmup-${i}` }), {
      headers: jsonHeaders(),
    });
    if (res.status === 201) {
      try {
        codes.push(res.json('code'));
      } catch {
        /* ignore */
      }
    }
  }
  if (!codes.length) {
    throw new Error('setup: failed to seed short links — is the API up?');
  }
  return { codes };
}

export default function (data) {
  const root = baseUrl();
  const codes = data.codes;
  const roll = Math.random();

  if (roll < 0.08) {
    const res = http.get(`${root}/health`, { tags: { name: 'health' } });
    check(res, { 'health ok': (r) => r.status === 200 });
  } else if (roll < 0.28) {
    const res = http.post(`${root}/api/shorten`, shortenPayload(), {
      headers: jsonHeaders(),
      tags: { name: 'shorten' },
    });
    check(res, { 'shorten 201': (r) => r.status === 201 });
    if (res.status === 201) {
      try {
        codes.push(res.json('code'));
      } catch {
        /* ignore */
      }
    }
  } else if (roll < 0.48) {
    const code = codes[Math.floor(Math.random() * codes.length)];
    const res = http.get(`${root}/api/stats/${code}`, { tags: { name: 'stats' } });
    check(res, { 'stats 200': (r) => r.status === 200 });
  } else if (roll < 0.55) {
    const res = http.get(`${root}/api/links?limit=20`, { tags: { name: 'list' } });
    check(res, { 'list 200': (r) => r.status === 200 });
  } else {
    const code = codes[Math.floor(Math.random() * codes.length)];
    const res = http.get(`${root}/${code}`, { redirects: 0, tags: { name: 'redirect' } });
    check(res, { 'redirect 3xx': (r) => r.status === 302 || r.status === 301 });
  }

  sleep(Math.random() * 0.4);
}
