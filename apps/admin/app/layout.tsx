import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import type { Profile } from '@/lib/client';
import { LANG_COOKIE, parseLang } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'لوحة التشغيل',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  let profile: Profile | null = null;
  const raw = jar.get('rp_me')?.value;
  if (raw) {
    try {
      profile = JSON.parse(decodeURIComponent(raw)) as Profile;
    } catch {
      profile = null;
    }
  }

  return (
    <html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <Providers lang={lang} profile={profile}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
