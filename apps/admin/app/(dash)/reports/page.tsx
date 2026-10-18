'use client';

import { useState } from 'react';
import { DayBars, DayPoint } from '@/components/DayBars';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api } from '@/lib/client';
import { formatSar } from '@/lib/format';
import { fill } from '@/lib/i18n';

interface Report {
  from: string;
  to: string;
  totals: {
    collectedHalalas: number;
    platformFeeHalalas: number;
    payments: number;
    newSubscriptions: number;
    activeSubscriptions: number;
    pastDue: number;
    ended: number;
    tripsCompleted: number;
    noShows: number;
    skipped: number;
    onTimeRate: number | null;
    completionRate: number | null;
    averageRating: number | null;
    ratings: number;
    openTickets: number;
  };
  series: { revenue: DayPoint[]; newSubscriptions: DayPoint[]; tripsCompleted: DayPoint[]; noShows: DayPoint[] };
}

interface Ratings {
  items: { tripId: string; stars: number; tags: string[]; comment: string | null; createdAt: string; riderName: string | null; driverName: string | null }[];
  drivers: { driverId: string | null; driverName: string | null; average: number; count: number }[];
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

export default function ReportsPage() {
  const { t, lang } = useApp();
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(today);
  const range = `from=${from}&to=${to}`;
  const report = useLoad(() => api<Report>(`admin/analytics?${range}`), [range]);
  const ratings = useLoad(() => api<Ratings>(`admin/ratings?${range}`), [range]);
  const r = report.data?.totals;
  const sar = (h: number) => formatSar(h, lang);
  const num = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en');
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

  return (
    <>
      <div className="page-head">
        <h1>{t.reports.title}</h1>
        <div className="head-tools">
          <label className="inline-field">
            <span>{t.reports.from}</span>
            <input className="input tabnum" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className="inline-field">
            <span>{t.reports.to}</span>
            <input className="input tabnum" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
          <a className="btn btn-quiet" href={`/api/proxy/admin/payments.csv?${range}`} download>
            {t.reports.export}
          </a>
        </div>
      </div>

      <LoadState loading={report.loading && !report.data} error={report.error} onRetry={report.reload} />
      {r && report.data && (
        <>
          <dl className="kpis">
            <div className="kpi">
              <dt>{t.reports.collected}</dt>
              <dd className="tabnum">{sar(r.collectedHalalas)}</dd>
            </div>
            <div className="kpi">
              <dt>{t.reports.active}</dt>
              <dd className="tabnum">
                {num(r.activeSubscriptions)}
                {r.pastDue > 0 && <span className="sub">{fill(t.reports.pastDue, { n: r.pastDue })}</span>}
              </dd>
            </div>
            <div className="kpi">
              <dt title={t.reports.onTimeHint}>{t.reports.onTime}</dt>
              <dd className="tabnum">
                {pct(r.onTimeRate)}
                <span className="sub">{t.reports.onTimeHint}</span>
              </dd>
            </div>
            <div className="kpi">
              <dt>{t.reports.rating}</dt>
              <dd className="tabnum">
                {r.averageRating ?? '—'} <span className="stars">★</span>
                <span className="sub">{fill(t.reports.ratingsCount, { n: r.ratings })}</span>
              </dd>
            </div>
          </dl>

          <div className="report-grid">
            <section className="panel report-card">
              <h2>{t.reports.revenueChart}</h2>
              <p className="total tabnum">{sar(r.collectedHalalas)}</p>
              <DayBars points={report.data.series.revenue} format={sar} label={t.reports.revenueChart} lang={lang} />
            </section>
            <section className="panel report-card">
              <h2>{t.reports.subsChart}</h2>
              <p className="total tabnum">{num(r.newSubscriptions)}</p>
              <DayBars points={report.data.series.newSubscriptions} format={num} label={t.reports.subsChart} lang={lang} />
            </section>
            <section className="panel report-card">
              <h2>{t.reports.tripsChart}</h2>
              <p className="total tabnum">
                {num(r.tripsCompleted)} <span className="sub">{fill(t.reports.noShows, { n: r.noShows })}</span>
              </p>
              <DayBars points={report.data.series.tripsCompleted} format={num} label={t.reports.tripsChart} lang={lang} />
            </section>
            <section className="panel report-card">
              <h2>{t.reports.drivers}</h2>
              {ratings.data && ratings.data.drivers.length === 0 && <p className="empty">{t.reports.noRatings}</p>}
              {ratings.data && ratings.data.drivers.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t.reports.driver}</th>
                        <th scope="col">{t.reports.average}</th>
                        <th scope="col">{t.reports.count}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ratings.data.drivers.map((d) => (
                        <tr key={d.driverId ?? 'none'}>
                          <td>{d.driverName ?? '—'}</td>
                          <td className="tabnum">
                            {d.average} <span className="stars">★</span>
                          </td>
                          <td className="tabnum">{d.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {ratings.data && ratings.data.items.some((i) => i.comment || i.tags.length) && (
                <>
                  <h2 style={{ marginTop: '1rem' }}>{t.reports.comments}</h2>
                  <ul className="comment-list">
                    {ratings.data.items
                      .filter((i) => i.comment || i.tags.length)
                      .slice(0, 6)
                      .map((i) => (
                        <li key={i.tripId}>
                          <span className="stars" aria-label={`${i.stars}/5`}>
                            {'★'.repeat(i.stars)}
                            <span className="stars-off">{'★'.repeat(5 - i.stars)}</span>
                          </span>
                          <span>
                            {i.comment ?? i.tags.map((tag) => t.reports.tags[tag as keyof typeof t.reports.tags] ?? tag).join('، ')}
                          </span>
                          <span className="sub">
                            {i.riderName} · {i.driverName}
                          </span>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
