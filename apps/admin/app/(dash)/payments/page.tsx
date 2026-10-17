'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { AdminPayment, api, PaymentPage } from '@/lib/client';
import { formatDate, formatSar, formatSaudiPhone } from '@/lib/format';
import { fill } from '@/lib/i18n';

const PAGE_SIZE = 25;
const TONE: Record<AdminPayment['status'], 'active' | 'pending' | 'suspended'> = {
  paid: 'active',
  initiated: 'pending',
  failed: 'suspended',
};

function riyadhToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
}

export default function PaymentsPage() {
  const { t, lang } = useApp();
  const [from, setFrom] = useState(() => `${riyadhToday().slice(0, 8)}01`);
  const [to, setTo] = useState(riyadhToday);
  const [status, setStatus] = useState<'' | AdminPayment['status']>('');
  const [page, setPage] = useState(1);

  const list = useLoad(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (status) params.set('status', status);
    return api<PaymentPage>(`admin/payments?${params}`);
  }, [from, to, status, page]);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;
  const totals = list.data?.totals;
  const sar = (h: number | undefined) => (h === undefined ? '—' : formatSar(h, lang));

  return (
    <>
      <div className="page-head">
        <h1>{t.payments.title}</h1>
      </div>
      <p className="lede">{t.payments.intro}</p>

      <dl className="stats">
        <div className="stat">
          <dt>{t.payments.collected}</dt>
          <dd className="tabnum">{sar(totals?.collectedHalalas)}</dd>
        </div>
        <div className="stat">
          <dt>{t.payments.partnerShare}</dt>
          <dd className="tabnum">{sar(totals?.partnerShareHalalas)}</dd>
        </div>
        <div className="stat">
          <dt>{t.payments.platformFee}</dt>
          <dd className="tabnum">{sar(totals?.platformFeeHalalas)}</dd>
        </div>
        <div className="stat">
          <dt>{t.payments.paidCount}</dt>
          <dd className="tabnum">{totals ? totals.paidCount : '—'}</dd>
        </div>
      </dl>

      <section className="panel">
        <div className="toolbar">
          <label className="inline-field">
            <span>{t.payments.from}</span>
            <input
              className="input tabnum"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="inline-field">
            <span>{t.payments.to}</span>
            <input
              className="input tabnum"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="inline-field">
            <span>{t.payments.status}</span>
            <select
              className="select"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPage(1);
              }}
            >
              <option value="">{t.payments.all}</option>
              <option value="paid">{t.payments.states.paid}</option>
              <option value="initiated">{t.payments.states.initiated}</option>
              <option value="failed">{t.payments.states.failed}</option>
            </select>
          </label>
        </div>
        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && list.data.items.length === 0 && <p className="empty">{t.payments.empty}</p>}
        {list.data && list.data.items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.payments.date}</th>
                  <th scope="col">{t.payments.rider}</th>
                  <th scope="col">{t.payments.purpose}</th>
                  <th scope="col">{t.payments.amount}</th>
                  <th scope="col">{t.payments.partnerShare}</th>
                  <th scope="col">{t.payments.provider}</th>
                  <th scope="col">{t.payments.status}</th>
                  <th scope="col">{t.payments.invoice}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="tabnum">{formatDate(p.paidAt ?? p.createdAt, lang)}</td>
                    <td>
                      {p.riderName ?? '—'}
                      <span className="sub tabnum" dir="ltr">
                        {formatSaudiPhone(p.riderPhone)}
                      </span>
                    </td>
                    <td>{t.payments.purposes[p.purpose]}</td>
                    <td className="tabnum">{formatSar(p.amountHalalas, lang)}</td>
                    <td className="tabnum">{p.status === 'paid' ? formatSar(p.partnerShareHalalas, lang) : '—'}</td>
                    <td>{p.provider}</td>
                    <td>
                      <span className={`badge badge-${TONE[p.status]}`}>{t.payments.states[p.status]}</span>
                      {p.status === 'failed' && p.failureReason && <span className="sub">{p.failureReason}</span>}
                    </td>
                    <td>
                      {p.invoiceId ? (
                        <a href={`/api/proxy/invoices/${p.invoiceId}`} target="_blank" rel="noreferrer" className="tabnum">
                          {p.invoiceNumber}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
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
