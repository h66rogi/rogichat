import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { ECDH } from 'node:crypto';
import webpush from 'web-push';
import { ApiError } from '../auth/auth-primitives.js';
import { WAKE_ONLY_PUSH } from './notification-contract.js';

export function validatePushKeys(p256dh: string, auth: string): void {
  try {
    if (!/^[A-Za-z0-9_-]{87}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth)) throw new Error();
    const point = Buffer.from(p256dh, 'base64url'); const secret = Buffer.from(auth, 'base64url');
    if (point.length !== 65 || point[0] !== 4 || point.toString('base64url') !== p256dh || secret.length !== 16 || secret.toString('base64url') !== auth) throw new Error();
    ECDH.convertKey(point, 'prime256v1');
  } catch { throw new ApiError('INVALID_REQUEST', 400); }
}

export interface PushCredentials { endpoint: string; p256dh: string; auth_secret: string }
export type PushTransportResult = { kind: 'accepted' | 'gone' | 'retry' | 'rejected' | 'unavailable' };
export { readPushConfig } from './push-config.js';
import type { PushConfig } from './push-config.js';
export type { PushConfig } from './push-config.js';

// Conservative global-unicast allow policy. IPv4-mapped IPv6, translation,
// tunnels, documentation, multicast, link-local and reserved blocks fail closed.
export function publicPushAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6 || address.includes('.')) return false;
  const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1);
  const first = Number.parseInt(normalized.split(':')[0]!, 16);
  const second = Number.parseInt(normalized.split(':')[1] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) && !normalized.startsWith('2002:') && !normalized.startsWith('3fff:');
}
export type PushResolver = (hostname: string) => Promise<readonly { address: string; family: number }[]>;
export class PushEndpointPolicy {
  constructor(private readonly resolve: PushResolver = hostname => lookup(hostname, { all: true, verbatim: true })) {}
  async validate(endpoint: string): Promise<{ url: URL; address: string; family: number }> {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error('invalid_push_endpoint'); }
    if (endpoint.length > 2048 || /\s/.test(endpoint) || url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error('invalid_push_endpoint');
    // Provider domain boundary prevents arbitrary HTTPS egress even to public IPs.
    if (!(url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' || url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com'))) throw new Error('invalid_push_endpoint');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let addresses;
    try { addresses = await Promise.race([this.resolve(url.hostname), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('push_dns_timeout')), 2000); })]); }
    finally { clearTimeout(timer); }
    if (!addresses.length || addresses.some(item => !publicPushAddress(item.address) || isIP(item.address) !== item.family)) throw new Error('invalid_push_endpoint');
    return { url, ...addresses[0]! };
  }
}
export interface PreparedPush { send(): Promise<PushTransportResult> }
export class PushTransport {
  constructor(readonly config: PushConfig, readonly policy = new PushEndpointPolicy(), private readonly httpRequest: typeof request = request) {}
  assertAvailable(): void { if (!this.config.vapid) throw new ApiError('AUTH_UNAVAILABLE', 503); }
  async prepare(subscription: PushCredentials): Promise<PreparedPush | null> {
    if (!this.config.vapid) return null;
    const destination = await this.policy.validate(subscription.endpoint);
    let details;
    try { validatePushKeys(subscription.p256dh, subscription.auth_secret); details = webpush.generateRequestDetails({ endpoint: destination.url.href, keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret } }, JSON.stringify(WAKE_ONLY_PUSH), { vapidDetails: this.config.vapid, TTL: 60, urgency: 'normal', contentEncoding: 'aes128gcm' }); }
    catch { throw new Error('invalid_push_subscription'); }
    const body = details.body;
    const headers = details.headers;
    return { send: () => new Promise<PushTransportResult>(resolve => {
      let settled = false;
      const finish = (kind: PushTransportResult['kind']) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ kind }); };
      // Direct numeric socket destination, original TLS SNI/Host and standard TLS
      // verification. No second DNS lookup, redirects, proxy or pooled socket reuse.
      const req = this.httpRequest({ protocol: 'https:', hostname: destination.address, family: destination.family, port: 443, servername: destination.url.hostname, path: destination.url.pathname + destination.url.search, method: 'POST', headers: { ...headers, Host: destination.url.hostname }, agent: false, rejectUnauthorized: true, maxHeaderSize: 8192 }, response => {
        let bytes = 0;
        response.on('data', chunk => { bytes += chunk.length; if (bytes > 8192) { finish('retry'); response.destroy(); req.destroy(); } });
        response.on('error', () => finish('retry'));
        response.on('aborted', () => finish('retry'));
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          finish(status >= 200 && status < 300 ? 'accepted' : status === 404 || status === 410 ? 'gone' : status === 429 || status >= 500 ? 'retry' : 'rejected');
        });
      });
      const timer = setTimeout(() => { finish('retry'); req.destroy(); }, 5000);
      req.on('error', () => finish('retry'));
      req.end(body);
    }) };
  }
  async send(subscription: PushCredentials): Promise<PushTransportResult> {
    const prepared = await this.prepare(subscription);
    return prepared ? prepared.send() : { kind: 'unavailable' };
  }
}
