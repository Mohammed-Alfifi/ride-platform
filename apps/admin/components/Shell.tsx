'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { useApp } from './Providers';

export function Shell({ children }: { children: ReactNode }) {
  const { t, profile, switchLang } = useApp();
  const pathname = usePathname();

  const items = [
    { href: '/', label: t.nav.overview },
    { href: '/dispatch', label: t.nav.dispatch },
    { href: '/drivers', label: t.nav.drivers },
    { href: '/zones', label: t.nav.zones },
    { href: '/plans', label: t.nav.plans },
    { href: '/subscriptions', label: t.nav.subscriptions },
    { href: '/payments', label: t.nav.payments },
    { href: '/reports', label: t.nav.reports },
    { href: '/support', label: t.nav.support },
    { href: '/promos', label: t.nav.promos },
    { href: '/compliance', label: t.nav.compliance },
    { href: '/partners', label: t.nav.partners },
    { href: '/users', label: t.nav.users },
  ].filter((i) => !(['/payments', '/reports', '/promos'].includes(i.href) && profile?.role === 'dispatcher'));

  // On phones the menu is one scrolling row; bring the current page into view.
  useEffect(() => {
    document.querySelector('.nav a[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label={t.appName}>
        <div className="brand">{t.appName}</div>
        <ul className="nav">
          {items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="sidebar-foot">
          {profile && (
            <>
              <span className="who">{profile.name ?? '—'}</span>
              <span className="role">{t.roles[profile.role]}</span>
            </>
          )}
          <button type="button" className="btn btn-link" onClick={switchLang}>
            {t.common.language}
          </button>
          <button type="button" className="btn btn-link" onClick={signOut}>
            {t.nav.signOut}
          </button>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
