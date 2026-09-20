import type { NextRequest } from 'next/server';
import { reasonFromLegacyFailureQuery } from '@/features/auth/login-reason';
export const dynamic = 'force-dynamic';
/** Relative redirect: never trust Host and never propagate provider code/state. */
export function GET(request: NextRequest) {
  const reason = reasonFromLegacyFailureQuery(request.nextUrl.searchParams);
  return new Response(null, { status: 303, headers: { Location: `/login?reason=${reason}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
