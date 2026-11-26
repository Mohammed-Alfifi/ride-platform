'use client';

import { useState } from 'react';
import { OrgInvoiceTable } from '@/components/OrgInvoices';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, ApiError, OrgInvoiceView, OrgProfileView } from '@/lib/client';

export default function OrgInvoicesPage() {
  const { t, notify } = useApp();
  const [opening, setOpening] = useState(false);
  const data = useLoad(async () => {
    const [invoices, org] = await Promise.all([api<OrgInvoiceView[]>('org/invoices'), api<OrgProfileView>('org')]);
    return { invoices, org };
  }, []);

  /** Off to the gateway; it returns to the API, which brings the admin back here. */
  async function pay(inv: OrgInvoiceView) {
    setOpening(true);
    try {
      const res = await api<{ checkoutUrl: string }>(`org/invoices/${inv.id}/checkout`, { method: 'POST' });
      window.location.assign(res.checkoutUrl);
    } catch (err) {
      setOpening(false);
      notify(err instanceof ApiError && err.message ? err.message : t.common.networkError, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>{t.nav.orgInvoices}</h1>
      </div>
      {opening && (
        <p className="lead" role="status">
          {t.orgInvoice.opening}
        </p>
      )}
      <section className="panel">
        <LoadState loading={data.loading && !data.data} error={data.error} onRetry={data.reload} />
        {data.data && data.data.invoices.length === 0 && <p className="empty">{t.orgs.noInvoices}</p>}
        {data.data && data.data.invoices.length > 0 && (
          <OrgInvoiceTable
            invoices={data.data.invoices}
            htmlBase="org/invoices"
            onPay={data.data.org.payOnline && !opening ? pay : undefined}
            payLabel={t.orgInvoice.payNow}
          />
        )}
      </section>
    </>
  );
}
