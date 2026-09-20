import { sign } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { connect as http2Connect } from 'node:http2';
import { ApiError } from '../auth/auth-primitives.js';
import { publicPushAddress } from './push-transport.js';
import type { PreparedPush, PushTransportResult, PushResolver } from './push-transport.js';
import type { NativePushConfig } from './native-push-config.js';
import { nativeDeviceToken } from './native-push-contract.js';
import type { NativePushProvider } from './native-push-contract.js';

interface ProviderResponse { status: number; body: Buffer }
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const part = (value: unknown) => json(value).toString('base64url');
const ALLOWED_HOSTS = new Set(['oauth2.googleapis.com', 'fcm.googleapis.com', 'api.push.apple.com', 'api.sandbox.push.apple.com']);

/** Fixed vendor destinations, bounded bodies/deadlines, no caller URLs/proxies. */
export class NativePushTransport {
  private readonly active = new Set<() => void>();
  private closed = false;
  private fcmToken: { value: string; until: number } | undefined;
  constructor(readonly config: NativePushConfig | undefined,
    private readonly resolve: PushResolver = host => lookup(host, { all: true, verbatim: true })) {}
  available(provider: NativePushProvider): boolean { return !this.closed && Boolean(provider === 'APNS' ? this.config?.apns : this.config?.fcm); }
  assertAvailable(provider: NativePushProvider): void { if (!this.available(provider)) throw new ApiError('AUTH_UNAVAILABLE', 503); }
  onModuleDestroy(): void { this.closed = true; this.fcmToken = undefined; for (const abort of [...this.active]) abort(); }
  private async destination(host: string) {
    if (!ALLOWED_HOSTS.has(host) || this.closed) throw new Error('native_push_unavailable');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = await Promise.race([this.resolve(host), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('native_push_unavailable')), 2000);
      })]);
      if (!addresses.length || addresses.some(row => isIP(row.address) !== row.family || !publicPushAddress(row.address))) throw new Error('native_push_unavailable');
      return addresses[0]!;
    } finally { clearTimeout(timer); }
  }
  private async post(host: string, path: string, headers: Record<string, string>, body: Buffer, http2 = false): Promise<ProviderResponse> {
    const destination = await this.destination(host);
    if (this.closed) throw new Error('native_push_unavailable');
    return new Promise<ProviderResponse>((resolve, reject) => {
      let settled = false, bytes = 0, status = 0;
      const chunks: Buffer[] = [];
      let stop: () => void = () => {};
      const finish = (result?: ProviderResponse) => {
        if (settled) return; settled = true; clearTimeout(timer); this.active.delete(abort); stop();
        if (result) resolve(result); else reject(new Error('native_push_unavailable'));
      };
      const abort = () => finish();
      const timer = setTimeout(abort, 5000); this.active.add(abort);
      const data = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 16384) { abort(); return; }
        chunks.push(chunk);
      };
      try {
        if (http2) {
          // The lookup returns the inspected address; TLS verifies the vendor
          // hostname, never the numeric destination. No pooled/multiplexed state.
          const lookup: LookupFunction = (_name, _options, callback) => callback(null, destination.address, destination.family);
          const options = { rejectUnauthorized: true, servername: host, family: destination.family, autoSelectFamily: false, lookup };
          const session = http2Connect(`https://${host}`, options);
          stop = () => session.destroy();
          session.on('error', abort);
          const req = session.request({ ':method': 'POST', ':path': path, ...headers, 'content-length': String(body.length) });
          stop = () => { req.close(); session.destroy(); };
          req.on('error', abort); req.on('aborted', abort);
          req.on('response', response => { status = Number(response[':status'] ?? 0); });
          req.on('data', data); req.on('end', () => finish({ status, body: Buffer.concat(chunks) })); req.end(body);
        } else {
          const req = httpsRequest({ protocol: 'https:', hostname: destination.address, port: 443, family: destination.family,
            servername: host, path, method: 'POST', agent: false, rejectUnauthorized: true, maxHeaderSize: 8192,
            headers: { ...headers, Host: host, 'content-length': String(body.length) } }, response => {
            status = response.statusCode ?? 0; response.on('data', data); response.on('error', abort); response.on('aborted', abort);
            response.on('end', () => finish({ status, body: Buffer.concat(chunks) }));
          });
          stop = () => req.destroy(); req.on('error', abort); req.end(body);
        }
      } catch { abort(); }
    });
  }
  private async googleToken(): Promise<string> {
    if (this.fcmToken && this.fcmToken.until > Date.now() + 60000) return this.fcmToken.value;
    const config = this.config?.fcm; if (!config) throw new Error('native_push_unavailable');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: config.email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), config.key).toString('base64url')}`;
    const response = await this.post('oauth2.googleapis.com', '/token', { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-store' },
      Buffer.from(new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString()));
    try {
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)) as Record<string, unknown>;
      if (response.status !== 200 || result.token_type !== 'Bearer' || typeof result.access_token !== 'string' ||
        !/^[A-Za-z0-9._~+/-]{16,8192}$/.test(result.access_token) || typeof result.expires_in !== 'number' ||
        !Number.isSafeInteger(result.expires_in) || result.expires_in < 1 || result.expires_in > 3600) throw new Error();
      this.fcmToken = { value: result.access_token, until: Date.now() + result.expires_in * 1000 };
      return result.access_token;
    } catch { throw new Error('native_push_unavailable'); }
  }
  async prepare(provider: NativePushProvider, tokenValue: string): Promise<PreparedPush | null> {
    if (!this.available(provider)) return null;
    const token = nativeDeviceToken(provider, tokenValue);
    if (provider === 'APNS') {
      const config = this.config!.apns!;
      const unsigned = `${part({ alg: 'ES256', kid: config.keyId })}.${part({ iss: config.teamId, iat: Math.floor(Date.now() / 1000) })}`;
      const jwt = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: config.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
      return { send: async () => {
        try {
          const response = await this.post(config.sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com', `/3/device/${token}`,
            { authorization: `bearer ${jwt}`, 'apns-topic': config.topic, 'apns-push-type': 'background', 'apns-priority': '5',
              'apns-expiration': '0', 'apns-collapse-id': 'rogi-sync', 'content-type': 'application/json' },
            json({ aps: { 'content-available': 1 }, type: 'sync_required', version: 1 }), true);
          return classifyNativePush('APNS', response.status, response.body);
        } catch { return { kind: 'retry' }; }
      } };
    }
    const config = this.config!.fcm!, accessToken = await this.googleToken();
    return { send: async () => {
      try {
        const response = await this.post('fcm.googleapis.com', `/v1/projects/${config.projectId}/messages:send`,
          { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, json({ message: { token,
            data: { type: 'sync_required', version: '1' }, android: { priority: 'normal', ttl: '0s', collapse_key: 'rogi-sync', restricted_package_name: config.applicationId } } }));
        if (response.status === 401) this.fcmToken = undefined;
        return classifyNativePush('FCM', response.status, response.body);
      } catch { return { kind: 'retry' }; }
    } };
  }
}

export function classifyNativePush(provider: NativePushProvider, status: number, body: Buffer): PushTransportResult {
  if (status === 429 || status >= 500 || status === 0) return { kind: 'retry' };
  let value: Record<string, unknown>;
  try { value = body.length ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as Record<string, unknown> : {}; }
  catch { return { kind: 'retry' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'retry' };
  if (provider === 'APNS') {
    if (status === 200 && body.length === 0) return { kind: 'accepted' };
    // BadDeviceToken also covers an incorrect sandbox/production environment;
    // configuration errors must not permanently revoke otherwise valid bindings.
    if (status === 410 && value.reason === 'Unregistered') return { kind: 'gone' };
  } else {
    if (status === 200 && typeof value.name === 'string' && /^projects\/[a-z0-9-]+\/messages\/[^\s]{1,1024}$/.test(value.name)) return { kind: 'accepted' };
    const error = value.error as { details?: unknown } | undefined;
    if (status === 404 && Array.isArray(error?.details) && error.details.some(row => row && typeof row === 'object' &&
      row['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && row.errorCode === 'UNREGISTERED')) return { kind: 'gone' };
  }
  return { kind: status === 401 || status === 403 ? 'unavailable' : 'rejected' };
}
