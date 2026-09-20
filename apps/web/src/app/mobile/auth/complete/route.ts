import { runtimeConfig } from '@/core/runtime/config';
import { mobileFallbackResponse } from '@/core/runtime/mobile-fallback';
export const dynamic = 'force-dynamic';
export function GET() {
  runtimeConfig();
  return mobileFallbackResponse();
}
