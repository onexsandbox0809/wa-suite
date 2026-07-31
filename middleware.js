import { NextResponse } from 'next/server';
import { verifySessionToken } from './lib/session';

// Pages that require login (redirect to /login.html if not authenticated).
const PROTECTED_PAGE_PREFIXES = ['/campaign', '/dashboard'];

// APIs that require login (return 401 JSON if not authenticated). Deliberately
// does NOT include /api/create, /api/campaign-details, or /api/campaign-link --
// those are meant to be called by your own external automation/bot per
// end-user interaction, not just logged-in browser sessions. /[code] link
// redirects stay public too, for the same reason.
const PROTECTED_API_PATHS = [
  '/api/create-campaign',
  '/api/list-campaigns',
  '/api/upload-media',
  '/api/click-summary',
  '/api/links',
  '/api/link-clicks',
  '/api/button-vs-url',
  '/api/button-vs-url-detail',
];

function isProtectedApi(pathname) {
  return PROTECTED_API_PATHS.includes(pathname) || pathname.startsWith('/api/export/');
}

function isProtectedPage(pathname) {
  return PROTECTED_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Auth endpoints themselves must stay reachable, or nobody could ever log in.
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith('/api/');
  if (isApi && !isProtectedApi(pathname)) return NextResponse.next();
  if (!isApi && !isProtectedPage(pathname)) return NextResponse.next();

  const token = request.cookies.get('wa_session')?.value;
  const secret = process.env.SESSION_SECRET;
  const session = secret ? await verifySessionToken(token, secret) : null;

  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: 'Unauthorized — please log in' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login.html', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/campaign/:path*', '/dashboard/:path*', '/api/:path*'],
};