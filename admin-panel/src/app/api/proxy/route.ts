import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8085';
const CSRF_HEADER  = 'x-admin-requested-with';
const CSRF_VALUE   = 'XMLHttpRequest';

const ALLOWED_PATH_PATTERN = /^\/v1\/admin\/(auth|analytics|products|categories|boxes|transactions|coupons|players)(\/[\w\-]*)*(\/items(\/[\w\-]*)?)?$/;
const SAFE_METHODS         = ['GET', 'POST', 'PUT', 'DELETE'] as const;
type SafeMethod = typeof SAFE_METHODS[number];

export async function GET(req: NextRequest)    { return forward(req, 'GET'); }
export async function POST(req: NextRequest)   { return forward(req, 'POST'); }
export async function PUT(req: NextRequest)    { return forward(req, 'PUT'); }
export async function DELETE(req: NextRequest) { return forward(req, 'DELETE'); }

async function forward(req: NextRequest, method: SafeMethod): Promise<NextResponse> {
  const rawPath = req.nextUrl.searchParams.get('path') ?? '';
  if (method !== 'GET' && (req.headers.get(CSRF_HEADER) !== CSRF_VALUE || req.headers.get('origin') !== req.nextUrl.origin)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Split path from embedded query string (api.ts can embed ?foo=bar in the path param)
  const [pathOnly, embeddedQuery] = rawPath.split('?', 2);

  // Strict path-only validation — prevent SSRF
  if (!ALLOWED_PATH_PATTERN.test(pathOnly)) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }

  // Forward auth cookie to external-api
  const cookieStore = await cookies();
  const accessCookie  = cookieStore.get('admin_access');
  const refreshCookie = cookieStore.get('admin_refresh');

  const cookieHeader = [
    accessCookie  ? `admin_access=${accessCookie.value}`   : '',
    refreshCookie ? `admin_refresh=${refreshCookie.value}` : '',
  ].filter(Boolean).join('; ');

  const isMutation = method !== 'GET';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(isMutation   ? { [CSRF_HEADER]: CSRF_VALUE } : {}),
  };

  let body: string | undefined;
  if (isMutation) {
    try { body = await req.text(); } catch { body = undefined; }
  }

  // Build upstream URL from pathOnly, then merge embedded + proxy-level query params
  const url = new URL(pathOnly, API_BASE_URL);

  // 1. Apply embedded query string from the path param (e.g. ?from=...&to=...)
  if (embeddedQuery) {
    new URLSearchParams(embeddedQuery).forEach((v, k) => url.searchParams.set(k, v));
  }
  // 2. Forward any additional query params passed directly on the proxy request
  req.nextUrl.searchParams.forEach((v, k) => {
    if (k !== 'path') url.searchParams.set(k, v);
  });

  try {
    const upstream = await fetch(url.toString(), { method, headers, body, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });

    // Forward Set-Cookie headers from upstream (for token refresh)
    const response = NextResponse.json(await upstream.json().catch(() => ({})), { status: upstream.status });
    response.headers.set('Cache-Control', 'no-store');
    const setCookies = upstream.headers.getSetCookie();
    setCookies.forEach(c => response.headers.append('Set-Cookie', c));
    return response;
  } catch {
    return NextResponse.json({ error: 'upstream_error' }, { status: 502 });
  }
}
