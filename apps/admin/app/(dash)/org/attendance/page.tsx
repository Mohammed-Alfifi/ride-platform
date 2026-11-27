'use client';

import { useState } from 'react';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, AttendanceRow, AttendanceView } from '@/lib/client';

const riyadh = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(d);

export default function OrgAttendancePage() {
  const { t } = useApp();
  const today = riyadh(new Date());
  const [range, setRange] = useState({ from: `${today.slice(0, 8)}01`, to: today });
  const [draft, setDraft] = useState(range);
  const data = useLoad(() => api<AttendanceView>(`org/attendance?from=${range.from}&to=${range.to}`), [range.from, range.to]);
  const cols: { key: keyof AttendanceRow; label: string; alert?: boolean }[] = [
    { key: 'planned', label: t.attendance.planned },
    { key: 'rode', label: t.attendance.rode },
    { key: 'excused', label: t.attendance.excused },
    { key: 'noShow', label: t.attendance.noShow },
    { key: 'missed', label: t.attendance.missed, alert: true },
    { key: 'late', label: t.attendance.late, alert: true },
  ];

  return (
    <>
      <div className="page-head">
        <h1>{t.attendance.title}</h1>
        <a className="btn btn-quiet" href={`/api/proxy/org/attendance.csv?from=${range.from}&to=${range.to}`} download>
          {t.attendance.download}
        </a>
      </div>
      <section className="panel">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.from && draft.to) setRange(draft);
          }}
        >
          <label className="inline-field">
            {t.attendance.from}
            <input className="input num" type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} required />
          </label>
          <label className="inline-field">
            {t.attendance.to}
            <input className="input num" type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} required />
          </label>
          <button type="submit" className="btn btn-quiet">
            {t.attendance.show}
          </button>
        </form>
        <p className="hint panel-hint">{t.attendance.hint}</p>
        <LoadState loading={data.loading && !data.data} error={data.error} onRetry={data.reload} />
        {data.data && data.data.rows.length === 0 && <p className="empty">{t.attendance.empty}</p>}
        {data.data && data.data.rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t.attendance.name}</th>
                  {cols.map((c) => (
                    <th scope="col" key={c.key} className="num-col">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.rows.map((r) => (
                  <tr key={r.memberId}>
                    <td>
                      {r.name}
                      {r.reference && <span className="sub">{r.reference}</span>}
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className={`tabnum num-col${c.alert && Number(r[c.key]) > 0 ? ' cell-alert' : ''}`}>
                        {r[c.key] as number}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{t.attendance.total}</th>
                  {cols.map((c) => (
                    <td key={c.key} className="tabnum num-col">
                      {data.data!.totals[c.key] as number}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
