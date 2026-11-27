'use client';

import { useState } from 'react';
import { OrgInvoiceTable } from '@/components/OrgInvoices';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, StatusBadge, useLoad } from '@/components/ui';
import { api, ApiError, OrgAdminView, OrganizationView, OrgInvoiceView, PlanView } from '@/lib/client';
import { formatDate, formatSar, formatSaudiPhone } from '@/lib/format';

const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date()).slice(0, 7);

export default function OrganizationsPage() {
  const { t, lang, profile, notify } = useApp();
  const canEdit = profile?.role === 'super_admin' || profile?.role === 'partner_admin';
  const ar = lang === 'ar';
  const [editing, setEditing] = useState<OrganizationView | 'new' | null>(null);
  const [adminsFor, setAdminsFor] = useState<OrganizationView | null>(null);
  const [invoicesFor, setInvoicesFor] = useState<OrganizationView | null>(null);
  const [paying, setPaying] = useState<OrgInvoiceView | null>(null);
  const orgs = useLoad(() => api<OrganizationView[]>('admin/organizations'), []);
  const plans = useLoad(() => api<PlanView[]>('admin/plans'), []);
  const admins = useLoad(() => (adminsFor ? api<OrgAdminView[]>(`admin/organizations/${adminsFor.id}/admins`) : Promise.resolve(null)), [adminsFor?.id]);
  const invoices = useLoad(
    () => (invoicesFor ? api<OrgInvoiceView[]>(`admin/organizations/${invoicesFor.id}/invoices`) : Promise.resolve(null)),
    [invoicesFor?.id],
  );

  const current = editing && editing !== 'new' ? editing : null;
  const planName = (id: string) => {
    const p = plans.data?.find((x) => x.id === id);
    return p ? (ar ? p.nameAr : p.nameEn) : '—';
  };

  async function save(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? '').trim();
    const body = {
      kind: text('kind'),
      nameAr: text('nameAr'),
      nameEn: text('nameEn'),
      legalName: text('legalName'),
      crNumber: text('crNumber') || undefined,
      vatNumber: text('vatNumber') || undefined,
      address: text('address') || undefined,
      contactPhone: text('contactPhone') || undefined,
      coverageBps: Math.round(Number(text('coverage')) * 100),
      planIds: form.getAll('planIds').map(String),
    };
    if (current) await api(`admin/organizations/${current.id}`, { method: 'PATCH', body });
    else await api('admin/organizations', { method: 'POST', body });
    setEditing(null);
    notify(t.orgs.saved);
    await orgs.reload();
  }

  async function toggle(o: OrganizationView) {
    try {
      await api(`admin/organizations/${o.id}`, { method: 'PATCH', body: { status: o.status === 'active' ? 'suspended' : 'active' } });
      notify(t.orgs.saved);
      await orgs.reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  async function addAdmin(form: FormData) {
    if (!adminsFor) return;
    await api(`admin/organizations/${adminsFor.id}/admins`, {
      method: 'POST',
      body: { phone: String(form.get('phone') ?? '').trim(), name: String(form.get('name') ?? '').trim() },
    });
    notify(t.orgs.adminAdded);
    await admins.reload();
  }

  async function issue(form: FormData) {
    if (!invoicesFor) return;
    await api(`admin/organizations/${invoicesFor.id}/invoices`, { method: 'POST', body: { month: String(form.get('month')) } });
    notify(t.orgs.issued);
    await Promise.all([invoices.reload(), orgs.reload()]);
  }

  async function pay(form: FormData) {
    if (!paying) return;
    const reference = String(form.get('reference') ?? '').trim();
    await api(`admin/organization-invoices/${paying.id}/pay`, { method: 'POST', body: { method: String(form.get('method')), reference: reference || undefined } });
    setPaying(null);
    notify(t.orgs.paidSaved);
    await Promise.all([invoices.reload(), orgs.reload()]);
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.orgs.title}</h1>
        {canEdit && (
          <button type="button" className="btn" onClick={() => setEditing('new')}>
            {t.orgs.add}
          </button>
        )}
      </div>
      <p className="lead">{t.orgs.intro}</p>

      <section className="panel">
        <LoadState loading={orgs.loading && !orgs.data} error={orgs.error} onRetry={orgs.reload} />
        {orgs.data && orgs.data.length === 0 && <p className="empty">{t.orgs.empty}</p>}
        {orgs.data && orgs.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.orgs.name}</th>
                  <th scope="col">{t.orgs.coverage}</th>
                  <th scope="col">{t.orgs.members}</th>
                  <th scope="col">{t.orgs.seats}</th>
                  <th scope="col">{t.orgs.unpaid}</th>
                  <th scope="col">{t.users.status}</th>
                  {canEdit && (
                    <th scope="col">
                      <span className="visually-hidden">{t.orgs.edit}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {orgs.data.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {ar ? o.nameAr : o.nameEn}
                      <span className="sub">
                        {t.orgs[o.kind]} · {o.planIds.map(planName).join('، ')}
                      </span>
                    </td>
                    <td className="tabnum">{o.coverageBps / 100}%</td>
                    <td className="tabnum">{o.members}</td>
                    <td className="tabnum">{o.seats}</td>
                    <td className={`tabnum${o.overdue > 0 ? ' cell-alert' : ''}`}>
                      {formatSar(o.unpaidHalalas, lang)}
                      {o.overdue > 0 && <span className="sub">{t.orgs.overdue}</span>}
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    {canEdit && (
                      <td className="actions">
                        <button type="button" className="btn btn-link" onClick={() => setInvoicesFor(o)}>
                          {t.orgs.invoices}
                        </button>
                        <button type="button" className="btn btn-link" onClick={() => setAdminsFor(o)}>
                          {t.orgs.admins}
                        </button>
                        <button type="button" className="btn btn-link" onClick={() => setEditing(o)}>
                          {t.orgs.edit}
                        </button>
                        <button type="button" className={`btn btn-link${o.status === 'active' ? ' btn-danger' : ''}`} onClick={() => toggle(o)}>
                          {o.status === 'active' ? t.orgs.suspend : t.orgs.activate}
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
        key={current?.id ?? 'new'}
        open={editing !== null}
        title={current ? t.orgs.edit : t.orgs.add}
        submitLabel={current ? t.orgs.edit : t.orgs.add}
        onClose={() => setEditing(null)}
        onSubmit={save}
      >
        <div className="row">
          <div className="field">
            <label htmlFor="o-kind">{t.orgs.kind}</label>
            <select id="o-kind" name="kind" className="select" defaultValue={current?.kind ?? 'company'}>
              <option value="company">{t.orgs.company}</option>
              <option value="school">{t.orgs.school}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="o-cov">{t.orgs.coverage}</label>
            <input
              id="o-cov"
              name="coverage"
              className="input num"
              type="number"
              min={1}
              max={100}
              step={1}
              required
              defaultValue={current ? current.coverageBps / 100 : 100}
              aria-describedby="o-cov-hint"
            />
            <span className="hint" id="o-cov-hint">
              {t.orgs.coverageHint}
            </span>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="o-ar">{t.orgs.nameAr}</label>
            <input id="o-ar" name="nameAr" className="input" required minLength={2} dir="rtl" defaultValue={current?.nameAr} />
          </div>
          <div className="field">
            <label htmlFor="o-en">{t.orgs.nameEn}</label>
            <input id="o-en" name="nameEn" className="input" required minLength={2} dir="ltr" defaultValue={current?.nameEn} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="o-legal">{t.orgs.legalName}</label>
          <input id="o-legal" name="legalName" className="input" required minLength={2} defaultValue={current?.legalName} />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="o-cr">
              {t.orgs.crNumber} ({t.common.optional})
            </label>
            <input id="o-cr" name="crNumber" className="input num" inputMode="numeric" pattern="\d{10}" dir="ltr" defaultValue={current?.crNumber ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="o-vat">
              {t.orgs.vatNumber} ({t.common.optional})
            </label>
            <input id="o-vat" name="vatNumber" className="input num" inputMode="numeric" pattern="3\d{13}3" dir="ltr" defaultValue={current?.vatNumber ?? ''} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="o-addr">
              {t.orgs.address} ({t.common.optional})
            </label>
            <input id="o-addr" name="address" className="input" defaultValue={current?.address ?? ''} />
          </div>
          <div className="field">
            <label htmlFor="o-phone">
              {t.orgs.contactPhone} ({t.common.optional})
            </label>
            <input id="o-phone" name="contactPhone" className="input num" inputMode="tel" dir="ltr" defaultValue={current?.contactPhone ?? ''} />
          </div>
        </div>
        <fieldset className="field">
          <legend>{t.orgs.plans}</legend>
          <div className="plan-picks">
            {(plans.data ?? [])
              .filter((p) => p.active && (!current || p.partnerId === current.partnerId))
              .map((p) => (
                <label className="check" key={p.id}>
                  <input type="checkbox" name="planIds" value={p.id} defaultChecked={current?.planIds.includes(p.id)} /> {ar ? p.nameAr : p.nameEn} · {formatSar(p.priceHalalas, lang)}
                </label>
              ))}
          </div>
        </fieldset>
      </FormDialog>

      <FormDialog
        open={adminsFor !== null}
        title={`${t.orgs.admins} · ${adminsFor ? (ar ? adminsFor.nameAr : adminsFor.nameEn) : ''}`}
        submitLabel={t.orgs.addAdmin}
        onClose={() => setAdminsFor(null)}
        onSubmit={addAdmin}
      >
        <p className="hint">{t.orgs.adminsIntro}</p>
        <LoadState loading={admins.loading && !admins.data} error={admins.error} onRetry={admins.reload} />
        {admins.data && admins.data.length === 0 && <p className="hint">{t.orgs.noAdmins}</p>}
        {admins.data && admins.data.length > 0 && (
          <ul className="wallet-list">
            {admins.data.map((a) => (
              <li key={a.id}>
                <span>
                  {a.name ?? '—'}
                  <span className="sub">{a.lastLoginAt ? formatDate(a.lastLoginAt, lang) : ''}</span>
                </span>
                <span className="tabnum" dir="ltr">
                  {formatSaudiPhone(a.phone)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <div className="field">
            <label htmlFor="a-name">{t.orgs.adminName}</label>
            <input id="a-name" name="name" className="input" required minLength={2} />
          </div>
          <div className="field">
            <label htmlFor="a-phone">{t.orgs.adminPhone}</label>
            <input id="a-phone" name="phone" className="input num" required inputMode="tel" dir="ltr" placeholder="05XXXXXXXX" />
          </div>
        </div>
      </FormDialog>

      <FormDialog
        wide
        open={invoicesFor !== null && paying === null}
        title={`${t.orgs.invoices} · ${invoicesFor ? (ar ? invoicesFor.nameAr : invoicesFor.nameEn) : ''}`}
        submitLabel={t.orgs.issue}
        onClose={() => setInvoicesFor(null)}
        onSubmit={issue}
      >
        <LoadState loading={invoices.loading && !invoices.data} error={invoices.error} onRetry={invoices.reload} />
        {invoices.data && invoices.data.length === 0 && <p className="hint">{t.orgs.noInvoices}</p>}
        {invoices.data && invoices.data.length > 0 && <OrgInvoiceTable invoices={invoices.data} htmlBase="admin/organization-invoices" onPay={setPaying} />}
        <div className="field">
          <label htmlFor="i-month">{t.orgs.month}</label>
          <input id="i-month" name="month" className="input num" type="month" required defaultValue={thisMonth()} max={thisMonth()} />
        </div>
      </FormDialog>

      <FormDialog open={paying !== null} title={t.orgs.recordPayment} submitLabel={t.orgs.recordPayment} onClose={() => setPaying(null)} onSubmit={pay}>
        {paying && (
          <p className="pay-who">
            <strong>{paying.number}</strong>
            <span className="tabnum">{formatSar(paying.totalHalalas, lang)}</span>
          </p>
        )}
        <div className="field">
          <label htmlFor="p-method">{t.subscriptions.method}</label>
          <select id="p-method" name="method" className="select" defaultValue="bank_transfer">
            <option value="bank_transfer">{t.subscriptions.methods.bank_transfer}</option>
            <option value="cash">{t.subscriptions.methods.cash}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="p-ref">
            {t.subscriptions.reference} ({t.common.optional})
          </label>
          <input id="p-ref" name="reference" className="input num" maxLength={80} dir="ltr" />
        </div>
      </FormDialog>
    </>
  );
}
