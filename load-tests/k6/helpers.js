/**
 * Shared helpers for k6 load tests.
 * Override base URL: k6 run -e BASE_URL=http://localhost:3000 load-tests/k6/load.js
 */

export function baseUrl() {
  return (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function randomPath() {
  return `https://example.com/k6/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function jsonHeaders() {
  return { 'Content-Type': 'application/json', Accept: 'application/json' };
}

export function shortenPayload(extra = {}) {
  return JSON.stringify({
    url: randomPath(),
    title: 'k6-load',
    ...extra,
  });
}

/** Default thresholds used across scenarios (override per script if needed). */
export const defaultThresholds = {
  http_req_failed: ['rate<0.03'],
  http_req_duration: ['p(95)<700', 'p(99)<1500'],
};
