'use client';

import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/Providers';
import { RouteArt } from '@/components/RouteArt';
import { ApiError, postJson } from '@/lib/client';
import { fill } from '@/lib/i18n';

type Step = 'phone' | 'code';

function LoginForm() {
  const { t, switchLang } = useApp();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const describe = (err: unknown) =>
    err instanceof ApiError && err.message ? err.message : t.common.networkError;

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await postJson<{ resendAfter: number }>('/api/auth/request', { phone });
      setStep('code');
      setCode('');
      setResendIn(res.resendAfter);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await postJson('/api/auth/verify', { phone, code });
      const next = params.get('next');
      window.location.assign(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setError(describe(err));
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <aside className="login-art">
        <RouteArt />
        <span className="brand">{t.appName}</span>
        <p className="caption">{t.login.routeCaption}</p>
      </aside>

      <section className="login-main">
        <div className="login-top">
          <button type="button" className="btn btn-quiet" onClick={switchLang}>
            {t.common.language}
          </button>
        </div>

        {step === 'phone' ? (
          <form className="login-form" onSubmit={sendCode} noValidate>
            <h1>{t.login.title}</h1>
            <p>{t.login.intro}</p>
            <div className="field">
              <label htmlFor="phone">{t.login.phone}</label>
              <input
                id="phone"
                className="input num"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t.login.phonePlaceholder}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
              />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn" type="submit" disabled={busy || phone.trim().length < 9}>
              {t.login.sendCode}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={verify} noValidate>
            <h1>{t.login.code}</h1>
            <p>
              {t.login.codeSentTo} <span className="num">{phone}</span>
            </p>
            <div className="field">
              <label htmlFor="code" className="visually-hidden">
                {t.login.code}
              </label>
              <input
                id="code"
                ref={codeRef}
                className="input input-code num"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn" type="submit" disabled={busy || code.length < 4}>
              {t.login.verify}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
              <button
                type="button"
                className="btn btn-link"
                onClick={() => {
                  setStep('phone');
                  setError('');
                }}
              >
                {t.login.changeNumber}
              </button>
              {resendIn > 0 ? (
                <span className="hint" style={{ color: 'var(--ink-faint)' }}>
                  {fill(t.login.resendIn, { s: resendIn })}
                </span>
              ) : (
                <button type="button" className="btn btn-link" onClick={() => sendCode()} disabled={busy}>
                  {t.login.resend}
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
