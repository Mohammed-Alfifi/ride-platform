'use client';

import { useEffect, useState } from 'react';
import { InviteSent, IssuedCode } from '@/components/InviteSent';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatDay, formatSaudiPhone } from '@/lib/format';
import { fill } from '@/lib/i18n';

type JoinStatus = 'new' | 'invited' | 'declined';

interface JoinRequest {
  id: string;
  kind: 'rider' | 'driver';
  name: string;
  phone: string;
  city: string;
  district: string | null;
  destination: string | null;
  morningTime: string | null;
  returnTime: string | null;
  riders: number | null;
  car: string | null;
  note: string | null;
  status: JoinStatus;
  createdAt: string;
}

const TABS: JoinStatus[] = ['new', 'invited', 'declined'];

export default function JoinRequestsPage() {
  const { t, lang, notify } = useApp();
  const [tab, setTab] = useState<JoinStatus>('new');
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = useLoad(() => api<JoinRequest[]>(`admin/join-requests?status=${tab}`), [tab]);
  const [joinUrl, setJoinUrl] = useState('/join');
  useEffect(() => setJoinUrl(`${window.location.origin}/join`), []);

  const fail = (err: unknown) => notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');

  async function invite(r: JoinRequest) {
    setBusy(r.id);
    try {
      setIssued(await api<IssuedCode>(`admin/join-requests/${r.id}/invite`, { method: 'POST' }));
      await list.reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function decline(r: JoinRequest) {
    if (!window.confirm(fill(t.pilot.declineConfirm, { name: r.name }))) return;
    try {
      await api(`admin/join-requests/${r.id}/decline`, { method: 'POST' });
      notify(t.pilot.declined);
      await list.reload();
    } catch (err) {
      fail(err);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.pilot.joinTitle}</h1>
      </div>
      <p className="lede">{t.pilot.joinIntro}</p>
      <p className="share-line">
        <span>{t.pilot.joinLink}</span>
        <a href="/join" target="_blank" rel="noopener" dir="ltr" className="num">
          {joinUrl}
        </a>
      </p>
      <section className="panel">
        <div className="tabs" role="tablist">
          {TABS.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {t.pilot.filters[key]}
            </button>
          ))}
        </div>
        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && list.data.length === 0 && <p className="empty">{t.pilot.empty}</p>}
        {list.data && list.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.pilot.applicant}</th>
                  <th scope="col">{t.pilot.area}</th>
                  <th scope="col">{t.pilot.destination}</th>
                  <th scope="col">{t.pilot.times}</th>
                  <th scope="col">{t.pilot.note}</th>
                  <th scope="col">{t.pilot.received}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t.pilot.invite}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name} <span className={`kind kind-${r.kind}`}>{t.pilot.kinds[r.kind]}</span>
                      <span className="sub tabnum" dir="ltr">
                        {formatSaudiPhone(r.phone)}
                      </span>
                    </td>
                    <td>
                      {r.district ?? '—'}
                      <span className="sub">{r.city}</span>
                    </td>
                    <td>
                      {r.kind === 'driver' ? (r.car ?? '—') : (r.destination ?? '—')}
                      {r.kind === 'rider' && r.riders ? (
                        <span className="sub">
                          {t.pilot.riders}: {r.riders}
                        </span>
                      ) : null}
                    </td>
                    <td className="tabnum">{r.morningTime || r.returnTime ? `${r.morningTime ?? '—'} / ${r.returnTime ?? '—'}` : '—'}</td>
                    <td className="note-cell">{r.note ?? '—'}</td>
                    <td className="tabnum">{formatDay(r.createdAt.slice(0, 10), lang)}</td>
                    <td className="actions">
                      {r.status !== 'declined' && (
                        <button type="button" className="btn btn-sm" disabled={busy === r.id} onClick={() => invite(r)}>
                          {r.status === 'invited' ? t.pilot.newCode : t.pilot.invite}
                        </button>
                      )}
                      {r.status === 'new' && (
                        <button type="button" className="btn btn-link btn-danger" onClick={() => decline(r)}>
                          {t.pilot.decline}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <InviteSent issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}
