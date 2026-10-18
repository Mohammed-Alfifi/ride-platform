import type { Metadata } from 'next';
import Link from 'next/link';
import { Site } from '@/components/Site';
import { DeviceHint } from './DeviceHint';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'تحميل تطبيق مشوار' };

/**
 * Where invited people get the apps. Android builds come from the project's GitHub releases;
 * iPhone users open the rider app in Safari (no App Store needed during the pilot).
 */
export default function DownloadPage() {
  const base = (process.env.DOWNLOAD_BASE_URL ?? 'https://github.com/Mohammed-Alfifi/ride-platform/releases/latest/download').replace(/\/$/, '');
  const web = process.env.RIDER_WEB_URL ?? '';
  return (
    <Site>
      <section className="download">
        <h1>تحميل تطبيق مشوار</h1>
        <p className="lede">
          التطبيق متاح خلال التجربة لمن وصلته دعوة. ستحتاج رقم جوالك ورمز الدخول المكون من 8 أرقام الذي وصلك بالواتساب.
        </p>
        <DeviceHint />

        <div className="download-grid">
          <article className="download-card" id="rider">
            <h2>تطبيق الراكب</h2>
            <p>للأسر والموظفين: الاشتراك، ومتابعة السيارة، ورابط المتابعة للأهل، والفواتير.</p>
            <a className="btn" href={`${base}/mishwar-rider.apk`}>
              تحميل لأندرويد
            </a>
            {web && (
              <a className="btn btn-quiet" href={web}>
                فتح نسخة الآيفون والمتصفح
              </a>
            )}
          </article>
          <article className="download-card" id="driver">
            <h2>تطبيق السائق</h2>
            <p>للسائقين المدعوين: رحلات اليوم، والملاحة، وإرسال الموقع أثناء الرحلة. يعمل على أندرويد.</p>
            <a className="btn" href={`${base}/mishwar-driver.apk`}>
              تحميل لأندرويد
            </a>
          </article>
        </div>

        <h2 className="download-sub">التثبيت على أندرويد</h2>
        <ol className="download-steps">
          <li>اضغط «تحميل لأندرويد» وانتظر اكتمال التنزيل.</li>
          <li>افتح الملف من الإشعار أو من مجلد التنزيلات.</li>
          <li>إذا ظهرت رسالة «تثبيت تطبيقات غير معروفة»، اسمح للمتصفح بالتثبيت ثم ارجع واضغط «تثبيت».</li>
          <li>افتح «مشوار»، واكتب رقم جوالك ثم رمز الدخول.</li>
        </ol>
        {web && (
          <>
            <h2 className="download-sub">على الآيفون</h2>
            <ol className="download-steps">
              <li>افتح الرابط في Safari.</li>
              <li>اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية» ليظهر كتطبيق.</li>
              <li>افتح «مشوار» من الشاشة الرئيسية، واكتب رقم جوالك ثم رمز الدخول.</li>
            </ol>
          </>
        )}
        <p className="hint">
          لم تصلك دعوة بعد؟ <Link href="/join">قدّم طلب الانضمام</Link>.
        </p>
      </section>
    </Site>
  );
}
