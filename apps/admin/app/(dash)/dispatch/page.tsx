'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, ApiError, DispatchBoard, DispatchDriver, TripLive, TripStatus, TripView } from '@/lib/client';
import { formatSaudiPhone } from '@/lib/format';
import { fill } from '@/lib/i18n';

const DispatchMap = dynamic(() => import('@/components/DispatchMap'), { ssr: false, loading: () => <div className="map map-tall" /> });

type Filter = 'all' | 'unassigned' | 'late' | 'active' | 'done' | 'problems';
const FILTERS: Filter[] = ['all', 'unassigned', 'late', 'active', 'done', 'problems'];
const ACTIVE: TripStatus[] = ['en_route', 'arrived', 'on_board'];
const REFRESH_MS = 10_000;

function riyadhToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
}

function minutesLate(t: TripView, now: number): number {
  return t.status === 'scheduled' ? Math.floor((now - Date.parse(t.scheduledAt)) / 60_000) : 0;
}

function tone(status: TripStatus): string {
  if (ACTIVE.includes(status)) return 'live';
  if (status === 'completed') return 'active';
  if (status === 'no_show') return 'suspended';
  if (status === 'scheduled') return 'pending';
  return 'muted';
}

export default function DispatchPage() {
  const { t, lang, profile, notify } = useApp();
  const canAssign = profile?.role !== undefined;
  const [date, setDate] = useState(riyadhToday);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState<TripLive | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The server filters by tab and caps the list, so a busy day stays light to refresh every 10 seconds.
  const board = useLoad(() => api<DispatchBoard>(`admin/dispatch?date=${date}&view=${filter}`), [date, filter]);

  // Refresh while the page is visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        void board.reload();
      }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [board.reload]);

  const trips = board.data?.trips ?? [];
  const selected = trips.find((x) => x.id === selectedId) ?? null;

  const loadLive = useCallback(async (id: string) => {
    try {
      setLive(await api<TripLive>(`admin/trips/${id}/live`));
    } catch {
      setLive(null);
    }
  }, []);
  useEffect(() => {
    if (!selectedId) return setLive(null);
    void loadLive(selectedId);
  }, [selectedId, board.data, loadLive]);

  const filtered = trips;

  async function assign(trip: TripView, driverId: string) {
    try {
      await api(`admin/trips/${trip.id}/driver`, { method: 'PATCH', body: { driverId: driverId || null } });
      notify(t.dispatch.assigned);
      await board.reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const s = board.data?.summary;
  const drivers = board.data?.drivers ?? [];
  const available = drivers.filter((d) => !d.onHold);

  const stats: { label: string; value: number | undefined; alert?: boolean }[] = [
    { label: t.dispatch.summary.total, value: s?.total },
    { label: t.dispatch.summary.unassigned, value: s?.unassigned, alert: (s?.unassigned ?? 0) > 0 },
    { label: t.dispatch.summary.late, value: s?.late, alert: (s?.late ?? 0) > 0 },
    { label: t.dispatch.summary.active, value: s?.active },
    { label: t.dispatch.summary.completed, value: s?.completed },
    { label: t.dispatch.summary.problems, value: s?.problems, alert: (s?.problems ?? 0) > 0 },
  ];

  return (
    <>
      <div className="page-head">
        <h1>{t.dispatch.title}</h1>
        <div className="head-tools">
          <span className="live-dot">{t.dispatch.live}</span>
          <input
            className="input tabnum date-input"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value || riyadhToday());
              setSelectedId(null);
            }}
            aria-label={t.payments.date}
          />
        </div>
      </div>

      <dl className="stats stats-6">
        {stats.map((x) => (
          <div className={`stat${x.alert ? ' stat-alert' : ''}`} key={x.label}>
            <dt>{x.label}</dt>
            <dd className="tabnum">{x.value ?? '—'}</dd>
          </div>
        ))}
      </dl>

      <LoadState loading={board.loading && !board.data} error={board.error} onRetry={board.reload} />

      {board.data && (
        <div className="dispatch">
          <section className="panel dispatch-list">
            <div className="tabs" role="tablist">
              {FILTERS.map((f) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
                  {t.dispatch.filters[f]}
                </button>
              ))}
            </div>
            {trips.length === 0 && <p className="empty">{filter === 'all' ? t.dispatch.empty : t.dispatch.emptyFilter}</p>}
            {board.data.tripsInView > trips.length && (
              <p className="hint">{fill(t.dispatch.capped, { shown: trips.length, total: board.data.tripsInView })}</p>
            )}
            <ol className="trip-list">
              {filtered.map((x) => {
                const late = minutesLate(x, now);
                return (
                  <li key={x.id} className={`trip${x.id === selectedId ? ' is-selected' : ''}`}>
                    <button type="button" className="trip-main" onClick={() => setSelectedId(x.id === selectedId ? null : x.id)}>
                      <span className="trip-time tabnum">{time(x.scheduledAt)}</span>
                      <span className="trip-body">
                        <span className="trip-rider">
                          {x.passengerName ?? x.rider.name ?? formatSaudiPhone(x.rider.phone)}
                          <span className="leg">{x.leg === 'outbound' ? t.dispatch.outbound : t.dispatch.return}</span>
                        </span>
                        <span className="trip-route">
                          {x.pickup.name} {lang === 'ar' ? '←' : '→'} {x.dropoff.name}
                        </span>
                      </span>
                      <span className="trip-state">
                        <span className={`badge badge-${tone(x.status)}`}>{t.dispatch.states[x.status]}</span>
                        {late > 0 && <span className="late tabnum">{fill(t.dispatch.lateBy, { n: late })}</span>}
                      </span>
                    </button>
                    <div className="trip-driver">
                      {x.status === 'scheduled' && canAssign ? (
                        <select
                          className={`select select-sm${x.driver ? '' : ' select-missing'}`}
                          value={x.driver?.id ?? ''}
                          onChange={(e) => assign(x, e.target.value)}
                          aria-label={t.dispatch.driver}
                        >
                          <option value="">{t.dispatch.noDriver}</option>
                          {available.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name ?? d.phone}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="driver-cell">
                          {x.driver ? (
                            <>
                              <span>{x.driver.name}</span>
                              {x.driver.vehicle && <Plate value={x.driver.vehicle.plate} />}
                            </>
                          ) : (
                            <span className="sub">{t.dispatch.noDriver}</span>
                          )}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="dispatch-side">
            <div className="panel">
              <DispatchMap
                drivers={drivers}
                selected={selected}
                route={live?.route ?? []}
                onSelectDriver={(id) => {
                  const current = drivers.find((d) => d.id === id)?.currentTripId;
                  if (current) setSelectedId(current);
                }}
              />
              {selected ? (
                <TripCard trip={selected} live={live} time={time} />
              ) : (
                <p className="map-hint">{t.dispatch.selectHint}</p>
              )}
            </div>
            <div className="panel">
              <h2 className="panel-title">{t.dispatch.drivers}</h2>
              {drivers.length === 0 ? (
                <p className="empty">{t.dispatch.noDrivers}</p>
              ) : (
                <ul className="driver-list">
                  {drivers.map((d) => (
                    <DriverRow key={d.id} d={d} now={now} onSelect={() => d.currentTripId && setSelectedId(d.currentTripId)} />
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function TripCard({ trip, live, time }: { trip: TripView; live: TripLive | null; time: (iso: string) => string }) {
  const { t } = useApp();
  const steps: [string, string | null][] = [
    [t.dispatch.states.en_route, trip.startedAt],
    [t.dispatch.states.arrived, trip.arrivedAt],
    [t.dispatch.states.on_board, trip.pickedUpAt],
    [t.dispatch.states.completed, trip.completedAt],
  ];
  return (
    <div className="trip-card">
      <div className="trip-card-head">
        <strong>{trip.passengerName ?? trip.rider.name ?? formatSaudiPhone(trip.rider.phone)}</strong>
        <a className="btn btn-link" href={`tel:${trip.rider.phone}`}>
          {t.dispatch.call}
        </a>
      </div>
      {live?.etaMinutes != null && live.etaMinutes > 0 && <p className="eta">{fill(t.dispatch.eta, { n: live.etaMinutes })}</p>}
      <ol className="timeline">
        {steps.map(([label, at]) => (
          <li key={label} className={at ? 'done' : ''}>
            <span>{label}</span>
            <span className="tabnum">{at ? time(at) : '—'}</span>
          </li>
        ))}
      </ol>
      {trip.driver && (
        <p className="driver-line">
          <span>{trip.driver.name}</span>
          {trip.driver.vehicle && <Plate value={trip.driver.vehicle.plate} />}
          {trip.driver.phone && (
            <a className="btn btn-link" href={`tel:${trip.driver.phone}`}>
              {t.dispatch.call}
            </a>
          )}
        </p>
      )}
    </div>
  );
}

function DriverRow({ d, now, onSelect }: { d: DispatchDriver; now: number; onSelect: () => void }) {
  const { t } = useApp();
  const ago = d.location ? Math.floor((now - Date.parse(d.location.at)) / 60_000) : null;
  const state = d.onHold ? t.dispatch.onHold : d.currentTripId ? t.dispatch.onTrip : t.dispatch.idle;
  const cls = d.onHold ? 'suspended' : d.currentTripId ? 'live' : 'active';
  return (
    <li>
      <button type="button" className="driver-row" onClick={onSelect} disabled={!d.currentTripId}>
        <span>
          <strong>{d.name ?? formatSaudiPhone(d.phone)}</strong>
          <span className="driver-meta">
            {d.plate && <Plate value={d.plate} />}
            <span className="sub">{fill(t.dispatch.tripsToday, { n: d.tripsToday })}</span>
          </span>
        </span>
        <span className="driver-state">
          <span className={`badge badge-${cls}`}>{state}</span>
          <span className="sub">{ago === null ? t.dispatch.noSignal : fill(t.dispatch.lastSeen, { n: Math.max(0, ago) })}</span>
        </span>
      </button>
    </li>
  );
}

/** A Saudi plate as printed: digits then Latin letters, always left to right. */
function Plate({ value }: { value: string }) {
  return (
    <bdi dir="ltr" className="plate-chip tabnum">
      {value}
    </bdi>
  );
}
