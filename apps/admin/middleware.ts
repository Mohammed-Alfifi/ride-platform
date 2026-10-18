import { NextRequest, NextResponse } from 'next/server';

/** Sends visitors without a session to /login, and signed-in users away from it. */
export function middleware(req: NextRequest): NextResponse {
  const hasSession = Boolean(req.cookies.get('rp_rt')?.value);
  const { pathname } = req.nextUrl;
  if (pathname === '/login') {
    return hasSession ? NextResponse.redirect(new URL('/', req.url)) : NextResponse.next();
  }
  if (!hasSession) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // /t/<token> is the public page a family member opens from a shared trip link.
  matcher: ['/((?!api|t/|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
