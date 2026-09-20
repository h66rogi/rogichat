import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { object, opaque } from '../../modules/auth/auth-primitives.js';
import { readSessionCredentials } from '../../modules/auth/auth-context.js';
import type { CommandCredentials } from '../../modules/auth/auth-context.js';
import type { AuthConfig } from '../../infrastructure/config/auth-config.js';
import type { RealtimeService } from '../../modules/realtime/realtime.service.js';
import type { LifecycleState } from '../../common/lifecycle/lifecycle-state.js';
import type { Jobs } from '../jobs/jobs.service.js';
import type { JobLease } from '../../modules/jobs/jobs.policy.js';

export interface RealtimeOptions { maxConnections?: number; maxPerAccount?: number; dispatchIntervalMs?: number; chunkSize?: number }
interface Connection { socket: Socket; userId: string; sessionId: string }
interface EventRef { roomId: string; eventId: string }
const hint = Object.freeze({ schemaVersion: 1 });
function bounded(value: number, max: number, min = 1): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('invalid_realtime_policy');
  return value;
}
function upgradeCredentials(request: IncomingMessage, config: AuthConfig) {
  if (request.url !== undefined) {
    // Only Engine.IO protocol query parameters are supported. Credentials never
    // enter URLs (including ignored query values that a proxy could log).
    if (request.url.length > 2048) throw new Error('realtime_denied');
    const url = new URL(request.url, 'http://socket.invalid');
    if ([...url.searchParams.keys()].some(key => !['EIO', 'transport', 't', 'sid', 'b64'].includes(key))) throw new Error('realtime_denied');
  }
  const credentials = readSessionCredentials(request, config);
  if (request.headers.origin !== config.origin && !(request.headers.origin === undefined && credentials.transport === 'NATIVE')) throw new Error('realtime_denied');
  return credentials;
}
export function socketCredentials(request: IncomingMessage, input: unknown, config: AuthConfig): CommandCredentials {
  const credentials = upgradeCredentials(request, config);
  if (credentials.transport === 'NATIVE') {
    const fields = object(input, ['schemaVersion', 'transport']);
    if (fields.schemaVersion !== 1 || fields.transport !== 'native') throw new Error('realtime_denied');
    return credentials;
  }
  const fields = object(input, ['schemaVersion', 'csrfToken']);
  if (fields.schemaVersion !== 1) throw new Error('realtime_denied');
  return { token: opaque(credentials.token), csrf: opaque(fields.csrfToken) };
}

// Lossy wake-up transport only. No client-selected principal/room channels, message commands,
// packet recovery or per-event delivery rows. Foreground/reconnect/periodic REST sync is mandatory.
export class RealtimeGateway {
  private readonly io: Server;
  private readonly connections = new Map<string, Connection>();
  private readonly accounts = new Map<string, number>();
  private readonly reservations = new Map<IncomingMessage, ReturnType<typeof setTimeout>>();
  private readonly maxConnections: number;
  private readonly maxPerAccount: number;
  private readonly intervalMs: number;
  private readonly chunkSize: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  private started = false;
  private attached = false;
  private lastSessionCheck = 0;
  private admissionWindow = 0;
  private admissions = 0;

