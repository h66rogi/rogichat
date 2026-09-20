import type { Role } from '../config/config.js';

type Event = 'started' | 'startup_failed' | 'readiness_changed' | 'request' | 'shutdown_started' |
  'shutdown_complete' | 'shutdown_failed' | 'shutdown_timeout' | 'process_fault';
type Reason = 'configuration' | 'dependency' | 'runtime' | 'database_unavailable' | 'schema_mismatch' | 'ready' | 'draining';
interface Fields {
  reason?: Reason;
  status?: number;
  durationMs?: number;
  requestId?: string;
  route?: 'live' | 'ready' | 'unmatched';
}

// Only operational enums/numbers and server-generated UUIDs cross this boundary.
// Error objects, SQL, request headers/body/path/query and environment values are never serialized.
export class SafeLogger {
  constructor(private readonly role: Role, private readonly write: (line: string) => void = (line) => { process.stdout.write(line); }) {}

  event(event: Event, fields: Fields = {}): void {
    const record: Record<string, unknown> = { timestamp: new Date().toISOString(), role: this.role, event };
    if (fields.reason && ['configuration', 'dependency', 'runtime', 'database_unavailable', 'schema_mismatch', 'ready', 'draining'].includes(fields.reason)) record.reason = fields.reason;
    if (fields.route && ['live', 'ready', 'unmatched'].includes(fields.route)) record.route = fields.route;
    if (Number.isFinite(fields.status)) record.status = fields.status;
    if (Number.isFinite(fields.durationMs)) record.durationMs = Math.round(fields.durationMs ?? 0);
    if (fields.requestId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(fields.requestId)) record.requestId = fields.requestId;
    this.write(`${JSON.stringify(record)}\n`);
  }
}
