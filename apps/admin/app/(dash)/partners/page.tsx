'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, StatusBadge, useLoad } from '@/components/ui';
import { api, ApiError, PartnerView } from '@/lib/client';
import { formatBps } from '@/lib/format';

export default function PartnersPage() {
  const { t, lang, profile, notify } = useApp();
  const isSuper = profile?.role === 'super_admin';
  const [adding, setAdding] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api<PartnerView[]>('admin/partners'), []);

  async function create(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? '').trim();
    const pct = Number(text('commission') || '0');
    await api('admin/partners', {
      method: 'POST',
      body: {
        nameAr: text('nameAr'),
        nameEn: text('nameEn'),
        crNumber: text('crNumber') || undefined,
        tgaLicenseNumber: text('tgaLicenseNumber') || undefined,
        commissionBps: Math.round(pct * 100),
      },
    });
    setAdding(false);
    notify(t.partners.created);
    await reload();
  }

  async function toggle(p: PartnerView) {
    const next = p.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !window.confirm(t.partners.confirmSuspend)) return;
    try {
      await api(`admin/partners/${p.id}`, { method: 'PATCH', body: { status: next } });
      notify(t.partners.updated);
      await reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.partners.title}</h1>
        {isSuper && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            {t.partners.add}
          </button>
        )}
      </div>

      <section className="panel">
        <LoadState loading={loading && !data} error={error} onRetry={reload} />
        {data && data.length === 0 && <p className="empty">{t.partners.empty}</p>}
        {data && data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{lang === 'ar' ? t.partners.nameAr : t.partners.nameEn}</th>
                  <th scope="col">{t.partners.cr}</th>
                  <th scope="col">{t.partners.license}</th>
                  <th scope="col">{t.partners.commission}</th>
                  <th scope="col">{t.partners.staff}</th>
                  <th scope="col">{t.partners.status}</th>
                  {isSuper && <th scope="col"><span className="visually-hidden">{t.partners.status}</span></th>}
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {lang === 'ar' ? p.nameAr : p.nameEn}
                      <span className="sub">{lang === 'ar' ? p.nameEn : p.nameAr}</span>
                    </td>
                    <td className="num">{p.crNumber ?? '—'}</td>
                    <td className="num">{p.tgaLicenseNumber ?? '—'}</td>
                    <td className="num">{formatBps(p.commissionBps)}</td>
                    <td className="num">{p.staffCount}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    {isSuper && (
                      <td className="actions">
                        <button
                          type="button"
                          className={`btn btn-link${p.status === 'active' ? ' btn-danger' : ''}`}
                          onClick={() => toggle(p)}
                        >
                          {p.status === 'active' ? t.partners.suspend : t.partners.activate}
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

      <FormDialog
        open={adding}
        title={t.partners.add}
        submitLabel={t.partners.add}
        onClose={() => setAdding(false)}
        onSubmit={create}
      >
        <div className="row">
          <div className="field">
            <label htmlFor="nameAr">{t.partners.nameAr}</label>
            <input id="nameAr" name="nameAr" className="input" required minLength={2} dir="rtl" />
          </div>
          <div className="field">
            <label htmlFor="nameEn">{t.partners.nameEn}</label>
            <input id="nameEn" name="nameEn" className="input" required minLength={2} dir="ltr" />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="crNumber">
              {t.partners.cr} ({t.common.optional})
            </label>
            <input id="crNumber" name="crNumber" className="input num" inputMode="numeric" pattern="\d{10}" maxLength={10} />
          </div>
          <div className="field">
            <label htmlFor="tgaLicenseNumber">
              {t.partners.license} ({t.common.optional})
            </label>
            <input id="tgaLicenseNumber" name="tgaLicenseNumber" className="input num" maxLength={40} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="commission">{t.partners.commission}</label>
          <input
            id="commission"
            name="commission"
            className="input num"
            type="number"
            min={0}
            max={100}
            step={0.5}
            defaultValue={15}
            aria-describedby="commission-hint"
          />
          <span className="hint" id="commission-hint">
            {t.partners.commissionHint}
          </span>
        </div>
      </FormDialog>
    </>
  );
}
