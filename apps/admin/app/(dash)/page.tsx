'use client';

import Link from 'next/link';
import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { AdminSubscription, api, DriverPage, ExpiringItem, Page, PaymentPage, UserView } from '@/lib/client';
import { formatSar } from '@/lib/format';
import { fill } from '@/lib/i18n';

interface Overview {
  me: UserView;
  activeSubscriptions: number;
  pastDue: number;
  waitingDrivers: number;
  expiring: number;
  collectedHalalas: number | null;
}

function monthStart(): string {
  return `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date()).slice(0, 8)}01`;
}

export default function OverviewPage() {
  const { t, lang } = useApp();
  const { data, error, loading, reload } = useLoad<Overview>(async () => {
    const me = await api<UserView>('me');
    const subs = (status: string) =>
      api<Page<AdminSubscription>>(`admin/subscriptions?status=${status}&pageSize=1`).then((p) => p.total);
    const [activeSubscriptions, pastDue, waiting, expiring, payments] = await Promise.all([
      subs('active'),
      subs('past_due'),
      api<DriverPage>('admin/drivers?status=submitted&pageSize=1'),
      api<ExpiringItem[]>('admin/compliance/expiring'),
      // Dispatchers do not see revenue.
      me.role === 'dispatcher'
        ? Promise.resolve(null)
        : api<PaymentPage>(`admin/payments?status=paid&from=${monthStart()}&pageSize=1`),
    ]);
    return {
      me,
      activeSubscriptions,
      pastDue,
      waitingDrivers: waiting.total,
      expiring: expiring.length,
      collectedHalalas: payments ? payments.totals.collectedHalalas : null,
    };
  }, []);

  const num = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en');
  const stats = data
    ? [
        { label: t.overview.activeSubscriptions, value: num(data.activeSubscriptions) },
        { label: t.overview.collectedThisMonth, value: data.collectedHalalas === null ? '—' : formatSar(data.collectedHalalas, lang) },
        { label: t.overview.waitingDrivers, value: num(data.waitingDrivers) },
        { label: t.overview.expiring, value: num(data.expiring) },
      ]
    : [];

  const todo = data
    ? [
        { n: data.waitingDrivers, text: t.overview.todoDrivers, href: '/drivers' },
        { n: data.pastDue, text: t.overview.todoPastDue, href: '/subscriptions' },
        { n: data.expiring, text: t.overview.todoExpiring, href: '/compliance' },
      ].filter((x) => x.n > 0)
    : [];

  return (
    <>
      <div className="page-head">
        <h1>{data ? fill(t.overview.greeting, { name: data.me.name ?? '' }) : t.nav.overview}</h1>
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <>
          <dl className="stats">
            {stats.map((s) => (
              <div className="stat" key={s.label}>
                <dt>{s.label}</dt>
                <dd className="tabnum">{s.value}</dd>
              </div>
            ))}
          </dl>
          <section className="panel note">
            <h2>{t.overview.todoTitle}</h2>
            {todo.length === 0 ? (
              <p>{t.overview.allClear}</p>
            ) : (
              <ul className="todo">
                {todo.map((x) => (
                  <li key={x.href}>
                    <Link href={x.href}>{fill(x.text, { n: x.n })}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
