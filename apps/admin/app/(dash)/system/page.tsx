'use client';

import { useEffect } from 'react';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api } from '@/lib/client';
import { fill } from '@/lib/i18n';

interface Timing {
  count: number;
  errors: number;
  p50: number;
  p95: number;
  max: number;
}
interface Route extends Timing {
  route: string;
}
interface Job {
  name: string;
  lastRunAt: string;
  ok: boolean;
  durationMs: number;
  error: string | null;
  runs: number;
  failures: number;
}
interface SystemStatus {
  startedAt: string;
  uptimeSeconds: number;
  version: string | null;
  memoryMb: number;
  db: { ok: boolean; ms: number };
  redis: { ok: boolean; ms: number };
  requests: Timing;
  lastHour: Timing;
  routes: Route[];
  slowest: Route[];
  jobs: Job[];
  you: { ip: string | null };
}

/** How the API is doing right now: response times, errors, database, Redis and background jobs. */
export default function SystemPage() {
  const { t, lang } = useApp();
  const s = useLoad(() => api<SystemStatus>('admin/system'), []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void s.reload();
    }, 15_000);
    return () => clearInterval(id);
  }, [s.reload]);

  const d = s.data;
  const tt = t.system;
  const uptime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? fill(tt.hoursMinutes, { h, m }) : fill(tt.minutes, { m });
  };
  const when = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
      timeZone: 'Asia/Riyadh',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  const speed = (p95: number) => (p95 <= 300 ? 'active' : p95 <= 1000 ? 'pending' : 'suspended');

  return (
    <>
      <div className="page-head">
        <h1>{tt.title}</h1>
      </div>
      <p className="lede">{tt.intro}</p>
      <LoadState loading={s.loading && !d} error={s.error} onRetry={s.reload} />
      {d && (
        <>
          <dl className="stats">
            <div className="stat">
              <dt>{tt.database}</dt>
              <dd className={d.db.ok ? 'ok' : 'bad'}>{d.db.ok ? fill(tt.okMs, { ms: d.db.ms }) : tt.down}</dd>
            </div>
            <div className="stat">
              <dt>Redis</dt>
              <dd className={d.redis.ok ? 'ok' : 'bad'}>{d.redis.ok ? fill(tt.okMs, { ms: d.redis.ms }) : tt.down}</dd>
            </div>
            <div className="stat">
              <dt>{tt.p95}</dt>
              <dd className="tabnum">{d.requests.count ? `${d.requests.p95} ms` : '—'}</dd>
            </div>
            <div className="stat">
              <dt>{tt.errors}</dt>
              <dd className={`tabnum ${d.requests.errors ? 'bad' : ''}`}>
                {d.requests.errors} / {d.requests.count}
              </dd>
            </div>
          </dl>
          <p className="hint system-meta">
            {fill(tt.meta, { uptime: uptime(d.uptimeSeconds), mem: d.memoryMb, hour: d.lastHour.count })}
            {d.version && ` · ${d.version}`} · {fill(tt.yourIp, { ip: d.you.ip ?? '—' })}
          </p>

          <section className="panel system-panel">
            <h2 className="panel-title">{tt.slowest}</h2>
            {d.slowest.length === 0 ? (
              <p className="empty">{tt.noTraffic}</p>
            ) : (
              <RouteTable routes={d.slowest} speed={speed} tt={tt} />
            )}
          </section>

          <section className="panel system-panel">
            <h2 className="panel-title">{tt.jobs}</h2>
            {d.jobs.length === 0 ? (
              <p className="empty">{tt.noJobs}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{tt.job}</th>
                      <th scope="col">{tt.lastRun}</th>
                      <th scope="col">{tt.duration}</th>
                      <th scope="col">{tt.runs}</th>
                      <th scope="col">{tt.result}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.jobs.map((j) => (
                      <tr key={j.name}>
                        <td>{tt.jobNames[j.name as keyof typeof tt.jobNames] ?? j.name}</td>
                        <td className="tabnum">{when(j.lastRunAt)}</td>
                        <td className="tabnum">{j.durationMs} ms</td>
                        <td className="tabnum">
                          {j.runs}
                          {j.failures > 0 && <span className="sub">{fill(tt.failures, { n: j.failures })}</span>}
                        </td>
                        <td>
                          <span className={`badge badge-${j.ok ? 'active' : 'suspended'}`}>{j.ok ? tt.ok : tt.failed}</span>
                          {j.error && <span className="sub">{j.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel system-panel">
            <h2 className="panel-title">{tt.busiest}</h2>
            {d.routes.length === 0 ? <p className="empty">{tt.noTraffic}</p> : <RouteTable routes={d.routes} speed={speed} tt={tt} />}
          </section>
        </>
      )}
    </>
  );
}

function RouteTable({
  routes,
  speed,
  tt,
}: {
  routes: Route[];
  speed: (p95: number) => string;
  tt: { route: string; requests: string; p50: string; p95: string; errors: string };
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{tt.route}</th>
            <th scope="col">{tt.requests}</th>
            <th scope="col">{tt.p50}</th>
            <th scope="col">{tt.p95}</th>
            <th scope="col">{tt.errors}</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={r.route}>
              <td>
                <code className="route" dir="ltr">
                  {r.route}
                </code>
              </td>
              <td className="tabnum">{r.count}</td>
              <td className="tabnum">{r.p50} ms</td>
              <td>
                <span className={`badge badge-${speed(r.p95)} tabnum`}>{r.p95} ms</span>
              </td>
              <td className={`tabnum ${r.errors ? 'bad' : ''}`}>{r.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
