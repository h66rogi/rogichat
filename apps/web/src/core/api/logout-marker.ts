export const LOGOUT_PENDING = 'rogichat.logout-pending';
export interface MarkerStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export function beginLogout(storage: MarkerStorage, binding: string, nonce: string, cleanup?: { environment: string; sessionKey: string }): string {
  if (cleanup && (!['qa', 'production'].includes(cleanup.environment) || !/^[a-f0-9]{64}$/.test(cleanup.sessionKey))) throw new Error('INVALID_CLEANUP_BINDING');
  const marker = `v1:${binding}:${nonce}${cleanup ? `:${cleanup.environment}:${cleanup.sessionKey}` : ''}`;
  storage.setItem(LOGOUT_PENDING, marker);
  return marker;
}
export function markerMatchesBinding(marker: string | null, binding: string): boolean {
  return marker !== null && marker.startsWith(`v1:${binding}:`);
}
export function clearLogout(storage: MarkerStorage, expected: string): boolean {
  if (storage.getItem(LOGOUT_PENDING) !== expected) return false;
  storage.removeItem(LOGOUT_PENDING);
  return true;
}

export function logoutCleanup(marker: string): { environment: string; sessionKey: string } | null {
  const parts = marker.split(':');
  if (parts.length === 3) return null; // Legacy markers predate durable commands.
  if (parts.length !== 5 || parts[0] !== 'v1' || !['qa', 'production'].includes(parts[3]!) || !/^[a-f0-9]{64}$/.test(parts[4]!)) throw new Error('INVALID_LOGOUT_MARKER');
  return { environment: parts[3]!, sessionKey: parts[4]! };
}
