import { NextResponse } from 'next/server';
import { verifySessionToken } from './lib/session';

// Pages that require login (redirect to /login.html if not authenticated).
const PROTECTED_PAGE_PREFIXES = ['/campaign', '/dashboard'];

// APIs that require login (return 401 JSON if not authenticated). Deliberately
// does NOT include /api/create or /[code] -- those stay public since they're
// meant to be called by your own external automation/scripts and by anyone
// clicking a WhatsApp link, not just logged-in browser sessions.
const PROTECTED_API_PATHS = [
  '/api/create-campaign',
  '/api/list-campaigns',
  '/api/campaign-details',
  '/api/campaign-link',
  '/api/upload-media',
  '/api/click-summary',
  '/api/links',
  '/api/link-clicks',
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
