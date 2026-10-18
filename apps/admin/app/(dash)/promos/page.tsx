'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, StatusBadge, useLoad } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatDay, formatSar } from '@/lib/format';

interface Promo {
  id: string;
  code: string;
  kind: 'percent' | 'amount';
  value: number;
  maxUses: number | null;
  usedCount: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
}

export default function PromosPage() {
  const { t, lang, notify } = useApp();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const list = useLoad(() => api<Promo[]>('admin/promo-codes'), []);

  async function create(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? '').trim();
    const value = Number(text('value'));
    await api('admin/promo-codes', {
      method: 'POST',
      body: {
        code: text('code'),
        kind,
        value: kind === 'percent' ? Math.round(value) : Math.round(value * 100),
        maxUses: text('maxUses') ? Number(text('maxUses')) : undefined,
        validFrom: text('validFrom') || undefined,
        validUntil: text('validUntil') || undefined,
      },
    });
    setAdding(false);
    notify(t.promos.created);
    await list.reload();
  }

  async function toggle(p: Promo) {
    try {
      await api(`admin/promo-codes/${p.id}`, { method: 'PATCH', body: { active: !p.active } });
      notify(t.promos.updated);
      await list.reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  const discount = (p: Promo) => (p.kind === 'percent' ? `${p.value}%` : `${formatSar(p.value, lang)} ${lang === 'ar' ? 'ريال' : 'SAR'}`);
  const validity = (p: Promo) =>
    !p.validFrom && !p.validUntil ? t.promos.always : `${p.validFrom ? formatDay(p.validFrom, lang) : '…'} – ${p.validUntil ? formatDay(p.validUntil, lang) : '…'}`;

  return (
    <>
      <div className="page-head">
        <h1>{t.promos.title}</h1>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          {t.promos.add}
        </button>
      </div>
      <p className="lede">{t.promos.intro}</p>
      <section className="panel">
        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && list.data.length === 0 && <p className="empty">{t.promos.empty}</p>}
        {list.data && list.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.promos.code}</th>
                  <th scope="col">{t.promos.discount}</th>
                  <th scope="col">{t.promos.uses}</th>
                  <th scope="col">{t.promos.validity}</th>
                  <th scope="col">{t.promos.status}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t.promos.status}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <code className="join-code">{p.code}</code>
                    </td>
                    <td className="tabnum">{discount(p)}</td>
                    <td className="tabnum">
                      {p.usedCount} / {p.maxUses ?? t.promos.unlimited}
                    </td>
                    <td className="tabnum">{validity(p)}</td>
                    <td>
                      <StatusBadge status={p.active ? 'active' : 'suspended'} />
                    </td>
                    <td className="actions">
                      <button type="button" className={`btn btn-link${p.active ? ' btn-danger' : ''}`} onClick={() => toggle(p)}>
                        {p.active ? t.promos.stop : t.promos.resume}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FormDialog open={adding} title={t.promos.add} submitLabel={t.promos.add} onClose={() => setAdding(false)} onSubmit={create}>
        <div className="field">
          <label htmlFor="code">{t.promos.code}</label>
          <input id="code" name="code" className="input num" required pattern="[A-Za-z0-9-]{3,20}" maxLength={20} dir="ltr" placeholder="SCHOOL25" />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="kind">{t.promos.kind}</label>
            <select id="kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'amount')}>
              <option value="percent">{t.promos.percent}</option>
              <option value="amount">{t.promos.amount}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="value">{t.promos.value}</label>
            <input id="value" name="value" className="input num" type="number" min={1} max={kind === 'percent' ? 100 : 10000} step={kind === 'percent' ? 1 : 0.01} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="maxUses">
            {t.promos.maxUses} ({t.common.optional})
          </label>
          <input id="maxUses" name="maxUses" className="input num" type="number" min={1} />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="validFrom">
              {t.promos.validFrom} ({t.common.optional})
            </label>
            <input id="validFrom" name="validFrom" className="input" type="date" />
          </div>
          <div className="field">
            <label htmlFor="validUntil">
              {t.promos.validUntil} ({t.common.optional})
            </label>
            <input id="validUntil" name="validUntil" className="input" type="date" />
          </div>
        </div>
      </FormDialog>
    </>
  );
}
