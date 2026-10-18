import { NextRequest, NextResponse } from 'next/server';
import { callApi, clientIp, networkErrorResponse } from '@/lib/session';

/** Public: forwards the join form to the API with the visitor's address (rate limits are per address). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  if (body.length > 4000) return NextResponse.json({ error: { code: 'VALIDATION_FAILED' } }, { status: 413 });
  try {
    const res = await callApi('/v1/join', { method: 'POST', lang: 'ar', body, ip: clientIp(req) });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  } catch {
    return networkErrorResponse('ar');
  }
}
