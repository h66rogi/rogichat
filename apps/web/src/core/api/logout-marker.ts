export const LOGOUT_PENDING = 'rogichat.logout-pending';
export interface MarkerStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export function beginLogout(storage: MarkerStorage, binding: string, nonce: string): string {
  const marker = `v1:${binding}:${nonce}`;
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
