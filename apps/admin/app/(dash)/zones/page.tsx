'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, ApiError, PartnerView, ZoneView } from '@/lib/client';

// Leaflet touches window, so the map only renders in the browser.
const ZoneMap = dynamic(() => import('@/components/ZoneMap'), { ssr: false, loading: () => <div className="map" /> });

export default function ZonesPage() {
  const { t, lang, profile, notify } = useApp();
  const isSuper = profile?.role === 'super_admin';
  const canEdit = isSuper || profile?.role === 'partner_admin';
  const zones = useLoad(() => api<ZoneView[]>('admin/zones'), []);
  const partners = useLoad(() => api<PartnerView[]>('admin/partners'), []);

  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [busy, setBusy] = useState(false);

  const errorText = (err: unknown) => (err instanceof ApiError && err.message ? err.message : t.common.networkError);
  const partnerName = (id: string) => {
    const p = partners.data?.find((x) => x.id === id);
    return p ? (lang === 'ar' ? p.nameAr : p.nameEn) : '';
  };

  function stopDrawing() {
    setDrawing(false);
    setDraft([]);
    setNameAr('');
    setNameEn('');
  }

  async function save() {
    setBusy(true);
    try {
      const created = await api<ZoneView>('admin/zones', {
        method: 'POST',
        body: {
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim(),
          area: { type: 'Polygon', coordinates: [draft] },
          partnerId: isSuper ? partnerId || undefined : undefined,
        },
      });
      notify(t.zones.created);
      stopDrawing();
      await zones.reload();
      setSelected(created.id);
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(z: ZoneView) {
    try {
      await api(`admin/zones/${z.id}`, { method: 'PATCH', body: { active: !z.active } });
      notify(t.zones.updated);
      await zones.reload();
    } catch (err) {
      notify(errorText(err), 'error');
    }
  }

  const canSave =
    draft.length >= 3 && nameAr.trim().length >= 2 && nameEn.trim().length >= 2 && (!isSuper || partnerId !== '');

  return (
    <>
      <div className="page-head">
        <h1>{t.zones.title}</h1>
        {canEdit && !drawing && (
          <button type="button" className="btn" onClick={() => setDrawing(true)}>
            {t.zones.draw}
          </button>
        )}
      </div>
      <p className="lead">{t.zones.intro}</p>

      <div className="zones-layout">
        <ZoneMap
          zones={zones.data ?? []}
          selectedId={selected}
          drawing={drawing}
          draft={draft}
          lang={lang}
          onAddPoint={(lng, lat) => setDraft((d) => [...d, [Number(lng.toFixed(6)), Number(lat.toFixed(6))]])}
          onSelect={setSelected}
        />

        <section className="panel">
          {drawing && (
            <div className="draw-panel">
              <p>{t.zones.drawHint}</p>
              <p className="tabnum">
                {draft.length} {t.zones.points}
              </p>
              <div className="field">
                <label htmlFor="z-ar">{t.zones.nameAr}</label>
                <input id="z-ar" className="input" value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
              </div>
              <div className="field">
                <label htmlFor="z-en">{t.zones.nameEn}</label>
                <input id="z-en" className="input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
              </div>
              {isSuper && (
                <div className="field">
                  <label htmlFor="z-partner">{t.zones.partner}</label>
                  <select id="z-partner" className="select" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                    <option value="">—</option>
                    {(partners.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {lang === 'ar' ? p.nameAr : p.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <button type="button" className="btn" onClick={save} disabled={!canSave || busy}>
                  {t.zones.save}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={draft.length === 0}>
                  {t.zones.undo}
                </button>
                <button type="button" className="btn btn-link" onClick={stopDrawing}>
                  {t.zones.cancelDraw}
                </button>
              </div>
            </div>
          )}

          <LoadState loading={zones.loading && !zones.data} error={zones.error} onRetry={zones.reload} />
          {zones.data && zones.data.length === 0 && !drawing && <p className="empty">{t.zones.empty}</p>}
          {zones.data && zones.data.length > 0 && (
            <ul className="zone-list">
              {zones.data.map((z) => (
                <li key={z.id} className={z.id === selected ? 'is-selected' : undefined}>
                  <button type="button" className="zone-name" onClick={() => setSelected(z.id)}>
                    {lang === 'ar' ? z.nameAr : z.nameEn}
                  </button>
                  <span className="sub tabnum">
                    {t.zones.area}: {z.areaKm2} {t.zones.km2}
                  </span>
                  <span className="sub tabnum">
                    {t.zones.plans}: {z.planCount}
                  </span>
                  {!z.active && <span className="sub">{t.zones.inactive}</span>}
                  {isSuper && <span className="sub">{partnerName(z.partnerId)}</span>}
                  {canEdit && (
                    <button type="button" className={`btn btn-link${z.active ? ' btn-danger' : ''}`} style={{ justifySelf: 'start' }} onClick={() => toggle(z)}>
                      {z.active ? t.zones.deactivate : t.zones.activate}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
