'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { dictionaries, Dict, Lang, LANG_COOKIE } from '@/lib/i18n';
import type { Profile } from '@/lib/client';

interface AppContextValue {
  lang: Lang;
  t: Dict;
  switchLang: () => void;
  profile: Profile | null;
  notify: (message: string, tone?: 'ok' | 'error') => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <Providers>');
  return ctx;
}

export function Providers({
  lang,
  profile,
  children,
}: {
  lang: Lang;
  profile: Profile | null;
  children: ReactNode;
}) {
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const switchLang = useCallback(() => {
    const next: Lang = lang === 'ar' ? 'en' : 'ar';
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }, [lang]);

  const notify = useCallback((message: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ message, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <AppContext.Provider value={{ lang, t: dictionaries[lang], switchLang, profile, notify }}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className={`toast toast-${toast.tone}`}>{toast.message}</div>}
      </div>
    </AppContext.Provider>
  );
}
