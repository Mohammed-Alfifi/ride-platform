'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, ApiError, RunView } from '@/lib/client';
import { fill } from '@/lib/i18n';

function riyadhDay(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);
}

const STATE_TONE: Record<RunView['status'], string> = { planned: 'pending', in_progress: 'live', completed: 'active', cancelled: 'muted' };

/**
 * Each car's planned run for a day: who it collects, in which order, at what time, and how far
 * that is from the time each rider chose. Dispatchers re-plan here after changing the day by hand.
 */
export default function RunsPage() {
  const { t, notify } = useApp();
  // Tomorrow by default: tonight's plan is what dispatchers check before the morning.
  const [date, setDate] = useState(() => riyadhDay(1));
  const [planning, setPlanning] = useState(false);
  const list = useLoad(() => api<RunView[]>(`admin/runs?date=${date}`), [date]);

  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  async function replan() {
    setPlanning(true);
    try {
      const res = await api<{ planned: number; kept: number }>('admin/runs/plan', { method: 'POST', body: { date } });
      notify(fill(t.runs.replanned, res));
      await list.reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    } finally {
      setPlanning(false);
    }
  }

  const offset = (m: number | null) => {
    if (m == null) return null;
    if (m === 0) return t.runs.exact;
    return m < 0 ? fill(t.runs.early, { n: -m }) : fill(t.runs.later, { n: m });
  };

  return (
    <>
      <div className="page-head">
        <h1>{t.runs.title}</h1>
        <div className="head-tools">
          <input
            className="input tabnum date-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || riyadhDay(1))}
            aria-label={t.payments.date}
          />
          <button type="button" className="btn" onClick={replan} disabled={planning}>
            {t.runs.replan}
          </button>
        </div>
      </div>
      <p className="lead">{t.runs.intro}</p>

      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
      {list.data && list.data.length === 0 && <p className="empty panel">{t.runs.empty}</p>}

      <div className="runs">
        {(list.data ?? []).map((run) => (
          <section className="panel run" key={run.id} aria-label={`${run.driverName ?? ''} ${run.leg === 'outbound' ? t.runs.outbound : t.runs.return}`}>
            <header className="run-head">
              <div>
                <h2 className="panel-title">
                  {run.driverName ?? '—'} <span className="leg">{run.leg === 'outbound' ? t.runs.outbound : t.runs.return}</span>
                </h2>
                <p className="sub tabnum">
                  {time(run.plannedStartAt)} – {time(run.plannedEndAt)} · {fill(t.runs.riders, { n: run.riders })} · {fill(t.runs.drive, { n: run.driveMinutes })} ·{' '}
                  {run.routing === 'osrm' ? t.runs.roadTimes : t.runs.estimate}
                </p>
              </div>
              <div className="run-badges">
                <span className={`badge badge-${STATE_TONE[run.status]}`}>{t.runs.states[run.status]}</span>
                {run.lateMinutes > 0 ? (
                  <span className="badge badge-urgent">{fill(t.runs.late, { n: run.lateMinutes })}</span>
                ) : (
                  <span className="badge badge-active">{t.runs.onTime}</span>
                )}
              </div>
            </header>
            <ol className="run-stops">
              {run.stops.map((stop) => (
                <li key={`${stop.tripId}-${stop.kind}`} className={`run-stop run-stop-${stop.kind}`}>
                  <span className="run-time tabnum">{time(stop.plannedAt)}</span>
                  <span className="run-kind">{stop.kind === 'pickup' ? t.runs.pickup : t.runs.dropoff}</span>
                  <span className="run-place">
                    {stop.place}
                    {stop.rider && <span className="sub"> · {stop.rider}</span>}
                  </span>
                  <span className={`run-offset tabnum${(stop.offsetMinutes ?? 0) > 0 ? ' is-late' : ''}`}>{offset(stop.offsetMinutes)}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}
