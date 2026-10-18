'use client';

import { useState } from 'react';
import { ApiError, DriverPage } from '@/lib/client';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { AdminSubscription, api, Page, SubscriptionStatus } from '@/lib/client';
import { formatDay, formatSar, formatSaudiPhone } from '@/lib/format';
import { fill } from '@/lib/i18n';

const TABS: (SubscriptionStatus | 'all')[] = ['active', 'past_due', 'pending_payment', 'cancelled', 'expired', 'all'];
const PAGE_SIZE = 20;
const TONE: Record<SubscriptionStatus, 'active' | 'pending' | 'suspended'> = {
  active: 'active',
  paused: 'pending',
  pending_payment: 'pending',
  past_due: 'suspended',
  cancelled: 'suspended',
  expired: 'suspended',
};

export default function SubscriptionsPage() {
  const { t, lang, notify } = useApp();
  const [tab, setTab] = useState<SubscriptionStatus | 'all'>('active');
  const [page, setPage] = useState(1);
  const list = useLoad(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (tab !== 'all') params.set('status', tab);
    return api<Page<AdminSubscription>>(`admin/subscriptions?${params}`);
  }, [tab, page]);
  const drivers = useLoad(() => api<DriverPage>('admin/drivers?status=approved&pageSize=100'), []);

  async function setDriver(subId: string, driverId: string) {
    try {
      await api(`admin/subscriptions/${subId}/driver`, { method: 'PATCH', body: { driverId: driverId || null } });
      notify(t.subscriptions.driverSaved);
      await list.reload();
    } catch (err) {
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

  const daysLabel = (days: number[]) => days.map((d) => t.subscriptions.days[d]).join(lang === 'ar' ? '، ' : ', ');

  return (
    <>
      <div className="page-head">
        <h1>{t.subscriptions.title}</h1>
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
              {key === 'all' ? t.subscriptions.all : t.subscriptions.states[key]}
            </button>
          ))}
        </div>
        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && list.data.items.length === 0 && <p className="empty">{t.subscriptions.empty}</p>}
        {list.data && list.data.items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.subscriptions.rider}</th>
                  <th scope="col">{t.subscriptions.plan}</th>
                  <th scope="col">{t.subscriptions.schedule}</th>
                  <th scope="col">{t.subscriptions.price}</th>
                  <th scope="col">{t.subscriptions.periodEnd}</th>
                  <th scope="col">{t.subscriptions.driver}</th>
                  <th scope="col">{t.subscriptions.status}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((s) => {
                  const paused = s.pausedFrom && s.pausedUntil && s.pausedFrom <= today && s.pausedUntil >= today;
                  return (
                    <tr key={s.id}>
                      <td>
                        {s.riderName ?? '—'}
                        <span className="sub tabnum" dir="ltr">
                          {formatSaudiPhone(s.riderPhone)}
                        </span>
                      </td>
                      <td>{lang === 'ar' ? s.planNameAr : s.planNameEn}</td>
                      <td>
                        {daysLabel(s.days)}
                        <span className="sub tabnum">
                          {s.outboundTime}
                          {s.returnTime ? ` / ${s.returnTime}` : ''}
                        </span>
                      </td>
                      <td className="tabnum">{formatSar(s.priceHalalas, lang)}</td>
                      <td className="tabnum">{formatDay(s.currentPeriodEnd, lang)}</td>
                      <td>
                        {s.status === 'active' || s.status === 'past_due' ? (
                          <select
                            className={`select select-sm select-driver${s.driverId ? '' : ' select-missing'}`}
                            value={s.driverId ?? ''}
                            onChange={(e) => setDriver(s.id, e.target.value)}
                            aria-label={t.subscriptions.driver}
                          >
                            <option value="">{t.subscriptions.noDriver}</option>
                            {(drivers.data?.items ?? [])
                              .filter((d) => !d.complianceHold && d.partnerId === s.partnerId)
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.fullName ?? d.phone}
                                </option>
                              ))}
                          </select>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className={`badge badge-${TONE[s.status]}`}>{t.subscriptions.states[s.status]}</span>
                        {s.cancelAtPeriodEnd && <span className="sub">{t.subscriptions.endsAtPeriodEnd}</span>}
                        {paused && (
                          <span className="sub">{fill(t.subscriptions.pausedUntil, { date: formatDay(s.pausedUntil, lang) })}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.data && pages > 1 && (
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
