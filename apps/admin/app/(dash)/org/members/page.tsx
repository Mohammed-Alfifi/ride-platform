'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, useLoad } from '@/components/ui';
import { api, ApiError, BulkResult, OrgMemberView } from '@/lib/client';
import { formatDay, formatSaudiPhone } from '@/lib/format';
import { fill } from '@/lib/i18n';

/** Reads pasted spreadsheet rows: mobile, name, reference; commas or tabs. */
function parseRows(text: string): { phone: string; name: string; reference?: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/\t|,|،/).map((c) => c.trim()))
    .filter((c) => c.length >= 2 && c[0] && c[1])
    .map(([phone, name, reference]) => ({ phone, name, ...(reference ? { reference } : {}) }));
}

export default function OrgMembersPage() {
  const { t, lang, notify } = useApp();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [report, setReport] = useState<BulkResult | null>(null);
  const members = useLoad(() => api<OrgMemberView[]>(`org/members${query ? `?q=${encodeURIComponent(query)}` : ''}`), [query]);

  async function add(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? '').trim();
    await api('org/members', { method: 'POST', body: { phone: text('phone'), name: text('name'), reference: text('reference') || undefined } });
    setAdding(false);
    notify(t.orgMembers.added);
    await members.reload();
  }

  async function addBulk(form: FormData) {
    const rows = parseRows(String(form.get('rows') ?? ''));
    if (rows.length === 0) return;
    const res = await api<BulkResult>('org/members/bulk', { method: 'POST', body: { members: rows.slice(0, 500) } });
    setBulk(false);
    setReport(res);
    await members.reload();
  }

  async function remove(m: OrgMemberView) {
    if (!window.confirm(t.orgMembers.removeConfirm)) return;
    try {
      await api(`org/members/${m.id}`, { method: 'DELETE' });
      notify(t.orgMembers.removed);
      await members.reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  const status = (m: OrgMemberView) => {
    if (!m.joined) return <span className="badge badge-muted">{t.orgMembers.notJoined}</span>;
    if (!m.subscriptionStatus) return <span className="badge badge-muted">{t.orgMembers.noSubscription}</span>;
    const tone = m.subscriptionStatus === 'active' ? 'active' : ['past_due', 'pending_payment'].includes(m.subscriptionStatus) ? 'pending' : 'suspended';
    return (
      <>
        <span className={`badge badge-${tone}`}>{t.orgMembers.states[m.subscriptionStatus]}</span>
        <span className="sub">
          {lang === 'ar' ? m.planNameAr : m.planNameEn}
          {m.currentPeriodEnd && m.subscriptionStatus === 'active' ? ` · ${fill(t.orgMembers.until, { date: formatDay(m.currentPeriodEnd, lang) })}` : ''}
        </span>
      </>
    );
  };

  return (
    <>
      <div className="page-head">
        <h1>{t.orgMembers.title}</h1>
        <div className="btns">
          <button type="button" className="btn btn-quiet" onClick={() => setBulk(true)}>
            {t.orgMembers.bulk}
          </button>
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            {t.orgMembers.add}
          </button>
        </div>
      </div>

      {report && (
        <section className="panel note" role="status">
          <p>{fill(t.orgMembers.bulkDone, { added: report.added, existing: report.existing, errors: report.errors.length })}</p>
          {report.errors.length > 0 && (
            <ul className="todo">
              {report.errors.slice(0, 20).map((e) => (
                <li key={`${e.row}-${e.phone}`}>{fill(t.orgMembers.bulkRow, { row: e.row, phone: e.phone, reason: t.orgMembers.reasons[e.code] })}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="panel">
        <form
          className="toolbar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.orgMembers.search} aria-label={t.orgMembers.search} />
        </form>
        <LoadState loading={members.loading && !members.data} error={members.error} onRetry={members.reload} />
        {members.data && members.data.length === 0 && <p className="empty">{t.orgMembers.empty}</p>}
        {members.data && members.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.orgMembers.name}</th>
                  <th scope="col">{t.orgMembers.phone}</th>
                  <th scope="col">{t.orgMembers.reference}</th>
                  <th scope="col">{t.orgMembers.status}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t.orgMembers.remove}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.data.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className="tabnum nowrap" dir="ltr">
                      {formatSaudiPhone(m.phone)}
                    </td>
                    <td className="nowrap">{m.reference ?? '—'}</td>
                    <td>{status(m)}</td>
                    <td className="actions">
                      <button type="button" className="btn btn-link btn-danger" onClick={() => remove(m)}>
                        {t.orgMembers.remove}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FormDialog open={adding} title={t.orgMembers.add} submitLabel={t.orgMembers.add} onClose={() => setAdding(false)} onSubmit={add}>
        <div className="field">
          <label htmlFor="m-name">{t.orgMembers.name}</label>
          <input id="m-name" name="name" className="input" required minLength={2} maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="m-phone">{t.orgMembers.phone}</label>
          <input id="m-phone" name="phone" className="input num" required inputMode="tel" dir="ltr" placeholder="05XXXXXXXX" aria-describedby="m-phone-hint" />
          <span className="hint" id="m-phone-hint">
            {t.orgMembers.phoneHint}
          </span>
        </div>
        <div className="field">
          <label htmlFor="m-ref">
            {t.orgMembers.reference} ({t.common.optional})
          </label>
          <input id="m-ref" name="reference" className="input" maxLength={60} aria-describedby="m-ref-hint" />
          <span className="hint" id="m-ref-hint">
            {t.orgMembers.referenceHint}
          </span>
        </div>
      </FormDialog>

      <FormDialog open={bulk} title={t.orgMembers.bulk} submitLabel={t.orgMembers.add} onClose={() => setBulk(false)} onSubmit={addBulk}>
        <p className="hint" id="bulk-hint">
          {t.orgMembers.bulkHint}
        </p>
        <textarea name="rows" className="input bulk-rows" rows={10} required dir="auto" aria-describedby="bulk-hint" placeholder={'0501234567, سارة العتيبي, E-1043\n0559876543, خالد الشهري, E-1044'} />
      </FormDialog>
    </>
  );
}
