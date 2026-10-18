'use client';

import { useState } from 'react';
import { InviteSent, IssuedCode } from '@/components/InviteSent';
import { useApp } from '@/components/Providers';
import { FormDialog, LoadState, useLoad } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatSaudiPhone } from '@/lib/format';
import { fill } from '@/lib/i18n';

type Audience = 'rider' | 'driver' | 'admin';

interface Invite {
  id: string;
  phone: string;
  audience: Audience;
  name: string | null;
  hasCode: boolean;
  codeExpiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  signedUp: boolean;
}

const TABS: Audience[] = ['rider', 'driver', 'admin'];

export default function AccessPage() {
  const { t, lang, notify } = useApp();
  const [tab, setTab] = useState<Audience>('rider');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const list = useLoad(() => {
    const q = new URLSearchParams({ audience: tab });
    if (search.trim()) q.set('search', search.trim());
    return api<Invite[]>(`admin/access?${q}`);
  }, [tab, search]);

  const when = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
      timeZone: 'Asia/Riyadh',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  const fail = (err: unknown) => notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');

  async function create(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? '').trim();
    const res = await api<IssuedCode>('admin/access', {
      method: 'POST',
      body: { phone: text('phone'), audience: text('audience'), name: text('name') || undefined },
    });
    setAdding(false);
    setIssued(res);
    await list.reload();
  }

  async function newCode(i: Invite) {
    try {
      setIssued(await api<IssuedCode>(`admin/access/${i.id}/code`, { method: 'POST' }));
      await list.reload();
    } catch (err) {
      fail(err);
    }
  }

  async function remove(i: Invite) {
    if (!window.confirm(fill(t.pilot.removeConfirm, { name: i.name ?? formatSaudiPhone(i.phone) }))) return;
    try {
      await api(`admin/access/${i.id}`, { method: 'DELETE' });
      notify(t.pilot.removed);
      await list.reload();
    } catch (err) {
      fail(err);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.pilot.accessTitle}</h1>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          {t.pilot.add}
        </button>
      </div>
      <p className="lede">{t.pilot.accessIntro}</p>
      <section className="panel">
        <div className="panel-tools">
          <div className="tabs" role="tablist">
            {TABS.map((key) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                {t.pilot.audiences[key]}
              </button>
            ))}
          </div>
          <input
            className="input input-search"
            type="search"
            placeholder={t.pilot.search}
            aria-label={t.pilot.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && list.data.length === 0 && <p className="empty">{t.pilot.empty}</p>}
        {list.data && list.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.pilot.name}</th>
                  <th scope="col">{t.pilot.state}</th>
                  <th scope="col">{t.pilot.code}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t.pilot.newCode}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.name ?? '—'}
                      <span className="sub tabnum" dir="ltr">
                        {formatSaudiPhone(i.phone)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${i.signedUp ? 'active' : 'pending'}`}>{i.signedUp ? t.pilot.signedUp : t.pilot.notYet}</span>
                      {i.lastUsedAt && <span className="sub tabnum">{fill(t.pilot.lastUsed, { date: when(i.lastUsedAt) })}</span>}
                    </td>
                    <td className="tabnum">{i.hasCode && i.codeExpiresAt ? fill(t.pilot.codeValid, { date: when(i.codeExpiresAt) }) : t.pilot.noCode}</td>
                    <td className="actions">
                      <button type="button" className="btn btn-sm btn-quiet" onClick={() => newCode(i)}>
                        {t.pilot.newCode}
                      </button>
                      <button type="button" className="btn btn-link btn-danger" onClick={() => remove(i)}>
                        {t.pilot.remove}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <FormDialog open={adding} title={t.pilot.add} submitLabel={t.pilot.invite} onClose={() => setAdding(false)} onSubmit={create}>
        <div className="field">
          <label htmlFor="phone">{t.pilot.phone}</label>
          <input id="phone" name="phone" className="input num" type="tel" inputMode="tel" required placeholder="05XXXXXXXX" dir="ltr" />
        </div>
        <div className="field">
          <label htmlFor="name">
            {t.pilot.name} ({t.common.optional})
          </label>
          <input id="name" name="name" className="input" maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="audience">{t.pilot.audience}</label>
          <select id="audience" name="audience" className="select" defaultValue={tab}>
            {TABS.map((a) => (
              <option key={a} value={a}>
                {t.pilot.audiences[a]}
              </option>
            ))}
          </select>
        </div>
      </FormDialog>
      <InviteSent issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}
