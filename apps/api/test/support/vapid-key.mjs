import assert from 'node:assert/strict';

// Test-only P-256 scalar serialization. OpenSSL may omit leading zero bytes;
// VAPID configuration requires the canonical fixed-width 32-byte encoding.
export function vapidPrivateKey(key) {
  const scalar = key.getPrivateKey();
  assert.ok(Buffer.isBuffer(scalar) && scalar.length > 0 && scalar.length <= 32);
  const fixed = Buffer.alloc(32);
  scalar.copy(fixed, 32 - scalar.length);
  return fixed.toString('base64url');
}
