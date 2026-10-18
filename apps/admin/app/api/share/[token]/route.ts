import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/session';

/** Public: forwards a shared-trip token to the API. No session involved. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return NextResponse.json({ error: { code: 'SHARE_NOT_FOUND' } }, { status: 404 });
  }
  try {
    const res = await fetch(`${API_URL}/v1/shared/${token}`, {
      headers: { 'Accept-Language': req.headers.get('accept-language')?.startsWith('en') ? 'en' : 'ar' },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: { code: 'NETWORK' } }, { status: 502 });
  }
}
