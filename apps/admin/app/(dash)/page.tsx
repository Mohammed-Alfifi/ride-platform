'use client';

import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, PartnerView, UserPage, UserView } from '@/lib/client';
import { fill } from '@/lib/i18n';

interface Overview {
  me: UserView;
  partners: number;
  staff: number;
  drivers: number;
  riders: number | null;
}

export default function OverviewPage() {
  const { t, lang } = useApp();
  const { data, error, loading, reload } = useLoad<Overview>(async () => {
    const me = await api<UserView>('me');
    const total = (role: string) => api<UserPage>(`admin/users?role=${role}&pageSize=1`).then((p) => p.total);
    const [partners, admins, dispatchers, drivers] = await Promise.all([
      api<PartnerView[]>('admin/partners'),
      total('partner_admin'),
      total('dispatcher'),
      total('driver'),
    ]);
    // Riders are not tied to one partner, so only platform admins count them.
    const riders = me.role === 'super_admin' ? await total('rider') : null;
    return { me, partners: partners.length, staff: admins + dispatchers, drivers, riders };
  }, []);

  const stats = data
    ? [
        { label: t.overview.partners, value: data.partners },
        { label: t.overview.staff, value: data.staff },
        { label: t.overview.drivers, value: data.drivers },
        { label: t.overview.riders, value: data.riders },
      ]
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
                <dd className="tabnum">{s.value === null ? '—' : s.value.toLocaleString(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en')}</dd>
              </div>
            ))}
          </dl>
          <section className="panel note">
            <h2>{t.overview.nextTitle}</h2>
            <p>{t.overview.nextBody}</p>
          </section>
        </>
      )}
    </>
  );
}
