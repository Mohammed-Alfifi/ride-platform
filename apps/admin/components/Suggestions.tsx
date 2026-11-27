'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { api, ApiError, DriverSuggestion, Substitute } from '@/lib/client';
import { fill } from '@/lib/i18n';

const failMessage = (err: unknown, fallback: string) => (err instanceof ApiError && err.message ? err.message : fallback);

/** For a rider without a driver: the drivers whose run they fit best, one click to choose. */
export function DriverSuggestions({ subscriptionId, onChoose }: { subscriptionId: string; onChoose: (driverId: string) => Promise<void> }) {
  const { t, notify } = useApp();
  const [items, setItems] = useState<DriverSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      setItems(await api<DriverSuggestion[]>(`admin/subscriptions/${subscriptionId}/driver-suggestions`));
    } catch (err) {
      notify(failMessage(err, t.common.networkError), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!items) {
    return (
      <button type="button" className="btn btn-link btn-sm" onClick={load} disabled={busy}>
        {t.runs.suggest}
      </button>
    );
  }
  if (items.length === 0) return <span className="sub">{t.runs.noSuggestions}</span>;
  return (
    <ul className="suggestions" aria-label={t.runs.suggestions}>
      {items.map((s) => (
        <li key={s.driverId}>
          <span>{s.name ?? '—'}</span>
          <span className="sub tabnum">
            {fill(t.runs.adds, { n: s.addedMinutes })} · {s.riders}/{s.seats}
          </span>
          <span className={`badge ${s.fitsWindows ? 'badge-active' : 'badge-pending'}`}>{s.fitsWindows ? t.runs.fits : t.runs.breaks}</span>
          <button type="button" className="btn btn-link btn-sm" onClick={() => onChoose(s.driverId)}>
            {t.runs.choose}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** For a trip whose driver is late or away: who can take it now, nearest first. */
export function Substitutes({ tripId, onAssign }: { tripId: string; onAssign: (driverId: string) => Promise<void> }) {
  const { t, notify } = useApp();
  const [items, setItems] = useState<Substitute[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      setItems(await api<Substitute[]>(`admin/trips/${tripId}/substitutes`));
    } catch (err) {
      notify(failMessage(err, t.common.networkError), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="substitutes">
      <h3 className="panel-subtitle">{t.runs.substitutes}</h3>
      {!items ? (
        <button type="button" className="btn btn-quiet btn-sm" onClick={load} disabled={busy}>
          {t.runs.findSubstitutes}
        </button>
      ) : items.length === 0 ? (
        <p className="sub">{t.runs.noSubstitutes}</p>
      ) : (
        <ul className="suggestions">
          {items.map((s) => (
            <li key={s.driverId}>
              <span>{s.name ?? s.phone}</span>
              <span className="sub tabnum">{s.etaMinutes != null ? fill(t.runs.away, { n: s.etaMinutes }) : t.runs.unknownLocation}</span>
              <button type="button" className="btn btn-link btn-sm" onClick={() => onAssign(s.driverId)}>
                {t.runs.assign}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
