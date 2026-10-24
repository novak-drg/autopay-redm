import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET ?? ''
);

const PUBLIC_PATHS = ['/login'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('admin_access')?.value;

  if (!token) {
    return redirectToLogin(request);
  }

  try {
    await jwtVerify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return NextResponse.next();
  } catch {
    const response = redirectToLogin(request);
    response.cookies.delete('admin_access');
    return response;
  }
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Exclude: Next.js internals, static files, and ALL /api/ routes.
  // API routes (/api/proxy) must bypass the middleware so unauthenticated
  // requests (e.g. login) can reach the external-api without a cookie.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
