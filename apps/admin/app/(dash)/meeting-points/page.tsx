'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, StatusBadge, useLoad } from '@/components/ui';
import { api, ApiError, MeetingPointView, ZoneView } from '@/lib/client';

export default function MeetingPointsPage() {
  const { t, lang, profile, notify } = useApp();
  const canEdit = profile?.role === 'super_admin' || profile?.role === 'partner_admin';
  const [adding, setAdding] = useState(false);
  const zones = useLoad(() => api<ZoneView[]>('admin/zones'), []);
  const points = useLoad(() => api<MeetingPointView[]>('admin/meeting-points'), []);
  const activeZones = (zones.data ?? []).filter((z) => z.active);

  const zoneName = (id: string) => {
    const z = zones.data?.find((x) => x.id === id);
    return z ? (lang === 'ar' ? z.nameAr : z.nameEn) : '—';
  };

  async function create(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? '').trim();
    await api('admin/meeting-points', {
      method: 'POST',
      body: { zoneId: text('zoneId'), nameAr: text('nameAr'), nameEn: text('nameEn'), lat: Number(text('lat')), lng: Number(text('lng')) },
    });
    setAdding(false);
    notify(t.meetingPoints.created);
    await points.reload();
  }

  async function toggle(p: MeetingPointView) {
    try {
      await api(`admin/meeting-points/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      notify(t.meetingPoints.updated);
      await points.reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.meetingPoints.title}</h1>
        {canEdit && activeZones.length > 0 && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            {t.meetingPoints.add}
          </button>
        )}
      </div>
      <p className="lead">{t.meetingPoints.intro}</p>

      <section className="panel">
        <LoadState loading={points.loading && !points.data} error={points.error} onRetry={points.reload} />
        {points.data && points.data.length === 0 && <p className="empty">{t.meetingPoints.empty}</p>}
        {points.data && points.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.meetingPoints.name}</th>
                  <th scope="col">{t.meetingPoints.zone}</th>
                  <th scope="col">{t.meetingPoints.location}</th>
                  <th scope="col">{t.users.status}</th>
                  {canEdit && <th scope="col"><span className="visually-hidden">{t.users.status}</span></th>}
                </tr>
              </thead>
              <tbody>
                {points.data.map((p) => (
                  <tr key={p.id}>
                    <td>{lang === 'ar' ? p.nameAr : p.nameEn}</td>
                    <td>{zoneName(p.zoneId)}</td>
                    <td className="tabnum" dir="ltr">
                      <a href={`https://maps.google.com/?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">
                        {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                      </a>
                    </td>
                    <td>
                      <StatusBadge status={p.active ? 'active' : 'suspended'} />
                    </td>
                    {canEdit && (
                      <td className="actions">
                        <button type="button" className={`btn btn-link${p.active ? ' btn-danger' : ''}`} onClick={() => toggle(p)}>
                          {p.active ? t.meetingPoints.deactivate : t.meetingPoints.activate}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FormDialog open={adding} title={t.meetingPoints.add} submitLabel={t.meetingPoints.add} onClose={() => setAdding(false)} onSubmit={create}>
        <div className="field">
          <label htmlFor="mp-zone">{t.meetingPoints.zone}</label>
          <select id="mp-zone" name="zoneId" className="select" required defaultValue={activeZones[0]?.id}>
            {activeZones.map((z) => (
              <option key={z.id} value={z.id}>
                {lang === 'ar' ? z.nameAr : z.nameEn}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="mp-ar">{t.meetingPoints.nameAr}</label>
            <input id="mp-ar" name="nameAr" className="input" required minLength={2} dir="rtl" placeholder="موقف جامع الحي" />
          </div>
          <div className="field">
            <label htmlFor="mp-en">{t.meetingPoints.nameEn}</label>
            <input id="mp-en" name="nameEn" className="input" required minLength={2} dir="ltr" placeholder="Mosque car park" />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="mp-lat">{t.meetingPoints.lat}</label>
            <input id="mp-lat" name="lat" className="input num" type="number" step="any" min={16} max={33} required dir="ltr" aria-describedby="mp-hint" />
          </div>
          <div className="field">
            <label htmlFor="mp-lng">{t.meetingPoints.lng}</label>
            <input id="mp-lng" name="lng" className="input num" type="number" step="any" min={34} max={56} required dir="ltr" aria-describedby="mp-hint" />
          </div>
        </div>
        <span className="hint" id="mp-hint">
          {t.meetingPoints.locationHint}
        </span>
      </FormDialog>
    </>
  );
}
