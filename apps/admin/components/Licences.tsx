'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, useLoad } from '@/components/ui';
import { api, ApiError, LicenseView, PartnerView, ServiceClass } from '@/lib/client';
import { formatDay } from '@/lib/format';

const CLASSES: ServiceClass[] = ['commute', 'education'];

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
}

function daysAgo(n: number): string {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Transport authority licences per service class, and the data export for the authority.
 * Partner admins enter and renew; only platform admins verify. A class is sold only under
 * a verified, unexpired licence (education always; commute when the server requires it).
 */
export function Licences() {
  const { t, lang, profile, notify } = useApp();
  const isSuper = profile?.role === 'super_admin';
  const canEdit = isSuper || profile?.role === 'partner_admin';
  const partners = useLoad(() => (isSuper ? api<PartnerView[]>('admin/partners') : Promise.resolve([] as PartnerView[])), [isSuper]);
  const [chosen, setChosen] = useState<string | null>(null);
  const partnerId = isSuper ? (chosen ?? partners.data?.[0]?.id ?? null) : (profile?.partnerId ?? null);
  const list = useLoad(
    () => (partnerId ? api<LicenseView[]>(`admin/partners/${partnerId}/licenses`) : Promise.resolve([] as LicenseView[])),
    [partnerId],
  );
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());

  const fail = (err: unknown) => notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');

  async function save(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? '').trim();
    const sar = (k: string) => (text(k) ? Math.round(Number(text(k)) * 100) : undefined);
    await api(`admin/partners/${partnerId}/licenses/${text('serviceClass')}`, {
      method: 'PUT',
      body: {
        licenseNumber: text('licenseNumber'),
        unifiedCode: text('unifiedCode') || undefined,
        expiresAt: text('expiresAt'),
        minPriceHalalas: sar('minPrice'),
        maxPriceHalalas: sar('maxPrice'),
        pricingReference: text('pricingReference') || undefined,
      },
    });
    setEditing(false);
    notify(t.licences.saved);
    await list.reload();
  }

  async function verify(l: LicenseView) {
    try {
      await api(`admin/partners/${l.partnerId}/licenses/${l.serviceClass}/verify`, { method: 'POST' });
      notify(t.licences.verified);
      await list.reload();
    } catch (err) {
      fail(err);
    }
  }

  function state(l: LicenseView) {
    if (l.valid) return <span className="badge badge-active">{t.licences.valid}</span>;
    if (l.expiresAt <= today()) return <span className="badge badge-hold">{t.licences.expired}</span>;
    return <span className="badge badge-pending">{t.licences.unverified}</span>;
  }

  const range = (l: LicenseView) =>
    l.minPriceHalalas == null && l.maxPriceHalalas == null
      ? '—'
      : `${l.minPriceHalalas != null ? l.minPriceHalalas / 100 : '…'} – ${l.maxPriceHalalas != null ? l.maxPriceHalalas / 100 : '…'}`;

  const exportQuery = new URLSearchParams({ from, to, ...(isSuper && partnerId ? { partnerId } : {}) }).toString();

  return (
    <section className="panel" aria-labelledby="licences-title">
      <div className="page-head">
        <h2 id="licences-title">{t.licences.title}</h2>
        {canEdit && partnerId && (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            {t.licences.add}
          </button>
        )}
      </div>
      <p className="lead">{t.licences.intro}</p>
      {isSuper && partners.data && partners.data.length > 0 && (
        <div className="field">
          <label htmlFor="lic-partner">{t.licences.partner}</label>
          <select id="lic-partner" className="select" value={partnerId ?? ''} onChange={(e) => setChosen(e.target.value)}>
            {partners.data.map((p) => (
              <option key={p.id} value={p.id}>
                {lang === 'ar' ? p.nameAr : p.nameEn}
              </option>
            ))}
          </select>
        </div>
      )}
      <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
      {list.data && list.data.length === 0 && <p className="empty">{t.licences.empty}</p>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t.plans.serviceClass}</th>
                <th scope="col">{t.licences.number}</th>
                <th scope="col">{t.licences.unifiedCode}</th>
                <th scope="col">{t.licences.expiresAt}</th>
                <th scope="col">{t.licences.priceRange}</th>
                <th scope="col">{t.users.status}</th>
                {isSuper && <th scope="col"><span className="visually-hidden">{t.licences.verify}</span></th>}
              </tr>
            </thead>
            <tbody>
              {list.data.map((l) => (
                <tr key={l.id}>
                  <td>{t.plans[l.serviceClass]}</td>
                  <td className="num">{l.licenseNumber}</td>
                  <td className="num">{l.unifiedCode ?? '—'}</td>
                  <td className="tabnum">{formatDay(l.expiresAt, lang)}</td>
                  <td className="tabnum">{range(l)}</td>
                  <td>{state(l)}</td>
                  {isSuper && (
                    <td className="actions">
                      {!l.verifiedAt && (
                        <button type="button" className="btn btn-link" onClick={() => verify(l)}>
                          {t.licences.verify}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && partnerId && (
        <div className="licences-actions">
          <div className="field">
            <label htmlFor="exp-from">{t.licences.from}</label>
            <input id="exp-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="exp-to">{t.licences.to}</label>
            <input id="exp-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <a className="btn btn-quiet" href={`/api/proxy/admin/regulator/export?${exportQuery}`} download={`regulator-${from}-${to}.json`}>
            {t.licences.export}
          </a>
          <span className="hint">{t.licences.exportHint}</span>
        </div>
      )}

      <FormDialog open={editing} title={t.licences.add} submitLabel={t.licences.add} onClose={() => setEditing(false)} onSubmit={save}>
        <div className="field">
          <label htmlFor="lic-class">{t.plans.serviceClass}</label>
          <select id="lic-class" name="serviceClass" className="select" defaultValue="education">
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {t.plans[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="lic-number">{t.licences.number}</label>
            <input id="lic-number" name="licenseNumber" className="input num" required minLength={3} maxLength={40} dir="ltr" />
          </div>
          <div className="field">
            <label htmlFor="lic-code">{t.licences.unifiedCode}</label>
            <input id="lic-code" name="unifiedCode" className="input num" minLength={3} maxLength={40} dir="ltr" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="lic-exp">{t.licences.expiresAt}</label>
          <input id="lic-exp" name="expiresAt" className="input" type="date" required min={today()} />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="lic-min">{t.licences.minPrice}</label>
            <input id="lic-min" name="minPrice" className="input num" type="number" min={1} step={0.01} />
          </div>
          <div className="field">
            <label htmlFor="lic-max">{t.licences.maxPrice}</label>
            <input id="lic-max" name="maxPrice" className="input num" type="number" min={1} step={0.01} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="lic-ref">{t.licences.pricingReference}</label>
          <input id="lic-ref" name="pricingReference" className="input" maxLength={80} />
        </div>
      </FormDialog>
    </section>
  );
}
