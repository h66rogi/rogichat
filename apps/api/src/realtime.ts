import { createHmac } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import type { RowDataPacket } from 'mysql2';
import { object, opaque } from './auth-core.js';
import { cookieName } from './auth-http.js';
import type { AuthRuntime } from './auth-http.js';
import type { LifecycleState } from './health.js';
import { Jobs } from './jobs.js';
import type { JobLease } from './jobs.js';
import { consumeRate } from './repositories.js';

export interface RealtimeOptions { maxConnections?: number; maxPerAccount?: number; dispatchIntervalMs?: number; chunkSize?: number }
type Auth = Pick<AuthRuntime, 'sessions' | 'config'>;
interface Connection { socket: Socket; userId: string; sessionId: string }
interface EventRef { roomId: string; eventId: string }
const hint = Object.freeze({ schemaVersion: 1 });
function bounded(value: number, max: number, min = 1): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('invalid_realtime_policy');
  return value;
}
export function socketCredentials(request: IncomingMessage, input: unknown, auth: Auth): { token: string; csrf: string } {
  if (request.headers.origin !== auth.config.origin) throw new Error('realtime_denied');
  const fields = object(input, ['schemaVersion', 'csrfToken']);
  if (fields.schemaVersion !== 1) throw new Error('realtime_denied');
  const cookie = request.headers.cookie ?? '';
  if (cookie.length > 8192) throw new Error('realtime_denied');
  const prefix = `${cookieName(auth.config, 'session')}=`;
  const cookies = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(prefix));
  if (cookies.length !== 1) throw new Error('realtime_denied');
  return { token: opaque(cookies[0]!.slice(prefix.length)), csrf: opaque(fields.csrfToken) };
}

// Lossy wake-up transport only. No client-selected principal/room channels, message commands,
// packet recovery or per-event delivery rows. Foreground/reconnect/periodic REST sync is mandatory.
export class RealtimeGateway {
  private readonly io: Server;
  private readonly jobs: Jobs;
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
  private lastSessionCheck = 0;
  private admissionWindow = 0;
  private admissions = 0;

