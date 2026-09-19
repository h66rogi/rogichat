import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2';
import type { AuthConfig } from './auth-config.js';
import { ApiError, digest, opaque, resolveSoop, secret, equalDigest } from './auth-core.js';
import type { Sessions, VerifiedIdentity } from './auth-core.js';

export interface Broker {
  request(input: { transactionId: string; state: string; challenge: string }): Promise<string>;
  exchange(input: { transactionId: string; code: string; verifier: string }): Promise<VerifiedIdentity>;
}
interface LoginRow extends RowDataPacket {
  id: string; browser_digest: Buffer; verifier: Buffer; intent: string; terms_version: string | null; user_id: string | null; session_id: string | null;
}
function encrypt(value: string, key: Buffer): Buffer {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
function decrypt(value: Buffer, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
}

export class AuthFlow {
  constructor(readonly sessions: Sessions, readonly config: AuthConfig, private readonly broker: Broker) {}
  async start(intent: 'login' | 'link', browser: string, token?: string, csrf?: string): Promise<{ url: string; state: string }> {
    opaque(browser);
    const id = randomUUID(); const state = secret(); const verifier = secret();
    await this.sessions.transactions.write(async tx => {
      const principal = intent === 'link' ? await this.sessions.require(tx, token, csrf ?? '') : undefined;
      if (principal) {
        const [recent] = await tx.rows('SELECT id FROM auth_sessions WHERE id=? AND created_at>TIMESTAMPADD(MINUTE,-15,UTC_TIMESTAMP(3))', [principal.sessionId]);
        if (!recent) throw new ApiError('FORBIDDEN', 403);
      }
      await tx.execute('INSERT INTO login_transactions (id,state_digest,browser_digest,verifier,intent,terms_version,audience,user_id,session_id,expires_at) VALUES (?,?,?,?,?,?,?,?,?,TIMESTAMPADD(MINUTE,10,UTC_TIMESTAMP(3)))',
        [id, digest(state), digest(browser), encrypt(verifier, this.config.key), intent, intent === 'login' ? '2026-09-20' : null, this.config.audience, principal?.userId ?? null, principal?.sessionId ?? null]);
    });
    try {
      return { url: await this.broker.request({ transactionId: id, state, challenge: createHash('sha256').update(verifier).digest('base64url') }), state };
    } catch {
      await this.fail(id);
      throw new ApiError('AUTH_UNAVAILABLE', 503);
    }
  }
  async callback(state: string, code: string, browser: string, token?: string): Promise<{ token: string; csrf: string }> {
    opaque(state); opaque(code); opaque(browser);
    const claim = await this.sessions.transactions.write(async tx => {
      const [row] = await tx.rows<LoginRow>('SELECT id,browser_digest,verifier,intent,terms_version,user_id,session_id FROM login_transactions WHERE state_digest=? AND audience=? AND status=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE', [digest(state), this.config.audience, 'PENDING']);
      if (!row || !equalDigest(browser, row.browser_digest)) throw new ApiError('AUTH_FAILED', 400);
      if (row.intent === 'link') {
        const principal = await this.sessions.require(tx, token);
        if (principal.userId !== row.user_id || principal.sessionId !== row.session_id) throw new ApiError('AUTH_FAILED', 400);
      }
      await tx.execute('UPDATE login_transactions SET status=? WHERE id=?', ['PROCESSING', row.id]);
      return row;
    });
    try {
      const identity = await this.broker.exchange({ transactionId: claim.id, code, verifier: decrypt(claim.verifier, this.config.key) });
      if (identity.schemaVersion !== 1 || identity.provider !== 'soop' || identity.transactionId !== claim.id || identity.clientId !== this.config.broker?.clientId || !Number.isFinite(Date.parse(identity.authenticatedAt)) || Math.abs(Date.now() - Date.parse(identity.authenticatedAt)) > 180000) throw new ApiError('AUTH_FAILED', 400);
      // A concurrent first login can race on unique subject; retry just this final DB transaction.
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.sessions.transactions.write(async tx => {
            const [active] = await tx.rows('SELECT id FROM login_transactions WHERE id=? AND status=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE', [claim.id, 'PROCESSING']);
            if (!active) throw new ApiError('AUTH_FAILED', 400);
            let linkUser: string | undefined;
            if (claim.intent === 'link') {
              const principal = await this.sessions.require(tx, token);
              if (principal.userId !== claim.user_id || principal.sessionId !== claim.session_id) throw new ApiError('AUTH_FAILED', 400);
              linkUser = principal.userId;
            }
            const userId = await resolveSoop(tx, identity, linkUser);
            if (claim.terms_version) await tx.execute('UPDATE users SET terms_version=? WHERE id=?', [claim.terms_version, userId]);
            const session = await this.sessions.issue(tx, userId);
            if (claim.session_id) await tx.execute('UPDATE auth_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=?', [claim.session_id]);
            await tx.execute('UPDATE login_transactions SET status=?,verifier=? WHERE id=?', ['SUCCEEDED', Buffer.alloc(0), claim.id]);
            return session;
          });
        } catch (error) {
          if (attempt > 0 || !error || typeof error !== 'object' || !('code' in error) || error.code !== 'ER_DUP_ENTRY') throw error;
        }
      }
    } catch {
      await this.fail(claim.id);
      throw new ApiError('AUTH_FAILED', 400);
    }
  }
  async deny(state: string, browser: string): Promise<void> {
    opaque(state); opaque(browser);
    await this.sessions.transactions.write(async tx => {
      const [row] = await tx.rows<LoginRow>('SELECT id,browser_digest FROM login_transactions WHERE state_digest=? AND audience=? AND status=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE', [digest(state), this.config.audience, 'PENDING']);
      if (!row || !equalDigest(browser, row.browser_digest)) throw new ApiError('AUTH_FAILED', 400);
      await tx.execute('UPDATE login_transactions SET status=?,verifier=? WHERE id=?', ['FAILED', Buffer.alloc(0), row.id]);
    });
  }
  private async fail(id: string): Promise<void> {
    await this.sessions.transactions.write(tx => tx.execute('UPDATE login_transactions SET status=?,verifier=? WHERE id=? AND status IN (?,?)', ['FAILED', Buffer.alloc(0), id, 'PENDING', 'PROCESSING']));
  }
}
