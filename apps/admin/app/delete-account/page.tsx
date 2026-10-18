import type { Metadata } from 'next';
import { Contact } from '@/components/Contact';
import { Doc } from '@/components/Site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'حذف الحساب - مشوار' };

/** How to delete an account (Google Play asks for a public page like this). */
export default function DeleteAccountPage() {
  return (
    <Doc title="حذف الحساب" updated="أكتوبر 2026">
      <h2>من التطبيق</h2>
      <ol>
        <li>افتح «مشوار» واضغط صورة الحساب أعلى الشاشة.</li>
        <li>اختر «حذف الحساب» ثم أكد.</li>
      </ol>
      <p>
        للراكب: ألغِ الاشتراكات الجارية أولا. للسائق: يمكن الحذف بعد انتهاء رحلات اليوم، ويُبلَّغ شريك النقل ليعين سائقا
        بديلا لركابك.
      </p>

      <h2>ما يُحذف وما يبقى</h2>
      <ul>
        <li>يُحذف فورا: الاسم، وأفراد العائلة، وإشعارات الجوال، وتسجيل الدخول من كل الأجهزة.</li>
        <li>يُحذف خلال 30 يوما: مسارات الرحلات.</li>
        <li>يبقى للمدة النظامية: الفواتير والمدفوعات، مرتبطة برقم الجوال فقط، لأن نظام الضريبة يوجب حفظها.</li>
      </ul>

      <h2>دون التطبيق</h2>
      <p>راسلنا من رقم الجوال المسجل وسنحذف الحساب خلال 7 أيام.</p>
      <Contact />
    </Doc>
  );
}
