import { runtimeConfig } from '@/core/runtime/config';
import { androidAssociation } from '@/core/runtime/mobile-association';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(androidAssociation(runtimeConfig().environment), { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
