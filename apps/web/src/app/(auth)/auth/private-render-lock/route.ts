import { NextResponse, type NextRequest } from 'next/server';
import { runtimeConfig } from '@/core/runtime/config';
import { RENDER_LOCK_COOKIE } from '@/core/server/private-bootstrap';

export const dynamic = 'force-dynamic';

function change(request: NextRequest, locked: boolean) {
  const expected = runtimeConfig().environment === 'qa' ? 'https://qa.rogi.chat' : 'https://rogi.chat';
  if (request.headers.get('origin') !== expected || request.headers.get('host') !== new URL(expected).hostname) return new Response(null, { status: 403 });
  const response = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(RENDER_LOCK_COOKIE, locked ? '1' : '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', ...(locked ? { maxAge: 7 * 86400 } : { maxAge: 0 }) });
  return response;
}
export const POST = (request: NextRequest) => change(request, true);
export const DELETE = (request: NextRequest) => change(request, false);
