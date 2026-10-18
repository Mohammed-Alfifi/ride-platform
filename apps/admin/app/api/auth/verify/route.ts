import { NextRequest, NextResponse } from 'next/server';
import { LANG_COOKIE, parseLang } from '@/lib/i18n';
import { callApi, clientIp, networkErrorResponse, setSession } from '@/lib/session';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const lang = parseLang(req.cookies.get(LANG_COOKIE)?.value);
  const { phone, code } = (await req.json().catch(() => ({}))) as { phone?: string; code?: string };
  try {
    const res = await callApi('/v1/auth/otp/verify', {
      method: 'POST',
      lang,
      ip: clientIp(req),
      headers: { 'User-Agent': req.headers.get('user-agent') ?? 'admin-dashboard' },
      body: JSON.stringify({ phone: phone ?? '', code: code ?? '', app: 'admin' }),
    });
    const body = await res.json();
    if (!res.ok) return NextResponse.json(body, { status: res.status });

    const out = NextResponse.json({ user: body.user });
    setSession(out, body, {
      id: body.user.id,
      name: body.user.name,
      role: body.user.role,
      partnerId: body.user.partnerId,
    });
    if (body.user.locale && !req.cookies.get(LANG_COOKIE)) {
      out.cookies.set(LANG_COOKIE, body.user.locale, { path: '/', maxAge: 31_536_000, sameSite: 'lax' });
    }
    return out;
  } catch {
    return networkErrorResponse(lang);
  }
}