  constructor(http: HttpServer, private readonly auth: Auth, private readonly lifecycle: LifecycleState, options: RealtimeOptions = {}) {
    this.maxConnections = bounded(options.maxConnections ?? 1000, 1000);
    this.maxPerAccount = bounded(options.maxPerAccount ?? 5, 10);
    this.intervalMs = bounded(options.dispatchIntervalMs ?? 250, 5000, 100);
    this.chunkSize = bounded(options.chunkSize ?? 50, 100);
    this.jobs = new Jobs(auth.sessions.transactions, 'api');
    this.io = new Server(http, {
      path: '/v1/realtime', transports: ['websocket'], allowUpgrades: false, serveClient: false,
      maxHttpBufferSize: 1024, perMessageDeflate: false, httpCompression: false,
      connectTimeout: 5000, pingInterval: 25000, pingTimeout: 20000,
      cors: { origin: auth.config.origin, credentials: true },
      // connectionStateRecovery deliberately omitted (disabled). Express CORS does not guard upgrades.
      allowRequest: (request, callback) => {
        const now = performance.now();
        if (now - this.admissionWindow >= 1000) { this.admissionWindow = now; this.admissions = 0; }
        const allowed = !this.stopped && !lifecycle.draining && request.headers.origin === auth.config.origin &&
          this.io.engine.clientsCount + this.reservations.size < this.maxConnections && this.admissions < 100;
        if (allowed) {
          this.admissions++;
          const timeout = setTimeout(() => this.releaseReservation(request), 5000); timeout.unref();
          this.reservations.set(request, timeout);
        }
        callback(null, allowed);
      },
    });
    this.io.engine.on('connection', socket => this.releaseReservation(socket.request));
    this.io.engine.on('connection_error', (error: { req: IncomingMessage }) => this.releaseReservation(error.req));
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
  private releaseReservation(request: IncomingMessage): void {
    const timer = this.reservations.get(request);
    if (timer) clearTimeout(timer);
    this.reservations.delete(request);
  }
  private async authenticate(socket: Socket): Promise<void> {
    if (this.stopped || this.lifecycle.draining) throw new Error('realtime_denied');
    const credentials = socketCredentials(socket.request, socket.handshake.auth, this.auth);
    const principal = await this.auth.sessions.transactions.write(async tx => {
      const principal = await this.auth.sessions.require(tx, credentials.token, credentials.csrf, true);
      const key = createHmac('sha256', this.auth.config.key).update(`socket:account:${principal.userId}`).digest();
      if (!await consumeRate(tx, key, 60, 60)) throw new Error('realtime_denied');
      return principal;
    });
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
    const messageAudience = refs?.length ? `EXISTS (
      SELECT 1 FROM room_members m JOIN rooms r ON r.id=m.room_id AND r.status='ACTIVE'
      JOIN membership_periods p ON p.room_id=m.room_id AND p.member_id=m.id AND p.id=m.active_period_id AND p.left_at IS NULL
      JOIN room_events e ON e.room_id=m.room_id
      JOIN messages msg ON msg.room_id=e.room_id AND msg.stream_id=e.stream_id AND msg.id=e.message_id
      JOIN message_streams stream ON stream.room_id=e.room_id AND stream.id=e.stream_id
      WHERE m.user_id=s.user_id AND m.status='ACTIVE' AND msg.created_order>=p.visible_from_order
      AND (${refs.map(() => '(e.id=? AND e.room_id=?)').join(' OR ')})
      AND (stream.kind='ROOM_SHARED' OR EXISTS (SELECT 1 FROM stream_grants g
        WHERE g.room_id=m.room_id AND g.stream_id=stream.id AND g.member_id=m.id AND g.can_read=1
        AND g.revoked_at IS NULL AND g.valid_from<=UTC_TIMESTAMP(3) AND (g.expires_at IS NULL OR g.expires_at>UTC_TIMESTAMP(3)))))` : '';
    const profileAudience = profiles.length ? `EXISTS (
      SELECT 1 FROM profile_changes pc JOIN users subject ON subject.id=pc.user_id AND subject.status='ACTIVE'
      JOIN platform_soop subject_platform ON subject_platform.user_id=subject.id AND subject_platform.status='VERIFIED'
      JOIN room_members target ON target.user_id=subject.id AND target.status='ACTIVE'
      JOIN rooms r ON r.id=target.room_id AND r.status='ACTIVE'
      JOIN membership_periods tp ON tp.id=target.active_period_id AND tp.room_id=target.room_id AND tp.member_id=target.id AND tp.left_at IS NULL
      JOIN room_members viewer ON viewer.room_id=r.id AND viewer.user_id=s.user_id AND viewer.status='ACTIVE'
      JOIN membership_periods vp ON vp.id=viewer.active_period_id AND vp.room_id=viewer.room_id AND vp.member_id=viewer.id AND vp.left_at IS NULL
      WHERE pc.id IN (${profiles.map(() => '?').join(',')}) AND
      ((pc.public_changed=1 AND (r.mode='GROUP' OR target.role='STREAMER' OR target.user_id=viewer.user_id OR viewer.role='STREAMER'))
      OR (pc.streamer_changed=1 AND viewer.role='STREAMER')))` : '';
    const predicates = [messageAudience, profileAudience].filter(Boolean);
    const audience = refs !== undefined ? ` AND (${predicates.join(' OR ') || '0'})` : '';
    return this.auth.sessions.transactions.read(async tx => {
      const rows = await tx.rows<RowDataPacket>(`SELECT s.id FROM auth_sessions s JOIN users u ON u.id=s.user_id AND u.status='ACTIVE'
        JOIN platform_soop platform ON platform.user_id=u.id AND platform.status='VERIFIED'
        WHERE s.id IN (${ids.map(() => '?').join(',')}) AND s.audience=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3)${audience}`,
      [...ids, this.auth.config.audience, ...(refs?.flatMap(ref => [ref.eventId, ref.roomId]) ?? []), ...profiles]);
      return new Set(rows.map(row => String(row.id)));
    });
  }
  private async dispatch(): Promise<void> {
    const leases = await this.jobs.claim({ purposes: ['REALTIME_HINT'], limit: 20 });
    const valid: JobLease[] = [];
    const refs: EventRef[] = [];
    const profiles: string[] = [];
    try {
      const existing = leases.length ? await this.auth.sessions.transactions.read(async tx => {
        const messages = leases.filter(lease => lease.roomId && lease.resourceId);
        const changes = leases.filter(lease => !lease.roomId && lease.resourceId);
        const events = messages.length ? await tx.rows<RowDataPacket>(`SELECT id,room_id FROM room_events WHERE ${messages.map(() => '(id=? AND room_id=?)').join(' OR ')}`, messages.flatMap(lease => [lease.resourceId, lease.roomId])) : [];
        const profile = changes.length ? await tx.rows<RowDataPacket>(`SELECT id FROM profile_changes WHERE id IN (${changes.map(() => '?').join(',')})`, changes.map(lease => lease.resourceId)) : [];
        return { events: new Set(events.map(row => `${String(row.room_id)}:${String(row.id)}`)), profiles: new Set(profile.map(row => String(row.id))) };
      }) : { events: new Set<string>(), profiles: new Set<string>() };
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
    await new Promise<void>(resolve => { void this.io.close(() => resolve()); });
  }
}
