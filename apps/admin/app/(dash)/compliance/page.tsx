'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, ExpiringItem } from '@/lib/client';
import { formatDay, formatSaudiPhone } from '@/lib/format';
import { fill } from '@/lib/i18n';

const WINDOWS = [7, 30, 60];

export default function CompliancePage() {
  const { t, lang } = useApp();
  const [days, setDays] = useState(30);
  const list = useLoad(() => api<ExpiringItem[]>(`admin/compliance/expiring?days=${days}`), [days]);

  function left(n: number) {
    if (n < 0) return <span className="days-expired">{fill(t.compliance.expired, { n: Math.abs(n) })}</span>;
    if (n === 0) return <span className="days-expired">{t.compliance.today}</span>;
    return <span className={n <= 7 ? 'days-soon' : undefined}>{fill(t.compliance.inDays, { n })}</span>;
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.compliance.title}</h1>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {t.compliance.within}
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          {t.compliance.days}
        </label>
      </div>
      <p className="lead">{t.compliance.intro}</p>

      <section className="panel">
        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && list.data.length === 0 && <p className="empty">{t.compliance.empty}</p>}
        {list.data && list.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.compliance.driver}</th>
                  <th scope="col">{t.drivers.phone}</th>
                  <th scope="col">{t.compliance.document}</th>
                  <th scope="col">{t.compliance.expiresAt}</th>
                  <th scope="col">{t.compliance.left}</th>
                  <th scope="col">{t.users.status}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((row) => (
                  <tr key={row.documentId}>
                    <td>
                      <Link href={`/drivers/${row.driverId}`}>{row.driverName ?? '—'}</Link>
                    </td>
                    <td className="num">{formatSaudiPhone(row.phone)}</td>
                    <td>{t.docTypes[row.type]}</td>
                    <td className="tabnum">{formatDay(row.expiresAt, lang)}</td>
                    <td className="tabnum">{left(row.daysLeft)}</td>
                    <td>
                      {row.complianceHold ? (
                        <span className="badge badge-hold">{t.drivers.hold}</span>
                      ) : (
                        <span className="badge badge-active">{t.status.active}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
