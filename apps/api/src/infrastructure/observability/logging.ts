import type { Role } from '../config/config.js';

type Event = 'started' | 'startup_failed' | 'readiness_changed' | 'request' | 'channel_schedule_refresh_failed' | 'shutdown_started' |
  'shutdown_complete' | 'shutdown_failed' | 'shutdown_timeout' | 'process_fault' | 'request_failed';
type Reason = 'configuration' | 'dependency' | 'runtime' | 'database_unavailable' | 'schema_mismatch' | 'ready' | 'draining' |
  'database_admission' | 'database_acquisition' | 'database_statement_timeout' | 'transaction_timeout';
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
    if (fields.reason && ['configuration', 'dependency', 'runtime', 'database_unavailable', 'schema_mismatch', 'ready', 'draining', 'database_admission', 'database_acquisition', 'database_statement_timeout', 'transaction_timeout'].includes(fields.reason)) record.reason = fields.reason;
    if (fields.route && ['live', 'ready', 'unmatched'].includes(fields.route)) record.route = fields.route;
    if (Number.isFinite(fields.status)) record.status = fields.status;
    if (Number.isFinite(fields.durationMs)) record.durationMs = Math.round(fields.durationMs ?? 0);
    if (fields.requestId && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(fields.requestId)) record.requestId = fields.requestId;
    this.write(`${JSON.stringify(record)}\n`);
  }
}
