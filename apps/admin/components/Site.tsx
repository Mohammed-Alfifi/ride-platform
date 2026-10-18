import Link from 'next/link';
import { ReactNode } from 'react';

/** The brand mark: a route from home (ring) to the destination (sun). Same drawing as the apps. */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 76 76" aria-hidden="true">
      <rect width="76" height="76" rx="20" fill="#22344B" />
      <path d="M18 50 C 30 50, 30 26, 44 26 S 58 30, 58 30" fill="none" stroke="#3FBF8F" strokeWidth="5" strokeLinecap="round" />
      <circle cx="18" cy="50" r="6.5" fill="#22344B" stroke="#3FBF8F" strokeWidth="4" />
      <circle cx="58" cy="30" r="8" fill="#F2B33D" />
    </svg>
  );
}

/** Public pages (join, download, terms...): Arabic, no session. */
export function Site({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="site" lang="ar" dir="rtl">
      {/* React hoists this into <head>; the display face is only used on the public pages. */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@500;600;700&display=swap" precedence="default" />
      <header className="site-head">
        <Link href="/join" className="site-brand">
          <Mark />
          <span>مشوار</span>
        </Link>
        <nav aria-label="روابط الموقع">
          <Link href="/join">الانضمام</Link>
          <Link href="/download">تحميل التطبيق</Link>
        </nav>
      </header>
      <main className={wide ? 'site-main site-wide' : 'site-main'}>{children}</main>
      <footer className="site-foot">
        <nav aria-label="الشروط والخصوصية">
          <Link href="/terms">الشروط والأحكام</Link>
          <Link href="/privacy">سياسة الخصوصية</Link>
          <Link href="/delete-account">حذف الحساب</Link>
        </nav>
        <p>مشوار: توصيل يومي باشتراك شهري، بسائق ثابت ومواعيد ثابتة.</p>
      </footer>
    </div>
  );
}

/** A long-form page (terms, privacy): headings and paragraphs at a readable measure. */
export function Doc({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <Site>
      <article className="doc">
        <h1>{title}</h1>
        <p className="doc-updated">آخر تحديث: {updated}</p>
        {children}
      </article>
    </Site>
  );
}
