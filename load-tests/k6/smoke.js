/**
 * Smoke test — small traffic, validates core API paths.
 *
 *   k6 run load-tests/k6/smoke.js
 *   k6 run -e BASE_URL=http://localhost:3000 load-tests/k6/smoke.js
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { baseUrl, jsonHeaders, shortenPayload } from './helpers.js';

export const options = {
  vus: 2,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const root = baseUrl();

  group('health', () => {
    const res = http.get(`${root}/health`);
    check(res, {
      'health 200': (r) => r.status === 200,
      'health ok': (r) => {
        try {
          return r.json('status') === 'ok';
        } catch {
          return false;
        }
      },
    });
  });

  let code = null;
  group('shorten', () => {
    const res = http.post(`${root}/api/shorten`, shortenPayload(), { headers: jsonHeaders() });
    check(res, {
      'shorten 201': (r) => r.status === 201,
      'shorten has code': (r) => {
        try {
          code = r.json('code');
          return typeof code === 'string' && code.length >= 3;
        } catch {
          return false;
        }
      },
    });
  });

  if (code) {
    group('stats', () => {
      const res = http.get(`${root}/api/stats/${code}`);
      check(res, {
        'stats 200': (r) => r.status === 200,
        'stats code match': (r) => {
          try {
            return r.json('code') === code;
          } catch {
            return false;
          }
        },
      });
    });

    group('redirect', () => {
      const res = http.get(`${root}/${code}`, { redirects: 0 });
      check(res, {
        'redirect 302': (r) => r.status === 302 || r.status === 301,
        'has location': (r) => !!r.headers.Location,
      });
    });
  }

  group('list', () => {
    const res = http.get(`${root}/api/links?limit=10`);
    check(res, { 'list 200': (r) => r.status === 200 });
  });

  sleep(0.3);
}
