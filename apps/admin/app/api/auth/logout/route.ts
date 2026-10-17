import { NextResponse } from 'next/server';
import { callApi, clearSession, readSessionCookies } from '@/lib/session';

export async function POST(): Promise<NextResponse> {
  const { refresh } = await readSessionCookies();
  if (refresh) {
    await callApi('/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: refresh }),
    }).catch(() => undefined);
  }
  const res = new NextResponse(null, { status: 204 });
  clearSession(res);
  return res;
}
