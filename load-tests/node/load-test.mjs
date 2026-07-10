#!/usr/bin/env node
/**
 * Backend API load tester (zero deps — Node 18+).
 *
 * Usage:
 *   node load-tests/node/load-test.mjs [options]
 *
 * Options:
 *   --base-url=http://localhost:3000
 *   --scenario=mixed|health|shorten|redirect|stats|all
 *   --concurrency=20
 *   --duration=30          seconds (ignored if --requests set)
 *   --requests=0          total requests (0 = use duration)
 *   --rps=0               target requests/sec per scenario (0 = unlimited)
 *   --warmup=50           seed short links before redirect/stats/mixed
 *   --timeout=10000       per-request timeout ms
 *   --json                print machine-readable summary
 *
 * Examples:
 *   npm run load:smoke
 *   npm run load:mixed -- --concurrency=50 --duration=60
 *   node load-tests/node/load-test.mjs --scenario=shorten --requests=1000 --concurrency=40
 */

import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    scenario: 'mixed',
    concurrency: 20,
    duration: 30,
    requests: 0,
    rps: 0,
    warmup: 50,
    timeout: 10000,
    json: false,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    const m = arg.match(/^--([a-z-]+)=(.*)$/i);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    switch (key) {
      case 'base-url':
        opts.baseUrl = val.replace(/\/$/, '');
        break;
      case 'scenario':
        opts.scenario = val;
        break;
      case 'concurrency':
        opts.concurrency = Math.max(1, Number(val) || 1);
        break;
      case 'duration':
        opts.duration = Math.max(1, Number(val) || 30);
        break;
      case 'requests':
        opts.requests = Math.max(0, Number(val) || 0);
        break;
      case 'rps':
        opts.rps = Math.max(0, Number(val) || 0);
        break;
      case 'warmup':
        opts.warmup = Math.max(0, Number(val) || 0);
        break;
      case 'timeout':
        opts.timeout = Math.max(1000, Number(val) || 10000);
        break;
      default:
        break;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
class Metrics {
  constructor(name) {
    this.name = name;
    this.latencies = [];
    this.statuses = new Map();
    this.errors = new Map();
    this.ok = 0;
    this.fail = 0;
    this.bytes = 0;
    this.start = 0;
    this.end = 0;
  }

  record(ms, status, ok, errMsg, byteLen = 0) {
    this.latencies.push(ms);
    if (ok) this.ok += 1;
    else this.fail += 1;
    const key = String(status ?? 'ERR');
    this.statuses.set(key, (this.statuses.get(key) || 0) + 1);
    if (errMsg) this.errors.set(errMsg, (this.errors.get(errMsg) || 0) + 1);
    this.bytes += byteLen;
  }

  percentile(p) {
    if (!this.latencies.length) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  }

  summary() {
    const total = this.ok + this.fail;
    const elapsedSec = Math.max(0.001, (this.end - this.start) / 1000);
    const avg =
      this.latencies.length === 0
        ? 0
        : this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
    return {
      name: this.name,
      total,
      ok: this.ok,
      fail: this.fail,
      errorRate: total ? this.fail / total : 0,
      rps: total / elapsedSec,
      durationSec: elapsedSec,
      latencyMs: {
        min: this.latencies.length ? Math.min(...this.latencies) : 0,
        avg,
        p50: this.percentile(50),
        p90: this.percentile(90),
        p95: this.percentile(95),
        p99: this.percentile(99),
        max: this.latencies.length ? Math.max(...this.latencies) : 0,
      },
      statuses: Object.fromEntries(this.statuses),
      topErrors: [...this.errors.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([message, count]) => ({ message, count })),
      bytes: this.bytes,
    };
  }
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
async function request(baseUrl, path, { method = 'GET', body, timeout, expect } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = performance.now();
  let status = 0;
  let ok = false;
  let errMsg = null;
  let byteLen = 0;
  let data = null;
  let headers = null;

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: '*/*' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: controller.signal,
    });
    status = res.status;
    headers = res.headers;
    const buf = Buffer.from(await res.arrayBuffer());
    byteLen = buf.length;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json') && buf.length) {
      try {
        data = JSON.parse(buf.toString('utf8'));
      } catch {
        data = null;
      }
    }

    if (typeof expect === 'function') {
      ok = expect({ status, data, headers, body: buf });
      if (!ok) errMsg = `unexpected response status=${status}`;
    } else if (Array.isArray(expect)) {
      ok = expect.includes(status);
      if (!ok) errMsg = `expected ${expect.join('|')}, got ${status}`;
    } else if (expect != null) {
      ok = status === expect;
      if (!ok) errMsg = `expected ${expect}, got ${status}`;
    } else {
      ok = status >= 200 && status < 400;
    }
  } catch (err) {
    errMsg = err.name === 'AbortError' ? 'timeout' : err.message || String(err);
    ok = false;
  } finally {
    clearTimeout(timer);
  }

  return {
    ms: performance.now() - started,
    status,
    ok,
    errMsg,
    byteLen,
    data,
    headers,
  };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
