'use client';

import { useApp } from '@/components/Providers';
import { LoadState, useLoad } from '@/components/ui';
import { api, OrgProfileView, UserView } from '@/lib/client';
import { formatSar } from '@/lib/format';
import { fill } from '@/lib/i18n';

/** The organization admin's home: their agreement, what each plan costs them and their members. */
export default function OrgHomePage() {
  const { t, lang } = useApp();
  const { data, error, loading, reload } = useLoad(async () => {
    const [me, org] = await Promise.all([api<UserView>('me'), api<OrgProfileView>('org')]);
    return { me, org };
  }, []);
  const ar = lang === 'ar';

  return (
    <>
      <div className="page-head">
        <h1>{data ? fill(t.org.greeting, { name: data.me.name ?? '' }) : t.nav.orgHome}</h1>
      </div>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <>
          <p className="lead">
            <strong>{ar ? data.org.nameAr : data.org.nameEn}</strong> · {fill(t.org.by, { partner: ar ? data.org.partnerNameAr : data.org.partnerNameEn })}
            <br />
            {fill(t.org.coverage, { pct: data.org.coverageBps / 100 })}
          </p>
          {data.org.status === 'suspended' && (
            <p className="form-error" role="alert">
              {t.org.suspended}
            </p>
          )}
          <dl className="stats stats-3">
            <div className="stat">
              <dt>{t.org.members}</dt>
              <dd className="tabnum">{data.org.members}</dd>
            </div>
            <div className="stat">
              <dt>{t.org.seats}</dt>
              <dd className="tabnum">{data.org.seats}</dd>
            </div>
            <div className={`stat${data.org.unpaidHalalas > 0 ? ' stat-alert' : ''}`}>
              <dt>{t.org.unpaid}</dt>
              <dd className="tabnum">{formatSar(data.org.unpaidHalalas, lang)}</dd>
            </div>
          </dl>
          <section className="panel">
            <h2 className="panel-title">{t.org.plans}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t.org.plan}</th>
                    <th scope="col">{t.org.price}</th>
                    <th scope="col">{t.org.orgPays}</th>
                    <th scope="col">{t.org.memberPays}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.org.plans.map((p) => (
                    <tr key={p.id}>
                      <td>{ar ? p.nameAr : p.nameEn}</td>
                      <td className="tabnum">{formatSar(p.priceHalalas, lang)}</td>
                      <td className="tabnum">{formatSar(p.orgHalalas, lang)}</td>
                      <td className="tabnum">{formatSar(p.memberHalalas, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel note">
            <h2>{t.org.howTitle}</h2>
            <ol className="steps">
              <li>{t.org.how1}</li>
              <li>{t.org.how2}</li>
              <li>{t.org.how3}</li>
            </ol>
          </section>
        </>
      )}
    </>
  );
}
