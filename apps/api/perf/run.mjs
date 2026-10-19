// Measures the endpoints that carry the daily load and fails when one is slower than its budget.
// Each request comes from a different address, as real traffic does (rate limits are per address).
// Usage: node perf/run.mjs <adminToken> <driverToken>
import { appendFileSync } from 'node:fs';
import autocannon from 'autocannon';

const [admin, driver] = process.argv.slice(2);
const base = process.env.PERF_URL ?? 'http://localhost:3000';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

// Budgets for the 97.5th percentile (ms), with headroom for a shared CI machine.
const cases = [
  { name: 'Driver location report', method: 'POST', path: '/v1/driver/location', token: driver, budget: 250,
    body: JSON.stringify({ points: [{ lat: 24.866, lng: 46.828, heading: 90, speedKmh: 35 }] }) },
  { name: 'Dispatch board (today)', method: 'GET', path: `/v1/admin/dispatch?date=${today}`, token: admin, budget: 1500 },
  { name: 'Dispatch board, late tab', method: 'GET', path: `/v1/admin/dispatch?date=${today}&view=late`, token: admin, budget: 1500 },
  { name: 'Reports, 30 days', method: 'GET', path: '/v1/admin/analytics', token: admin, budget: 250 },
  { name: 'Subscriptions list', method: 'GET', path: '/v1/admin/subscriptions?page=1&pageSize=20', token: admin, budget: 400 },
  { name: 'Payments list', method: 'GET', path: '/v1/admin/payments?page=1&pageSize=20', token: admin, budget: 400 },
];

const ip = () => `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}`;
const run = (c) =>
  autocannon({
    url: base + c.path,
    connections: 20,
    duration: 10,
    requests: [{
      method: c.method,
      setupRequest: (req) => ({
        ...req,
        headers: { ...req.headers, 'x-forwarded-for': ip(), 'content-type': 'application/json', authorization: `Bearer ${c.token}` },
        body: c.body,
      }),
    }],
  });

const rows = [];
let failed = false;
for (const c of cases) {
  const r = await run(c);
  const non2xx = r.non2xx + r.errors + r.timeouts;
  const p95 = r.latency.p97_5 ?? r.latency.p99;
  const ok = p95 <= c.budget && non2xx === 0;
  failed ||= !ok;
  rows.push(`| ${c.name} | ${Math.round(r.requests.average)} | ${r.latency.p50} | ${p95} | ${c.budget} | ${non2xx} | ${ok ? 'ok' : 'SLOW'} |`);
  console.log(`${ok ? 'ok  ' : 'SLOW'} ${c.name}: ${Math.round(r.requests.average)} req/s, p50 ${r.latency.p50} ms, p97.5 ${p95} ms (budget ${c.budget}), failed ${non2xx}`);
}

const table = ['| Endpoint | req/s | p50 ms | p97.5 ms | budget ms | failed | |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Performance (1,500 subscribers, ~186k trips)\n\n${table}\n`);
process.exit(failed ? 1 : 0);
