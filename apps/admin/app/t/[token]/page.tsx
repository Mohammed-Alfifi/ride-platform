'use client';

import dynamic from 'next/dynamic';
import { use, useEffect, useState } from 'react';

const SharedMap = dynamic(() => import('@/components/SharedMap'), { ssr: false, loading: () => <div className="shared-map" /> });

interface Shared {
  passenger: string | null;
  status: 'scheduled' | 'en_route' | 'arrived' | 'on_board' | 'completed' | 'no_show' | 'skipped' | 'cancelled';
  leg: 'outbound' | 'return';
  scheduledAt: string;
  pickup: { lat: number; lng: number; name: string };
  dropoff: { lat: number; lng: number; name: string };
  driver: { name: string | null; vehicle: string | null; plate: string | null } | null;
  driverLocation: { lat: number; lng: number; heading: number | null } | null;
  etaMinutes: number | null;
  times: { startedAt: string | null; arrivedAt: string | null; pickedUpAt: string | null; completedAt: string | null };
}

const time = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '';

/** What a parent or relative sees from a shared link: where the car is, in plain words. */
export default function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Shared | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/share/${token}`, { cache: 'no-store' });
        if (res.status === 404) {
          setGone(true);
          return;
        }
        if (res.ok && !stop) setData((await res.json()) as Shared);
      } catch {
        // Keep the last view; try again on the next tick.
      }
    };
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [token]);

  if (gone) {
    return (
      <main className="shared shared-gone">
        <Brand />
        <h1>انتهت صلاحية هذا الرابط</h1>
        <p>روابط المتابعة تعمل أثناء الرحلة فقط. اطلب رابطا جديدا من صاحب الاشتراك.</p>
      </main>
    );
  }
  if (!data) return <main className="shared shared-gone"><Brand /><p>جار التحميل…</p></main>;

  const who = data.passenger ?? 'الراكب';
  const { headline, detail } = describe(data, who);
  const steps: [string, string | null][] = [
    ['في الطريق', data.times.startedAt],
    ['وصل السائق', data.times.arrivedAt],
    [`ركب ${who}`, data.times.pickedUpAt],
    ['وصل', data.times.completedAt],
  ];

  return (
    <main className="shared">
      <SharedMap pickup={data.pickup} dropoff={data.dropoff} car={data.driverLocation} heading={data.driverLocation?.heading ?? null} />
      <section className="shared-panel" aria-live="polite">
        <Brand />
        <p className="shared-detail">{detail}</p>
        <h1>{headline}</h1>
        <ol className="shared-steps">
          {steps.map(([label, at]) => (
            <li key={label} className={at ? 'done' : ''}>
              <span>{label}</span>
              <span className="tabnum">{time(at)}</span>
            </li>
          ))}
        </ol>
        <div className="shared-route">
          <span>{data.pickup.name}</span>
          <span aria-hidden="true">←</span>
          <span>{data.dropoff.name}</span>
        </div>
        {data.driver && (
          <div className="shared-driver">
            <div>
              <strong>{data.driver.name ?? 'السائق'}</strong>
              {data.driver.vehicle && <span>{data.driver.vehicle}</span>}
            </div>
            {data.driver.plate && (
              <bdi dir="ltr" className="plate-chip">
                {data.driver.plate}
              </bdi>
            )}
          </div>
        )}
        <p className="shared-note">يتحدث تلقائيا كل 5 ثوان. لا تظهر أرقام الجوال في هذه الصفحة.</p>
      </section>
    </main>
  );
}

function describe(d: Shared, who: string): { headline: string; detail: string } {
  switch (d.status) {
    case 'scheduled':
      return { headline: `الرحلة الساعة ${time(d.scheduledAt)}`, detail: 'لم يتحرك السائق بعد' };
    case 'en_route':
      return {
        headline: d.etaMinutes ? `يصل خلال ${d.etaMinutes} دقيقة` : 'السائق في الطريق',
        detail: `السائق في الطريق إلى ${d.pickup.name}`,
      };
    case 'arrived':
      return { headline: 'وصل السائق', detail: `ينتظر ${who} عند ${d.pickup.name}` };
    case 'on_board':
      return {
        headline: d.etaMinutes ? `الوصول خلال ${d.etaMinutes} دقيقة` : `في الطريق إلى ${d.dropoff.name}`,
        detail: `${who} في السيارة`,
      };
    case 'completed':
      return { headline: 'وصل بالسلامة', detail: `وصل ${who} إلى ${d.dropoff.name} الساعة ${time(d.times.completedAt)}` };
    case 'no_show':
      return { headline: 'لم تتم الرحلة', detail: `انتظر السائق ولم يحضر ${who}` };
    default:
      return { headline: 'أُلغيت هذه الرحلة', detail: '' };
  }
}

function Brand() {
  return (
    <div className="shared-brand">
      <svg width="28" height="28" viewBox="0 0 76 76" aria-hidden="true">
        <rect width="76" height="76" rx="20" fill="#18263A" />
        <path d="M18 50 C 30 50, 30 26, 44 26 S 58 30, 58 30" fill="none" stroke="#3FBF8F" strokeWidth="5" strokeLinecap="round" />
        <circle cx="18" cy="50" r="6.5" fill="#18263A" stroke="#3FBF8F" strokeWidth="4" />
        <circle cx="58" cy="30" r="8" fill="#F2B33D" />
      </svg>
      <span>مشوار</span>
    </div>
  );
}
