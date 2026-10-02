import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, isValidSessionToken } from '@/lib/session';

/**
 * Simple password gate (see `app/login/`). Every request needs a valid
 * `fl_session` cookie or gets bounced to `/login`.
 *
 * Excluded on purpose (see the matcher below), and nothing sensitive lives in
 * any of them:
 *   - `/login`            the gate itself — would otherwise redirect-loop
 *   - `/api/cron`         has its own `CRON_SECRET` bearer check; Vercel
 *                         Cron doesn't carry this cookie
 *   - `/api/v1/*`         the REST API (API.md). Every route handler checks
 *                         `Authorization: Bearer <API_KEY>` itself via
 *                         `withApi` → lib/api/auth.ts, and answers 401 JSON
 *                         rather than a redirect to an HTML login page
 *   - `/_next/*`          Next.js build assets
 *   - PWA install surface: manifest, icons, favicon, service worker, offline
 *     fallback — a browser fetches these before a user ever sees a page
 */
export const config = {
  matcher: [
    '/((?!api/cron|api/v1/|login|_next/static|_next/image|manifest\\.webmanifest|icons/|favicon\\.ico|sw\\.js|offline\\.html).*)',
  ],
};

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const password = process.env.APP_PASSWORD;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = password ? await isValidSessionToken(token, password) : false;

  if (authenticated) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}
