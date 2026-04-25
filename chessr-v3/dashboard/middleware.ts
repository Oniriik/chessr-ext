/**
 * Auth gate for /queues/board/* (the embedded Bull Board UI).
 *
 * The catch: Supabase stores its session in localStorage, NOT cookies, so
 * a server-side cookie check sees nothing. To compensate, the parent
 * dashboard page (/queues) writes the access token into a cookie before
 * sending the user to /queues/board. This middleware then validates it.
 *
 * If no cookie is present, the user is redirected to /login.
 */

import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/queues/board')) return NextResponse.next();

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/queues/board/:path*'],
};
