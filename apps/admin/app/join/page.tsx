'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { RouteArt } from '@/components/RouteArt';
import { Site } from '@/components/Site';

type Kind = 'rider' | 'driver';

const CITIES = ['الرياض', 'جدة', 'مكة المكرمة', 'المدينة المنورة', 'الدمام', 'الخبر', 'أبها', 'أخرى'];

/**
 * The public front door of the pilot: what Mishwar is, how the pilot works, and the application form.
 * Applications land in the dashboard (Join requests); the team invites people from there.
 */
export default function JoinPage() {
  const [kind, setKind] = useState<Kind>('rider');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? '').trim();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          name: text('name'),
          phone: text('phone'),
          city: text('city'),
          district: text('district') || undefined,
          destination: kind === 'rider' ? text('destination') || undefined : undefined,
          morningTime: kind === 'rider' ? text('morningTime') || undefined : undefined,
          returnTime: kind === 'rider' ? text('returnTime') || undefined : undefined,
          riders: kind === 'rider' && text('riders') ? Number(text('riders')) : undefined,
          car: kind === 'driver' ? text('car') || undefined : undefined,
          note: text('note') || undefined,
          website: text('website') || undefined,
        }),
      });
      if (res.ok) {
        setSent(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      setError(
        res.status === 429
          ? 'أرسلت طلبات كثيرة من هذا الجهاز. حاول بعد ساعة.'
          : body.error?.code === 'AUTH_PHONE_INVALID'
            ? 'رقم الجوال غير صحيح. اكتبه بصيغة 05XXXXXXXX.'
            : 'تحقق من الحقول المطلوبة وحاول مرة أخرى.',
      );
    } catch {
      setError('تعذر الإرسال. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Site>
        <section className="join-done">
          <h1>وصل طلبك</h1>
          <p>
            نراجع الطلبات حسب الأحياء والمواعيد. إذا كان طلبك ضمن مناطق التجربة، يصلك على الواتساب رمز الدخول ورابط
            التطبيق.
          </p>
          <p className="hint">لا نطلب أي دفعة قبل أن نؤكد لك السائق والموعد.</p>
          <Link className="btn" href="/download">
            تعرّف على التطبيق
          </Link>
        </section>
      </Site>
    );
  }

  return (
    <Site wide>
      <section className="join-hero">
        <div className="join-hero-text">
          <p className="join-state">تجربة مفتوحة للتسجيل بعدد محدود</p>
          <h1>مشوار المدرسة والدوام، كل يوم مع نفس السائق</h1>
          <p>
            اشتراك شهري بتوصيل ذهاب وعودة في مواعيد ثابتة. تتابع السيارة على الخريطة لحظة بلحظة، ويصل أهلك رابط المتابعة
            دون تطبيق.
          </p>
          <a className="btn btn-sun" href="#apply">
            قدّم طلبك
          </a>
        </div>
        <div className="join-hero-art" aria-hidden="true">
          <RouteArt />
        </div>
      </section>

      <section className="join-steps" aria-labelledby="steps-title">
        <h2 id="steps-title">كيف تعمل التجربة</h2>
        <ol>
          <li>
            <strong>قدّم طلبك</strong>
            <span>الحي، والمدرسة أو مكان العمل، وأوقات الذهاب والعودة.</span>
          </li>
          <li>
            <strong>نؤكد لك السائق والموعد</strong>
            <span>إن كان طلبك ضمن مناطق التجربة، يصلك على الواتساب رمز الدخول ورابط التطبيق.</span>
          </li>
          <li>
            <strong>اشترك وابدأ</strong>
            <span>تدفع بالتحويل البنكي بعد التأكيد، وتبدأ الرحلات من اليوم التالي.</span>
          </li>
        </ol>
      </section>

      <section className="join-form-wrap" id="apply" aria-labelledby="apply-title">
        <h2 id="apply-title">طلب الانضمام</h2>
        <div className="segmented" role="radiogroup" aria-label="نوع الطلب">
          <button type="button" role="radio" aria-checked={kind === 'rider'} onClick={() => setKind('rider')}>
            أبحث عن توصيل
          </button>
          <button type="button" role="radio" aria-checked={kind === 'driver'} onClick={() => setKind('driver')}>
            أنا سائق
          </button>
        </div>

        <form className="join-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">{kind === 'rider' ? 'اسم ولي الأمر أو الموظف' : 'الاسم الكامل'}</label>
            <input id="name" name="name" className="input" required minLength={2} maxLength={120} autoComplete="name" />
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="phone">رقم الجوال (واتساب)</label>
              <input id="phone" name="phone" className="input num" type="tel" inputMode="tel" required placeholder="05XXXXXXXX" dir="ltr" autoComplete="tel" />
            </div>
            <div className="field">
              <label htmlFor="city">المدينة</label>
              <select id="city" name="city" className="select" defaultValue="الرياض">
                {CITIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="district">الحي</label>
            <input id="district" name="district" className="input" maxLength={80} required placeholder="مثال: الرمال" />
          </div>

          {kind === 'rider' ? (
            <>
              <div className="field">
                <label htmlFor="destination">المدرسة أو مكان العمل</label>
                <input id="destination" name="destination" className="input" maxLength={120} required placeholder="مثال: مدارس الرواد، فرع الرمال" />
              </div>
              <div className="row row-3">
                <div className="field">
                  <label htmlFor="morningTime">وقت الذهاب</label>
                  <input id="morningTime" name="morningTime" className="input num" type="time" defaultValue="06:30" />
                </div>
                <div className="field">
                  <label htmlFor="returnTime">وقت العودة</label>
                  <input id="returnTime" name="returnTime" className="input num" type="time" defaultValue="13:30" />
                </div>
                <div className="field">
                  <label htmlFor="riders">عدد الركاب</label>
                  <input id="riders" name="riders" className="input num" type="number" min={1} max={10} defaultValue={1} />
                </div>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="car">السيارة وسنة الصنع</label>
              <input id="car" name="car" className="input" maxLength={80} required placeholder="مثال: هيونداي ستاريا 2023" />
              <p className="hint">نقبل السيارات التي لم يمضِ على سنة صنعها أكثر من خمس سنوات، ويلزم ترخيص من هيئة النقل عبر شريك مرخص.</p>
            </div>
          )}

          <div className="field">
            <label htmlFor="note">ملاحظات (اختياري)</label>
            <textarea id="note" name="note" className="input" rows={3} maxLength={500} />
          </div>
          {/* Hidden from people; bots fill it and their request is dropped. */}
          <div className="visually-hidden" aria-hidden="true">
            <label htmlFor="website">اترك هذا الحقل فارغا</label>
            <input id="website" name="website" tabIndex={-1} autoComplete="off" />
          </div>
          <label className="check">
            <input type="checkbox" required />
            <span>
              أوافق على التواصل معي بالواتساب بخصوص الطلب، وعلى <Link href="/privacy">سياسة الخصوصية</Link>.
            </span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-lg" type="submit" disabled={busy}>
            {busy ? 'جار الإرسال…' : 'إرسال الطلب'}
          </button>
        </form>
      </section>

      <section className="join-safety" aria-labelledby="safety-title">
        <h2 id="safety-title">ما يطمئنك</h2>
        <ul>
          <li>
            <strong>سائق ثابت تعرفه</strong> وثائقه وسيارته مراجعة، وتأمينه ورخصته ساريان طوال الاشتراك.
          </li>
          <li>
            <strong>متابعة مباشرة</strong> للسيارة على الخريطة، مع رابط متابعة ترسله لأي فرد من العائلة.
          </li>
          <li>
            <strong>زر طوارئ</strong> يصل فريق التشغيل فورا مع الموقع، ويتصل بالرقم الموحد 911.
          </li>
          <li>
            <strong>تنبيه عند التأخير</strong> يصلك إذا تأخر السائق، ويتابعه فريق التشغيل في نفس اللحظة.
          </li>
        </ul>
      </section>
    </Site>
  );
}
