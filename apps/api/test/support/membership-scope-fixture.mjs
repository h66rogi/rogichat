import { membershipScope } from '../../dist/modules/membership-scope/membership-scope.js';

// Test-only minting for a NEW intent. Never call this to rebind a retained pending intent.
export async function newIntentScope(tx, key, audience, userId, roomId) {
  const [member] = await tx.rows('SELECT active_period_id FROM room_members WHERE room_id=? AND user_id=?', [roomId, userId]);
  return membershipScope(key, audience, userId, roomId, member?.active_period_id ?? 'absent');
}
export async function scopeNewHttpIntent(db, config, userId, method, path, body) {
  const match = /\/rooms\/([a-f0-9-]{36})\/messages$/.exec(path);
  if (method === 'POST' && match && body && body.membershipScope === undefined) {
    body.membershipScope = await db.transactions.read(tx => newIntentScope(tx, config.key, config.audience, userId, match[1]));
  }
}
