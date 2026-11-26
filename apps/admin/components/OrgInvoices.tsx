'use client';

import { useApp } from '@/components/Providers';
import { OrgInvoiceView } from '@/lib/client';
import { formatDay, formatSar } from '@/lib/format';

/** Organization invoices, for the organization itself or for the partner (who can record payment). */
export function OrgInvoiceTable({
  invoices,
  htmlBase,
  onPay,
}: {
  invoices: OrgInvoiceView[];
  htmlBase: 'org/invoices' | 'admin/organization-invoices';
  onPay?: (inv: OrgInvoiceView) => void;
}) {
  const { t, lang } = useApp();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{t.orgInvoice.number}</th>
            <th scope="col">{t.orgInvoice.month}</th>
            <th scope="col">{t.orgInvoice.lines}</th>
            <th scope="col">{t.orgInvoice.total}</th>
            <th scope="col">{t.orgInvoice.due}</th>
            <th scope="col">{t.orgInvoice.status}</th>
            {onPay && (
              <th scope="col">
                <span className="visually-hidden">{t.orgs.recordPayment}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td className="tabnum nowrap">
                <a href={`/api/proxy/${htmlBase}/${inv.id}/html`} target="_blank" rel="noreferrer">
                  {inv.number}
                </a>
              </td>
              <td className="tabnum nowrap">{inv.month}</td>
              <td className="tabnum">{inv.lines}</td>
              <td className="tabnum">{formatSar(inv.totalHalalas, lang)}</td>
              <td className="tabnum nowrap">{formatDay(inv.dueDate, lang)}</td>
              <td>
                <span className={`badge badge-${inv.status === 'paid' ? 'active' : inv.overdue ? 'suspended' : 'pending'}`}>
                  {inv.overdue ? t.orgInvoice.overdue : t.orgInvoice.states[inv.status]}
                </span>
              </td>
              {onPay && (
                <td className="actions">
                  {inv.status === 'issued' && (
                    <button type="button" className="btn btn-sm" onClick={() => onPay(inv)}>
                      {t.orgs.recordPayment}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