function randomUrl() {
  const id = randomBytes(6).toString('hex');
  return `https://example.com/load-test/${id}?t=${Date.now()}`;
}

async function warmupCodes(baseUrl, count, timeout) {
  const codes = [];
  const workers = Math.min(20, Math.max(1, count));
  let next = 0;

  async function worker() {
    while (next < count) {
      const i = next++;
      const res = await request(baseUrl, '/api/shorten', {
        method: 'POST',
        body: { url: randomUrl(), title: `warmup-${i}` },
        timeout,
        expect: [201],
      });
      if (res.ok && res.data?.code) codes.push(res.data.code);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return codes;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const scenarioDefs = {
  health: {
    weight: 1,
    run: (ctx) =>
      request(ctx.baseUrl, '/health', {
        timeout: ctx.timeout,
        expect: (r) => r.status === 200 && r.data?.status === 'ok',
      }),
  },
  shorten: {
    weight: 2,
    run: (ctx) =>
      request(ctx.baseUrl, '/api/shorten', {
        method: 'POST',
        body: { url: randomUrl(), title: 'load-test' },
        timeout: ctx.timeout,
        expect: [201],
      }).then((res) => {
        if (res.ok && res.data?.code) ctx.codes.push(res.data.code);
        // cap in-memory codes list
        if (ctx.codes.length > 5000) ctx.codes.splice(0, ctx.codes.length - 2500);
        return res;
      }),
  },
  redirect: {
    weight: 5,
    run: async (ctx) => {
      if (!ctx.codes.length) {
        return { ms: 0, status: 0, ok: false, errMsg: 'no codes seeded', byteLen: 0 };
      }
      const code = pick(ctx.codes);
      return request(ctx.baseUrl, `/${code}`, {
        timeout: ctx.timeout,
        expect: [302, 301],
      });
    },
  },
  stats: {
    weight: 2,
    run: async (ctx) => {
      if (!ctx.codes.length) {
        return { ms: 0, status: 0, ok: false, errMsg: 'no codes seeded', byteLen: 0 };
      }
      const code = pick(ctx.codes);
      return request(ctx.baseUrl, `/api/stats/${code}`, {
        timeout: ctx.timeout,
        expect: [200],
      });
    },
  },
  list: {
    weight: 1,
    run: (ctx) =>
      request(ctx.baseUrl, '/api/links?limit=20', {
        timeout: ctx.timeout,
        expect: [200],
      }),
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function runLoad(name, ops, opts, ctx) {
  const metrics = new Metrics(name);
  const { concurrency, duration, requests, rps, timeout } = opts;
  const endAt = requests > 0 ? Infinity : performance.now() + duration * 1000;
  let issued = 0;
  let stopped = false;
  const minInterval = rps > 0 ? 1000 / rps : 0;
  let nextSlot = performance.now();

  metrics.start = performance.now();

  async function worker() {
    while (!stopped) {
      if (requests > 0 && issued >= requests) break;
      if (requests === 0 && performance.now() >= endAt) break;

      if (minInterval > 0) {
        const now = performance.now();
        if (now < nextSlot) {
          await sleep(nextSlot - now);
        }
        nextSlot = Math.max(nextSlot + minInterval, performance.now());
      }

      issued += 1;
      const op = typeof ops === 'function' ? ops(ctx) : pickWeighted(ops);
      const result = await op.run(ctx);
      metrics.record(result.ms, result.status, result.ok, result.errMsg, result.byteLen);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  metrics.end = performance.now();
  return metrics;
}

function pickWeighted(defs) {
  const total = defs.reduce((s, d) => s + d.weight, 0);
  let r = Math.random() * total;
  for (const d of defs) {
    r -= d.weight;
    if (r <= 0) return d;
  }
  return defs[defs.length - 1];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function printSummary(summary, thresholds) {
  const lat = summary.latencyMs;
  const errPct = (summary.errorRate * 100).toFixed(2);
  console.log(`\n=== ${summary.name} ===`);
  console.log(`  requests : ${summary.total}  ok=${summary.ok}  fail=${summary.fail}  errors=${errPct}%`);
  console.log(`  throughput: ${summary.rps.toFixed(1)} req/s  over ${summary.durationSec.toFixed(2)}s`);
  console.log(
    `  latency  : min=${lat.min.toFixed(1)}  avg=${lat.avg.toFixed(1)}  p50=${lat.p50.toFixed(1)}  p90=${lat.p90.toFixed(1)}  p95=${lat.p95.toFixed(1)}  p99=${lat.p99.toFixed(1)}  max=${lat.max.toFixed(1)} ms`
  );
  console.log(`  statuses : ${JSON.stringify(summary.statuses)}`);
  if (summary.topErrors.length) {
    console.log(`  errors   : ${summary.topErrors.map((e) => `${e.message}×${e.count}`).join(', ')}`);
  }

  if (thresholds) {
    const checks = [];
    if (thresholds.maxErrorRate != null) {
      const pass = summary.errorRate <= thresholds.maxErrorRate;
      checks.push({ name: `error_rate<=${thresholds.maxErrorRate}`, pass, actual: summary.errorRate });
    }
    if (thresholds.p95Ms != null) {
      const pass = lat.p95 <= thresholds.p95Ms;
      checks.push({ name: `p95<=${thresholds.p95Ms}ms`, pass, actual: lat.p95 });
    }
    if (thresholds.minRps != null) {
      const pass = summary.rps >= thresholds.minRps;
      checks.push({ name: `rps>=${thresholds.minRps}`, pass, actual: summary.rps });
    }
    for (const c of checks) {
      console.log(`  threshold: ${c.pass ? 'PASS' : 'FAIL'} ${c.name} (actual=${typeof c.actual === 'number' ? c.actual.toFixed(3) : c.actual})`);
    }
    return checks.every((c) => c.pass);
  }
  return true;
}

async function preflight(baseUrl, timeout) {
  const res = await request(baseUrl, '/health', {
    timeout,
    expect: (r) => r.status === 200 && r.data?.status === 'ok',
  });
  if (!res.ok) {
    throw new Error(`API not healthy at ${baseUrl}/health (${res.errMsg || res.status})`);
  }
  return res.data;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`See header comment in load-tests/node/load-test.mjs for usage.`);
    process.exit(0);
  }

  const scenario = opts.scenario.toLowerCase();
  const valid = new Set(['mixed', 'health', 'shorten', 'redirect', 'stats', 'list', 'all']);
  if (!valid.has(scenario)) {
    console.error(`Unknown scenario "${scenario}". Use: ${[...valid].join(', ')}`);
    process.exit(2);
  }

  console.log(`Load test target: ${opts.baseUrl}`);
  console.log(
    `Scenario=${scenario} concurrency=${opts.concurrency} ` +
      `${opts.requests > 0 ? `requests=${opts.requests}` : `duration=${opts.duration}s`}` +
      `${opts.rps ? ` rps=${opts.rps}` : ''}`
  );

  const health = await preflight(opts.baseUrl, opts.timeout);
  console.log(`Preflight OK (db=${health.db} redis=${health.redis} redisConnected=${health.redisConnected})`);

  const ctx = {
    baseUrl: opts.baseUrl,
    timeout: opts.timeout,
    codes: [],
  };

  const needsCodes = ['redirect', 'stats', 'mixed', 'all'].includes(scenario);
  if (needsCodes && opts.warmup > 0) {
    process.stdout.write(`Warmup: creating ${opts.warmup} short links... `);
    ctx.codes = await warmupCodes(opts.baseUrl, opts.warmup, opts.timeout);
    console.log(`done (${ctx.codes.length} codes)`);
    if (!ctx.codes.length) throw new Error('Warmup failed — could not create short links');
  }

  const thresholdsByScenario = {
    health: { maxErrorRate: 0.01, p95Ms: 200 },
    shorten: { maxErrorRate: 0.02, p95Ms: 800 },
    redirect: { maxErrorRate: 0.01, p95Ms: 300 },
    stats: { maxErrorRate: 0.02, p95Ms: 500 },
    list: { maxErrorRate: 0.02, p95Ms: 600 },
    mixed: { maxErrorRate: 0.03, p95Ms: 700 },
  };

  const results = [];
  let allPass = true;

  async function runScenario(name) {
    let ops;
    if (name === 'mixed') {
      ops = [
        { ...scenarioDefs.health, weight: 1 },
        { ...scenarioDefs.shorten, weight: 2 },
        { ...scenarioDefs.redirect, weight: 5 },
        { ...scenarioDefs.stats, weight: 2 },
        { ...scenarioDefs.list, weight: 1 },
      ];
    } else {
      ops = scenarioDefs[name];
    }
    const metrics = await runLoad(name, ops, opts, ctx);
    const summary = metrics.summary();
    results.push(summary);
    const pass = printSummary(summary, thresholdsByScenario[name] || thresholdsByScenario.mixed);
    if (!pass) allPass = false;
  }

  if (scenario === 'all') {
    for (const name of ['health', 'shorten', 'redirect', 'stats', 'list', 'mixed']) {
      await runScenario(name);
    }
  } else {
    await runScenario(scenario);
  }

  if (opts.json) {
    console.log('\n' + JSON.stringify({ ok: allPass, results }, null, 2));
  }

  console.log(allPass ? '\nLoad test finished: PASS' : '\nLoad test finished: FAIL (thresholds breached)');
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Load test aborted:', err.message || err);
  process.exit(1);
});
