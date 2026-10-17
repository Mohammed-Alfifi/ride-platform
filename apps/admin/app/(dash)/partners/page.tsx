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
  const [billing, setBilling] = useState<PartnerView | null>(null);
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
        vatNumber: text('vatNumber') || undefined,
      },
    });
    setAdding(false);
    notify(t.partners.created);
    await reload();
  }

  async function saveBilling(form: FormData) {
    if (!billing) return;
    const text = (k: string) => String(form.get(k) ?? '').trim();
    const body: Record<string, unknown> = { commissionBps: Math.round(Number(text('commission') || '0') * 100) };
    // Empty fields are left as they are; the API keeps the previous value.
    if (text('legalName')) body.legalName = text('legalName');
    if (text('vatNumber')) body.vatNumber = text('vatNumber');
    if (text('gatewayAccountId')) body.gatewayAccountId = text('gatewayAccountId');
    await api(`admin/partners/${billing.id}`, { method: 'PATCH', body });
    setBilling(null);
    notify(t.partners.updated);
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
                  <th scope="col">{t.partners.joinCode}</th>
                  <th scope="col">{t.partners.commission}</th>
                  <th scope="col">{t.partners.vat}</th>
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
                    <td>
                      <code className="join-code">{p.joinCode}</code>
                    </td>
                    <td className="num">{formatBps(p.commissionBps)}</td>
                    <td className="num">{p.vatNumber ?? <span className="sub">{t.partners.notRegistered}</span>}</td>
                    <td className="num">{p.staffCount}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    {isSuper && (
                      <td className="actions">
                        <button type="button" className="btn btn-link" onClick={() => setBilling(p)}>
                          {t.partners.editBilling}
                        </button>
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
        <div className="field">
          <label htmlFor="vatNumber">
            {t.partners.vat} ({t.common.optional})
          </label>
          <input id="vatNumber" name="vatNumber" className="input num" inputMode="numeric" pattern="3\d{13}3" maxLength={15} aria-describedby="vat-hint" />
          <span className="hint" id="vat-hint">
            {t.partners.vatHint}
          </span>
        </div>
      </FormDialog>

      <FormDialog
        key={billing?.id ?? 'none'}
        open={billing !== null}
        title={`${t.partners.billing}: ${billing ? (lang === 'ar' ? billing.nameAr : billing.nameEn) : ''}`}
        submitLabel={t.partners.save}
        onClose={() => setBilling(null)}
        onSubmit={saveBilling}
      >
        <div className="field">
          <label htmlFor="b-legal">{t.partners.legalName}</label>
          <input id="b-legal" name="legalName" className="input" maxLength={200} defaultValue={billing?.legalName ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="b-vat">{t.partners.vat}</label>
          <input
            id="b-vat"
            name="vatNumber"
            className="input num"
            inputMode="numeric"
            pattern="3\d{13}3"
            maxLength={15}
            defaultValue={billing?.vatNumber ?? ''}
            aria-describedby="b-vat-hint"
          />
          <span className="hint" id="b-vat-hint">
            {t.partners.vatHint}
          </span>
        </div>
        <div className="field">
          <label htmlFor="b-commission">{t.partners.commission}</label>
          <input
            id="b-commission"
            name="commission"
            className="input num"
            type="number"
            min={0}
            max={100}
            step={0.5}
            defaultValue={billing ? billing.commissionBps / 100 : 15}
          />
        </div>
        <div className="field">
          <label htmlFor="b-gateway">{t.partners.gatewayAccount}</label>
          <input
            id="b-gateway"
            name="gatewayAccountId"
            className="input num"
            maxLength={80}
            dir="ltr"
            defaultValue={billing?.gatewayAccountId ?? ''}
            aria-describedby="b-gateway-hint"
          />
          <span className="hint" id="b-gateway-hint">
            {t.partners.gatewayAccountHint}
          </span>
        </div>
      </FormDialog>
    </>
  );
}
