import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * The browser never sees tokens. The dashboard's server keeps them in httpOnly cookies
 * and forwards requests to the API (a "backend for frontend").
 */
export const ACCESS_COOKIE = 'rp_at';
export const REFRESH_COOKIE = 'rp_rt';
export const PROFILE_COOKIE = 'rp_me';

export const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SECURE = process.env.COOKIE_SECURE === 'true';

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface Profile {
  id: string;
  name: string | null;
  role: string;
  partnerId: string | null;
}

export function setSession(res: NextResponse, tokens: TokenPair, profile?: Profile): void {
  const base = { httpOnly: true, secure: SECURE, sameSite: 'strict' as const, path: '/' };
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: tokens.accessTokenExpiresIn - 15 });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    expires: new Date(tokens.refreshTokenExpiresAt),
  });
  if (profile) {
    // Not secret: lets the UI render the user's name and role without a round trip.
    res.cookies.set(PROFILE_COOKIE, encodeURIComponent(JSON.stringify(profile)), {
      ...base,
      httpOnly: false,
      expires: new Date(tokens.refreshTokenExpiresAt),
    });
  }
}

export function clearSession(res: NextResponse): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, PROFILE_COOKIE]) {
    res.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
}

export async function readSessionCookies(): Promise<{ access?: string; refresh?: string }> {
  const jar = await cookies();
  return { access: jar.get(ACCESS_COOKIE)?.value, refresh: jar.get(REFRESH_COOKIE)?.value };
}

/**
 * The visitor's address as the proxies in front of this server reported it. Entries added by
 * the browser itself come first and are ignored.
 */
export function clientIp(req: Request): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',').map((x) => x.trim()).filter(Boolean) ?? [];
  // Behind Caddy the visitor is the last entry; behind Render's edge (TRUST_PROXY_HOPS=2) the one before it.
  const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS ?? 1) || 1);
  const ip = forwarded[Math.max(0, forwarded.length - hops)] || req.headers.get('x-real-ip')?.trim();
  return ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : undefined;
}

export async function callApi(path: string, init: RequestInit & { lang?: string; ip?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.lang) headers.set('Accept-Language', init.lang);
  // The API trusts one proxy hop (this server), so rate limits apply per visitor, not to the dashboard as a whole.
  if (init.ip) headers.set('X-Forwarded-For', init.ip);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
}

export function networkErrorResponse(lang: string): NextResponse {
  const message =
    lang === 'en'
      ? 'Could not reach the server. Check your connection and try again.'
      : 'تعذر الاتصال بالخادم. تحقق من الاتصال وحاول مرة أخرى.';
  return NextResponse.json({ error: { code: 'NETWORK', message } }, { status: 502 });
}
