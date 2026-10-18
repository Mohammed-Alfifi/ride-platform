import { NextRequest, NextResponse } from 'next/server';
import { LANG_COOKIE, parseLang } from '@/lib/i18n';
import { callApi, clientIp, networkErrorResponse } from '@/lib/session';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const lang = parseLang(req.cookies.get(LANG_COOKIE)?.value);
  const { phone } = (await req.json().catch(() => ({}))) as { phone?: string };
  try {
    const res = await callApi('/v1/auth/otp/request', {
      method: 'POST',
      lang,
      ip: clientIp(req),
      body: JSON.stringify({ phone: phone ?? '', app: 'admin' }),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return networkErrorResponse(lang);
  }
}