  constructor(private readonly http: HttpServer | (() => HttpServer), private readonly service: RealtimeService, private readonly config: AuthConfig, private readonly lifecycle: LifecycleState, private readonly jobs: Jobs, options: RealtimeOptions = {}) {
    this.maxConnections = bounded(options.maxConnections ?? 1000, 1000);
    this.maxPerAccount = bounded(options.maxPerAccount ?? 5, 10);
    this.intervalMs = bounded(options.dispatchIntervalMs ?? 250, 5000, 100);
    this.chunkSize = bounded(options.chunkSize ?? 50, 100);
    this.io = new Server({
      path: '/v1/realtime', transports: ['websocket'], allowUpgrades: false, serveClient: false,
      maxHttpBufferSize: 1024, perMessageDeflate: false, httpCompression: false,
      connectTimeout: 5000, pingInterval: 25000, pingTimeout: 20000,
      cors: { origin: config.origin, credentials: true },
      // connectionStateRecovery deliberately omitted (disabled). Express CORS does not guard upgrades.
      allowRequest: (request, callback) => {
        const now = performance.now();
        if (now - this.admissionWindow >= 1000) { this.admissionWindow = now; this.admissions = 0; }
        let admittedTransport = false;
        try { upgradeCredentials(request, config); admittedTransport = true; } catch { /* No credential detail leaves admission. */ }
        const allowed = !this.stopped && !lifecycle.draining && admittedTransport &&
          this.io.engine.clientsCount + this.reservations.size < this.maxConnections && this.admissions < 100;
        if (allowed) {
          this.admissions++;
          const timeout = setTimeout(() => this.releaseReservation(request), 5000); timeout.unref();
          this.reservations.set(request, timeout);
        }
        callback(null, allowed);
      },
    });
    if (typeof http !== 'function') this.attach(http);
    this.io.use((socket, next) => {
      void this.authenticate(socket).then(() => next(), () => next(new Error('UNAUTHENTICATED')));
    });
    this.io.on('connection', socket => {
      if (this.stopped || lifecycle.draining) { socket.conn.close(); return; }
      // Any application input is outside this read-only transport contract.
      socket.onAny(() => socket.disconnect(true));
      socket.on('error', () => socket.disconnect(true));
    });
  }
  private attach(http: HttpServer): void {
    if (this.attached) return;
    this.io.attach(http);
    this.attached = true;
    this.io.engine.on('connection', socket => this.releaseReservation(socket.request));
    this.io.engine.on('connection_error', (error: { req: IncomingMessage }) => this.releaseReservation(error.req));
  }
  private releaseReservation(request: IncomingMessage): void {
    const timer = this.reservations.get(request);
    if (timer) clearTimeout(timer);
    this.reservations.delete(request);
  }
  private async authenticate(socket: Socket): Promise<void> {
    if (this.stopped || this.lifecycle.draining) throw new Error('realtime_denied');
    const credentials = socketCredentials(socket.request, socket.handshake.auth, this.config);
    if (credentials.transport === 'NATIVE') {
      delete socket.request.headers.authorization;
      const raw = socket.request.rawHeaders;
      for (let index = raw.length - 2; index >= 0; index -= 2) if (raw[index]?.toLowerCase() === 'authorization') raw.splice(index, 2);
    }
    const principal = await this.service.admit(credentials);
    if (this.stopped || this.lifecycle.draining || socket.conn.readyState !== 'open' || this.connections.size >= this.maxConnections || (this.accounts.get(principal.userId) ?? 0) >= this.maxPerAccount) throw new Error('realtime_denied');
    this.connections.set(socket.id, { socket, userId: principal.userId, sessionId: principal.sessionId });
    this.accounts.set(principal.userId, (this.accounts.get(principal.userId) ?? 0) + 1);
    const remove = () => {
      if (!this.connections.delete(socket.id)) return;
      const count = (this.accounts.get(principal.userId) ?? 1) - 1;
      if (count === 0) this.accounts.delete(principal.userId); else this.accounts.set(principal.userId, count);
    };
    socket.once('disconnect', remove); socket.conn.once('close', remove);
    // Do not retain cookie/CSRF credentials in application-owned socket state.
    delete socket.handshake.auth.csrfToken;
  }
  stats(): { connections: number; accounts: number; dispatching: boolean } {
    return { connections: this.connections.size, accounts: this.accounts.size, dispatching: this.running !== undefined };
  }
  onApplicationBootstrap(): void {
    // Nest initializes the underlying HTTP server after constructing providers.
    this.attach(typeof this.http === 'function' ? this.http() : this.http);
    this.start();
  }
  onModuleDestroy(): Promise<void> { return this.stop(); }
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    const loop = () => {
      if (this.stopped || this.lifecycle.draining) return;
      // With no local listeners, hints are only disposable wake-ups. Keep the single-user MVP idle cost low.
      this.timer = setTimeout(() => { void this.tick().catch(() => {}).finally(loop); }, this.connections.size ? this.intervalMs : 5000);
      this.timer.unref();
    };
    loop();
  }
  tick(): Promise<void> {
    if (this.stopped || this.lifecycle.draining) return Promise.resolve();
    this.running ??= this.dispatch().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async validSessions(batch: Connection[], refs?: EventRef[], profiles: string[] = []): Promise<Set<string>> {
    const ids = [...new Set(batch.map(connection => connection.sessionId))];
    if (ids.length === 0) return new Set();
    return this.service.validSessions(ids, refs, profiles);
  }

  private async dispatch(): Promise<void> {
    const leases = await this.jobs.claim({ purposes: ['REALTIME_HINT'], limit: 20 });
    const valid: JobLease[] = [];
    const refs: EventRef[] = [];
    const profiles: string[] = [];
    try {
      const existing = leases.length ? await this.service.existing(leases) : { events: new Set<string>(), profiles: new Set<string>() };
      // Null room has exactly one discriminator: profile_changes.id, never a guessed user/event ID.
      for (const lease of leases) {
        if (!lease.resourceId || (lease.roomId ? !existing.events.has(`${lease.roomId}:${lease.resourceId}`) : !existing.profiles.has(lease.resourceId))) {
          await this.jobs.retry(lease, 'INVALID_RESOURCE', { terminal: true }); continue;
        }
        valid.push(lease);
        if (lease.roomId) refs.push({ roomId: lease.roomId, eventId: lease.resourceId }); else profiles.push(lease.resourceId);
      }
      const checkSessions = performance.now() - this.lastSessionCheck >= 15000;
      const live = [...this.connections.values()].filter(connection => connection.socket.connected);
      for (let index = 0; index < live.length && !this.stopped && !this.lifecycle.draining; index += this.chunkSize) {
        const batch = live.slice(index, index + this.chunkSize);
        if (checkSessions) {
          const current = await this.validSessions(batch);
          for (const connection of batch) if (!current.has(connection.sessionId)) connection.socket.disconnect(true);
        }
        if (!refs.length && !profiles.length) continue;
        const allowed = await this.validSessions(batch, refs, profiles);
        // The read snapshot is the authorization point. No DB transaction is held during transport I/O.
        for (const connection of batch) {
          const socket = connection.socket;
          if (this.stopped || this.lifecycle.draining || !socket.connected || !allowed.has(connection.sessionId)) continue;
          // Volatile writes never queue a missed hint; a non-writable slow consumer reconnects and syncs.
          if (!socket.conn.transport.writable) { socket.conn.close(); continue; }
          socket.volatile.emit('sync.required', hint);
        }
      }
      if (checkSessions) this.lastSessionCheck = performance.now();
      for (const lease of valid) await this.jobs.complete(lease);
    } catch (error) {
      // Only safe allowlisted codes persist. Partial/duplicate hints are explicitly recoverable by DB sync.
      await Promise.allSettled(valid.map(lease => this.jobs.retry(lease, 'TEMPORARY_UNAVAILABLE')));
      throw error;
    }
  }
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const request of this.reservations.keys()) this.releaseReservation(request);
    // Engine close, not io-server-disconnect: standard clients may jitter-reconnect after restart.
    for (const connection of this.connections.values()) connection.socket.conn.close();
    await this.running?.catch(() => {});
    if (this.attached) await new Promise<void>(resolve => { void this.io.close(() => resolve()); });
  }
}
