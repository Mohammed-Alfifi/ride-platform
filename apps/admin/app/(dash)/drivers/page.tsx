'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, DriverPage, PartnerView } from '@/lib/client';
import { formatDate, formatSaudiPhone } from '@/lib/format';
import { fill } from '@/lib/i18n';

type Tab = 'submitted' | 'approved' | 'rejected' | 'draft' | 'hold';
const TABS: Tab[] = ['submitted', 'approved', 'hold', 'rejected', 'draft'];
const PAGE_SIZE = 20;

export default function DriversPage() {
  const { t, lang } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('submitted');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const waiting = useLoad(() => api<DriverPage>('admin/drivers?status=submitted&pageSize=1'), []);
  const partners = useLoad(() => api<PartnerView[]>('admin/partners'), []);
  const list = useLoad(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (tab === 'hold') params.set('hold', 'true');
    else params.set('status', tab);
    if (query) params.set('q', query);
    return api<DriverPage>(`admin/drivers?${params}`);
  }, [tab, query, page]);

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;
  const joinCode = partners.data?.length === 1 ? partners.data[0].joinCode : null;

  return (
    <>
      <div className="page-head">
        <h1>{t.drivers.title}</h1>
        {joinCode && (
          <span>
            {t.partners.joinCode}: <code className="join-code">{joinCode}</code>
          </span>
        )}
      </div>

      <section className="panel">
        <div className="tabs" role="tablist">
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setTab(key);
                setPage(1);
              }}
            >
              {t.drivers.tabs[key]}
              {key === 'submitted' && (waiting.data?.total ?? 0) > 0 && (
                <span className="count-pill">{waiting.data?.total}</span>
              )}
            </button>
          ))}
        </div>
        <div className="toolbar">
          <input
            className="input"
            type="search"
            placeholder={t.drivers.search}
            aria-label={t.drivers.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && list.data.items.length === 0 && (
          <p className="empty">
            {t.drivers.empty}
            {joinCode && tab === 'submitted' && (
              <>
                <br />
                {t.drivers.emptyHint}
                <code className="join-code">{joinCode}</code>
              </>
            )}
          </p>
        )}
        {list.data && list.data.items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.drivers.name}</th>
                  <th scope="col">{t.drivers.phone}</th>
                  <th scope="col">{t.drivers.vehicle}</th>
                  <th scope="col">{t.drivers.submittedAt}</th>
                  <th scope="col">{t.drivers.pendingDocs}</th>
                  <th scope="col">{t.users.status}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => router.push(`/drivers/${d.id}`)}>
                    <td>
                      <Link href={`/drivers/${d.id}`} onClick={(e) => e.stopPropagation()}>
                        {d.fullName ?? '—'}
                      </Link>
                    </td>
                    <td className="num">{formatSaudiPhone(d.phone)}</td>
                    <td>{d.vehicle ?? '—'}</td>
                    <td className="tabnum">{formatDate(d.submittedAt, lang)}</td>
                    <td className="tabnum">{d.pendingDocuments > 0 ? d.pendingDocuments : '—'}</td>
                    <td>
                      {d.complianceHold ? (
                        <span className="badge badge-hold">{t.drivers.hold}</span>
                      ) : (
                        <span
                          className={`badge badge-${
                            d.onboardingStatus === 'approved' ? 'active' : d.onboardingStatus === 'rejected' ? 'suspended' : 'pending'
                          }`}
                        >
                          {t.drivers.onboarding[d.onboardingStatus]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > PAGE_SIZE && (
          <div className="pager">
            <span>{fill(t.users.pageOf, { page, pages })}</span>
            <div className="btns">
              <button type="button" className="btn btn-quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t.users.previous}
              </button>
              <button type="button" className="btn btn-quiet" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t.users.next}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
