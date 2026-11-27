'use client';

import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, OrgInvoiceView } from '@/lib/client';
import { OrgInvoiceTable } from '@/components/OrgInvoices';

export default function OrgInvoicesPage() {
  const { t } = useApp();
  const list = useLoad(() => api<OrgInvoiceView[]>('org/invoices'), []);
  return (
    <>
      <div className="page-head">
        <h1>{t.nav.orgInvoices}</h1>
      </div>
      <section className="panel">
        <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
        {list.data && list.data.length === 0 && <p className="empty">{t.orgs.noInvoices}</p>}
        {list.data && list.data.length > 0 && <OrgInvoiceTable invoices={list.data} htmlBase="org/invoices" />}
      </section>
    </>
  );
}
