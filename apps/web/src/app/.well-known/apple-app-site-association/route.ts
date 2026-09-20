import { runtimeConfig } from '@/core/runtime/config';
import { appleAssociation } from '@/core/runtime/mobile-association';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(appleAssociation(runtimeConfig().environment), { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
