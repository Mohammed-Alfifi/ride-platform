'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, StatusBadge, useLoad } from '@/components/ui';
import { api, ApiError, PlanView, ZoneView } from '@/lib/client';
import { formatSar } from '@/lib/format';

export default function PlansPage() {
  const { t, lang, profile, notify } = useApp();
  const canEdit = profile?.role === 'super_admin' || profile?.role === 'partner_admin';
  const [adding, setAdding] = useState(false);
  const zones = useLoad(() => api<ZoneView[]>('admin/zones'), []);
  const plans = useLoad(() => api<PlanView[]>('admin/plans'), []);

  const zoneName = (id: string) => {
    const z = zones.data?.find((x) => x.id === id);
    return z ? (lang === 'ar' ? z.nameAr : z.nameEn) : '—';
  };

  async function create(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? '').trim();
    await api('admin/plans', {
      method: 'POST',
      body: {
        zoneId: text('zoneId'),
        nameAr: text('nameAr'),
        nameEn: text('nameEn'),
        tripType: text('tripType'),
        daysPerWeek: Number(text('daysPerWeek')),
        priceHalalas: Math.round(Number(text('price')) * 100),
        maxDistanceKm: Number(text('maxDistanceKm')),
      },
    });
    setAdding(false);
    notify(t.plans.created);
    await plans.reload();
  }

  async function toggle(p: PlanView) {
    try {
      await api(`admin/plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      notify(t.plans.updated);
      await plans.reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  const activeZones = (zones.data ?? []).filter((z) => z.active);

  return (
    <>
      <div className="page-head">
        <h1>{t.plans.title}</h1>
        {canEdit && activeZones.length > 0 && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            {t.plans.add}
          </button>
        )}
      </div>

      <section className="panel">
        <LoadState loading={plans.loading && !plans.data} error={plans.error} onRetry={plans.reload} />
        {plans.data && plans.data.length === 0 && <p className="empty">{t.plans.empty}</p>}
        {plans.data && plans.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.plans.name}</th>
                  <th scope="col">{t.plans.zone}</th>
                  <th scope="col">{t.plans.tripType}</th>
                  <th scope="col">{t.plans.days}</th>
                  <th scope="col">{t.plans.maxDistance}</th>
                  <th scope="col">{t.plans.price}</th>
                  <th scope="col">{t.users.status}</th>
                  {canEdit && <th scope="col"><span className="visually-hidden">{t.users.status}</span></th>}
                </tr>
              </thead>
              <tbody>
                {plans.data.map((p) => (
                  <tr key={p.id}>
                    <td>{lang === 'ar' ? p.nameAr : p.nameEn}</td>
                    <td>{zoneName(p.zoneId)}</td>
                    <td>{t.plans[p.tripType]}</td>
                    <td className="tabnum">{p.daysPerWeek}</td>
                    <td className="tabnum">{p.maxDistanceKm}</td>
                    <td className="tabnum">
                      {formatSar(p.priceHalalas, lang)} {t.plans.perMonth}
                    </td>
                    <td>
                      <StatusBadge status={p.active ? 'active' : 'suspended'} />
                    </td>
                    {canEdit && (
                      <td className="actions">
                        <button type="button" className={`btn btn-link${p.active ? ' btn-danger' : ''}`} onClick={() => toggle(p)}>
                          {p.active ? t.plans.deactivate : t.plans.activate}
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

      <FormDialog open={adding} title={t.plans.add} submitLabel={t.plans.add} onClose={() => setAdding(false)} onSubmit={create}>
        <div className="field">
          <label htmlFor="zoneId">{t.plans.zone}</label>
          <select id="zoneId" name="zoneId" className="select" required defaultValue={activeZones[0]?.id}>
            {activeZones.map((z) => (
              <option key={z.id} value={z.id}>
                {lang === 'ar' ? z.nameAr : z.nameEn}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="p-ar">{t.plans.nameAr}</label>
            <input id="p-ar" name="nameAr" className="input" required minLength={2} dir="rtl" placeholder="ذهاب وعودة - 5 أيام" />
          </div>
          <div className="field">
            <label htmlFor="p-en">{t.plans.nameEn}</label>
            <input id="p-en" name="nameEn" className="input" required minLength={2} dir="ltr" placeholder="Round trip - 5 days" />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="tripType">{t.plans.tripType}</label>
            <select id="tripType" name="tripType" className="select" defaultValue="round_trip">
              <option value="round_trip">{t.plans.round_trip}</option>
              <option value="one_way">{t.plans.one_way}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="daysPerWeek">{t.plans.days}</label>
            <input id="daysPerWeek" name="daysPerWeek" className="input num" type="number" min={1} max={7} defaultValue={5} required />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="price">{t.plans.price}</label>
            <input id="price" name="price" className="input num" type="number" min={1} step={0.01} required aria-describedby="price-hint" />
            <span className="hint" id="price-hint">
              {t.plans.priceHint}
            </span>
          </div>
          <div className="field">
            <label htmlFor="maxDistanceKm">{t.plans.maxDistance}</label>
            <input id="maxDistanceKm" name="maxDistanceKm" className="input num" type="number" min={1} max={200} defaultValue={15} required />
          </div>
        </div>
      </FormDialog>
    </>
  );
}
