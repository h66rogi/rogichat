import { NextResponse, type NextRequest } from 'next/server';

import { reasonFromLegacyFailureQuery } from '@/features/auth/login-reason';

export const dynamic = 'force-dynamic';

/**
 * Compatibility route for the current server's failure callback (`/auth/login`).
 * It forwards to `/login` with an enumerated reason only. The incoming query string is never copied.
 */
export function GET(request: NextRequest) {
  const reason = reasonFromLegacyFailureQuery(request.nextUrl.searchParams);
  const target = new URL('/login', request.nextUrl.origin);
  target.searchParams.set('reason', reason);
  return NextResponse.redirect(target, { status: 303, headers: { 'Cache-Control': 'no-store' } });
}
