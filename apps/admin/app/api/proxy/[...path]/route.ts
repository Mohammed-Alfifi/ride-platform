import { NextRequest, NextResponse } from 'next/server';
import { LANG_COOKIE, parseLang } from '@/lib/i18n';
import {
  callApi,
  clearSession,
  networkErrorResponse,
  readSessionCookies,
  setSession,
  TokenPair,
} from '@/lib/session';

/**
 * Forwards /api/proxy/<path> to the API's /v1/<path> with the session's access token.
 * When the access token has expired it refreshes once, retries, and stores the new pair.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const lang = parseLang(req.cookies.get(LANG_COOKIE)?.value);
  const { path } = await ctx.params;
  if (path.some((p) => p === '..' || p.includes('/'))) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
  }
  const target = `/v1/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  let { access, refresh } = await readSessionCookies();
  let renewed: TokenPair | undefined;

  const send = (token?: string) =>
    callApi(target, {
      method: req.method,
      lang,
      body,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  try {
    if (!access && refresh) {
      renewed = await tryRefresh(refresh);
      access = renewed?.accessToken;
    }
    let res = await send(access);

    if (res.status === 401 && refresh && !renewed) {
      renewed = await tryRefresh(refresh);
      if (renewed) {
        refresh = renewed.refreshToken;
        res = await send(renewed.accessToken);
      }
    }

    // Pass bodies through as bytes so document files (images, PDFs) arrive intact.
    const body = res.status === 204 ? null : await res.arrayBuffer();
    const headers = new Headers({ 'Content-Type': res.headers.get('content-type') ?? 'application/json' });
    for (const name of ['content-disposition', 'cache-control', 'retry-after']) {
      const value = res.headers.get(name);
      if (value) headers.set(name, value);
    }
    const out = new NextResponse(body && body.byteLength > 0 ? body : null, { status: res.status, headers });
    if (res.status === 401) clearSession(out);
    else if (renewed) setSession(out, renewed);
    return out;
  } catch {
    return networkErrorResponse(lang);
  }
}

async function tryRefresh(refreshToken: string): Promise<TokenPair | undefined> {
  const res = await callApi('/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
  return res.ok ? ((await res.json()) as TokenPair) : undefined;
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
