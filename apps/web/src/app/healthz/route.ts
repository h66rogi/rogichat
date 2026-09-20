import { runtimeConfig } from '@/core/runtime/config';
export const dynamic = 'force-dynamic';
export function GET() {
  runtimeConfig();
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
