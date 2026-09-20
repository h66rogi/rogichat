import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

export const RESTORE_MEDIA_STORE = Symbol('RESTORE_MEDIA_STORE');
export const RESTORE_MEDIA_LIMITS = Symbol('RESTORE_MEDIA_LIMITS');
export interface RestoreMediaLimits { rows: number; objects: number; pages: number; objectBytes: number; totalBytes: number; deadlineMs: number }
export const RESTORE_MEDIA_MAXIMUMS: Readonly<RestoreMediaLimits> = Object.freeze({
  rows: 10000, objects: 10000, pages: 100, objectBytes: 52 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 * 1024, deadlineMs: 300000,
});
export interface RestoreInventoryObject { key: string; bytes: number; etag: string; modified: string }
/** Read/list only. The exact configured account/bucket/prefix is hashed, never returned. */
export interface RestoreMediaStore {
  readonly prefix: string;
  readonly storageScopeSha256: string;
  list(cursor: string | null, signal: AbortSignal): Promise<{ objects: RestoreInventoryObject[]; next: string | null }>;
  read(key: string, signal: AbortSignal): Promise<{ stream: Readable; bytes: number; etag: string }>;
  close?(): void;
}
export type RestoreMediaReason = 'MISSING' | 'CHANGED' | 'ORPHAN' | 'DELETION_OBLIGATION' | 'DATABASE_DRIFT' | 'INVENTORY_DRIFT' |
  'INVALID_DATABASE' | 'STORAGE_UNAVAILABLE' | 'DATABASE_UNAVAILABLE' | 'LIMIT_EXCEEDED' | 'CANCELLED' | 'DEADLINE_EXCEEDED' | 'CONFIGURATION_UNAVAILABLE';
export interface RestoreMediaEvidence {
  readonly version: 1;
  readonly status: 'verified' | 'blocked' | 'unavailable';
  readonly snapshotSha256: string | null;
  readonly manifestSha256: string | null;
  readonly storageScopeSha256: string | null;
  readonly counts: Readonly<{ retained: number; missing: number; changed: number; orphan: number; deletionObligations: number }>;
  readonly reasons: readonly RestoreMediaReason[];
}
export class RestoreMediaFailure extends Error {
  constructor(readonly reason: RestoreMediaReason) { super('restore_media_unavailable'); }
}
export function restoreMediaDigest(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Date) return item.toISOString();
    if (item instanceof Uint8Array) return Buffer.from(item).toString('hex');
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
    return item;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
