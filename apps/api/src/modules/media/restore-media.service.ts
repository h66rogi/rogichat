import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { mediaKey } from './adapters/media-store.js';
import { RestoreMediaRepository } from './restore-media.repository.js';
import { RESTORE_MEDIA_LIMITS, RESTORE_MEDIA_MAXIMUMS, RESTORE_MEDIA_STORE, RestoreMediaFailure, restoreMediaDigest } from './restore-media.types.js';
import type { RestoreInventoryObject, RestoreMediaEvidence, RestoreMediaLimits, RestoreMediaReason, RestoreMediaStore } from './restore-media.types.js';

type Snapshot = Awaited<ReturnType<RestoreMediaRepository['snapshot']>>;
/** Operator-only, point-in-time evidence, NOT a storage write fence or release gate.
 * The caller must independently retain storage write-quiescence/custody through
 * release. Two inventories and bind's DB check cannot prove ongoing R2 custody.
 * No expiry, mutation, deletion, public route or persisted success is created.
 */
@Injectable()
export class RestoreMediaService {
  private readonly issued = new WeakMap<RestoreMediaEvidence, { manifest: string; prefix: string }>();
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(RestoreMediaRepository) private readonly repository: RestoreMediaRepository,
    @Inject(RESTORE_MEDIA_STORE) private readonly store: RestoreMediaStore | null,
    @Inject(RESTORE_MEDIA_LIMITS) private readonly limits: Readonly<RestoreMediaLimits>) {
    for (const key of Object.keys(RESTORE_MEDIA_MAXIMUMS) as (keyof RestoreMediaLimits)[]) {
      if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > RESTORE_MEDIA_MAXIMUMS[key]) throw new Error('restore_media_limits');
    }
  }
  /** First consistent read in a fresh final caller transaction under its DB write
   * fence. Never reuse an older RR snapshot. No external I/O or copied evidence. */
  async bind(tx: Transaction, evidence: RestoreMediaEvidence): Promise<boolean> {
    const issued = this.issued.get(evidence);
    if (!this.store || evidence.status !== 'verified' || !issued || issued.manifest !== evidence.manifestSha256 || issued.prefix !== this.store.prefix ||
      evidence.storageScopeSha256 !== this.store.storageScopeSha256) return false;
    try { return restoreMediaDigest(await this.repository.snapshot(tx, this.limits.rows)) === evidence.snapshotSha256; }
    catch { return false; }
  }
  async reconcile(signal: AbortSignal): Promise<RestoreMediaEvidence> {
    const counts = { retained: 0, missing: 0, changed: 0, orphan: 0, deletionObligations: 0 };
    let snapshotSha256: string | null = null;
    const configuredScope = this.store?.storageScopeSha256;
    const prefix = this.store?.prefix;
    const scope = typeof configuredScope === 'string' && /^[a-f0-9]{64}$/.test(configuredScope) ? configuredScope : null;
    const result = (status: RestoreMediaEvidence['status'], reasons: RestoreMediaReason[], manifestSha256: string | null = null): RestoreMediaEvidence =>
      Object.freeze({ version: 1, status, snapshotSha256, manifestSha256, storageScopeSha256: scope,
        counts: Object.freeze({ ...counts }), reasons: Object.freeze([...new Set(reasons)].sort()) });
    if (!this.store || !scope || !['local', 'test', 'qa', 'production'].includes(this.store.prefix)) return result('unavailable', ['CONFIGURATION_UNAVAILABLE']);
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    const timer = setTimeout(() => { timedOut = true; cancel(); }, this.limits.deadlineMs);
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new RestoreMediaFailure(timedOut ? 'DEADLINE_EXCEEDED' : 'CANCELLED'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    const execute = async () => {
      controller.signal.throwIfAborted();
      const snapshot = await this.snapshot();
      snapshotSha256 = restoreMediaDigest(snapshot);
      const classification = this.classify(snapshot);
      counts.deletionObligations = classification.deletion.size;
      counts.missing = classification.missingVariants;
      const first = await this.inventory(controller.signal);
      const byKey = new Map(first.map(object => [object.key, object]));
      const deletion = classification.deletion;
      for (const object of first) {
        if (classification.closed.has(object.key)) deletion.add(`key:${object.key}`);
        else if (!classification.retained.has(object.key) && !classification.pending.has(object.key)) counts.orphan++;
      }
      let total = 0;
      const verified: { key: string; bytes: number; sha256: string }[] = [];
      for (const [key, expected] of classification.retained) {
        controller.signal.throwIfAborted();
        const listed = byKey.get(key);
        if (!listed) { counts.missing++; continue; }
        if (listed.bytes !== expected.bytes) { counts.changed++; continue; }
        if (total + expected.bytes > this.limits.totalBytes) throw new RestoreMediaFailure('LIMIT_EXCEEDED');
        total += expected.bytes;
        const actual = await this.read(key, expected.bytes, controller.signal);
        if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256 || actual.etag !== listed.etag) counts.changed++;
        else { counts.retained++; verified.push({ key, bytes: actual.bytes, sha256: actual.sha256 }); }
      }
      counts.deletionObligations = deletion.size;
      const second = await this.inventory(controller.signal);
      const reasons: RestoreMediaReason[] = [];
      if (counts.missing) reasons.push('MISSING');
      if (counts.changed) reasons.push('CHANGED');
      if (counts.orphan) reasons.push('ORPHAN');
      if (counts.deletionObligations) reasons.push('DELETION_OBLIGATION');
      if (restoreMediaDigest(first) !== restoreMediaDigest(second)) reasons.push('INVENTORY_DRIFT');
      const current = await this.snapshot();
      if (restoreMediaDigest(current) !== snapshotSha256) reasons.push('DATABASE_DRIFT');
      if (scope !== this.store!.storageScopeSha256 || prefix !== this.store!.prefix) throw new RestoreMediaFailure('CONFIGURATION_UNAVAILABLE');
      controller.signal.throwIfAborted();
      if (reasons.length) return result('blocked', reasons);
      const manifest = restoreMediaDigest({ version: 1, storageScopeSha256: scope, snapshotSha256, inventory: second,
        verified: verified.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) });
      const evidence = result('verified', [], manifest);
      this.issued.set(evidence, { manifest, prefix: this.store!.prefix });
      return evidence;
    };
    try { return await Promise.race([execute(), aborted]); }
    catch (error) {
      const reason = controller.signal.aborted ? timedOut ? 'DEADLINE_EXCEEDED' : 'CANCELLED' : error instanceof RestoreMediaFailure ? error.reason : 'STORAGE_UNAVAILABLE';
      return result('unavailable', [reason]);
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', rejectAbort); controller.abort();
    }
  }
  private async snapshot(): Promise<Snapshot> {
    try { return await this.transactions.read(tx => this.repository.snapshot(tx, this.limits.rows)); }
    catch (error) { throw error instanceof RestoreMediaFailure ? error : new RestoreMediaFailure('DATABASE_UNAVAILABLE'); }
  }
  private classify(snapshot: Snapshot) {
    const assets = new Map(snapshot.assets.map(asset => [asset.id, asset]));
    const attempts = new Map(snapshot.attempts.map(attempt => [attempt.object_id, attempt]));
    const objectsByKey = new Map(snapshot.objects.map(object => [object.object_key, object]));
    const revoked = new Set(snapshot.provenance.filter(row => row.disposition === 'REVOKED').map(row => row.asset_id));
    const checkpoints = new Set(snapshot.checkpoints.map(row => row.asset_id));
    const retained = new Map<string, { bytes: number; sha256: string }>();
    const closed = new Set<string>(), pending = new Set<string>(), deletion = new Set<string>(), seen = new Set<string>();
    const ready = new Map<string, Snapshot['objects']>();
    let missingVariants = 0;
    for (const asset of snapshot.assets) {
      if (!['READY', 'DELETED'].includes(asset.state) || (asset.state === 'READY' && (asset.deleted_at || revoked.has(asset.id) || checkpoints.has(asset.id))) ||
        (asset.state === 'DELETED' && asset.reserved_bytes !== 0n)) deletion.add(`asset:${asset.id}`);
      const service = asset.catalog_entry?.approved_at && ['ACTIVE', 'RETIRED'].includes(asset.catalog_entry.status);
      const copy = asset.publication_copy?.publication;
      if (asset.catalog_entry?.status === 'REVOKED' || (copy && (copy.state === 'REVOKED' || copy.source.deleted_at || ['DELETING', 'DELETED'].includes(copy.source.content_owner.status)))) deletion.add(`asset:${asset.id}`);
      const shared = asset.attachments.length || asset.publication_sources.length || ['ACTIVE', 'SUSPENDED'].includes(asset.avatar_profile?.user.status ?? '');
      if (asset.state === 'READY' && !['ACTIVE', 'SUSPENDED'].includes(asset.owner.status) && !service && !shared) deletion.add(`asset:${asset.id}`);
    }
    for (const object of snapshot.objects) {
      if (object.state === 'READY') { const rows = ready.get(object.asset_id) ?? []; rows.push(object); ready.set(object.asset_id, rows); }
      const asset = assets.get(object.asset_id), proof = attempts.get(object.id);
      if (!asset || seen.has(object.object_key)) throw new RestoreMediaFailure('INVALID_DATABASE');
      seen.add(object.object_key);
      try { if (mediaKey(this.store!.prefix, object.asset_id, object.attempt_id, object.variant) !== object.object_key) throw new Error(); }
      catch { throw new RestoreMediaFailure('INVALID_DATABASE'); }
      if (proof && (proof.asset_id !== object.asset_id || proof.attempt_id !== object.attempt_id || proof.object_key !== object.object_key)) throw new RestoreMediaFailure('INVALID_DATABASE');
      if (asset.state === 'READY' && ['READY', 'STORED'].includes(object.state) && object.byte_length !== null && object.byte_length > BigInt(this.limits.objectBytes)) throw new RestoreMediaFailure('LIMIT_EXCEEDED');
      if (proof && (!proof.writer_acknowledged || (proof.delete_observed_at && object.state !== 'DELETED'))) {
        pending.add(object.object_key); deletion.add(`key:${object.object_key}`);
      } else if (object.state === 'DELETED' && proof?.writer_acknowledged && proof.delete_observed_at) closed.add(object.object_key);
      else if (asset.state === 'READY' && !deletion.has(`asset:${asset.id}`) && ['READY', 'STORED'].includes(object.state) &&
        object.byte_length !== null && object.byte_length > 0n && object.byte_length <= BigInt(this.limits.objectBytes) && /^[a-f0-9]{64}$/.test(object.sha256 ?? '')) {
        retained.set(object.object_key, { bytes: Number(object.byte_length), sha256: object.sha256! });
      } else { pending.add(object.object_key); deletion.add(`key:${object.object_key}`); }
    }
    // Provenance is independent of restored FK parents. It cannot disappear
    // from inventory expectations just because an asset/object row is absent.
    for (const proof of snapshot.attempts) {
      try { if (mediaKey(this.store!.prefix, proof.asset_id, proof.attempt_id, proof.object_key.split('/').at(-1)!) !== proof.object_key) throw new Error(); }
      catch { throw new RestoreMediaFailure('INVALID_DATABASE'); }
      const object = objectsByKey.get(proof.object_key);
      if (object && object.id !== proof.object_id) throw new RestoreMediaFailure('INVALID_DATABASE');
      if (!object) {
        if (proof.writer_acknowledged && proof.delete_observed_at) closed.add(proof.object_key);
        else { pending.add(proof.object_key); deletion.add(`key:${proof.object_key}`); }
      }
    }
    for (const row of snapshot.provenance) if (!assets.has(row.asset_id)) deletion.add(`asset:${row.asset_id}`);
    for (const row of snapshot.checkpoints) if (!assets.has(row.asset_id)) deletion.add(`asset:${row.asset_id}`);
    for (const asset of snapshot.assets) if (asset.state === 'READY') {
      if (!['PHOTO', 'AVATAR', 'STICKER', 'VIDEO'].includes(asset.kind)) throw new RestoreMediaFailure('INVALID_DATABASE');
      const variants = asset.kind === 'VIDEO' ? ['video', 'poster'] : ['image'];
      const rows = ready.get(asset.id) ?? [];
      if (rows.some(row => !variants.includes(row.variant))) throw new RestoreMediaFailure('INVALID_DATABASE');
      for (const variant of variants) {
        const count = rows.filter(row => row.variant === variant).length;
        if (count > 1) throw new RestoreMediaFailure('INVALID_DATABASE');
        if (!count) missingVariants++;
      }
      if (asset.kind === 'VIDEO' && new Set(rows.map(row => row.attempt_id)).size > 1) throw new RestoreMediaFailure('INVALID_DATABASE');
    }
    return { retained, closed, pending, deletion, missingVariants };
  }
  private async inventory(signal: AbortSignal): Promise<RestoreInventoryObject[]> {
    const objects: RestoreInventoryObject[] = [], cursors = new Set<string>();
    let cursor: string | null = null, previous = '';
    for (let page = 0; page < this.limits.pages; page++) {
      signal.throwIfAborted();
      const result = await this.store!.list(cursor, signal);
      if (!Array.isArray(result.objects) || result.objects.length > 1000 || (result.next !== null && (typeof result.next !== 'string' || !result.next || result.next.length > 2048 || cursors.has(result.next)))) throw new RestoreMediaFailure('STORAGE_UNAVAILABLE');
      for (const object of result.objects) {
        if (typeof object.key !== 'string' || !object.key.startsWith(`${this.store!.prefix}/`) || object.key <= previous || object.key.length > 1024 ||
          !Number.isSafeInteger(object.bytes) || object.bytes < 0 || typeof object.etag !== 'string' || !object.etag || object.etag.length > 256 ||
          typeof object.modified !== 'string' || !Number.isFinite(Date.parse(object.modified))) throw new RestoreMediaFailure('STORAGE_UNAVAILABLE');
        previous = object.key; objects.push(object);
        if (objects.length > this.limits.objects) throw new RestoreMediaFailure('LIMIT_EXCEEDED');
      }
      if (result.next === null) return objects;
      cursors.add(result.next); cursor = result.next;
    }
    throw new RestoreMediaFailure('LIMIT_EXCEEDED');
  }
  private async read(key: string, expectedBytes: number, signal: AbortSignal) {
    const response = await this.store!.read(key, signal);
    const abort = () => response.stream.destroy(new Error('restore_media_aborted'));
    signal.addEventListener('abort', abort, { once: true });
    let bytes = 0;
    const hash = createHash('sha256');
    try {
      signal.throwIfAborted();
      if (response.bytes !== expectedBytes || !Number.isSafeInteger(response.bytes) || response.bytes > this.limits.objectBytes || typeof response.etag !== 'string') throw new RestoreMediaFailure('STORAGE_UNAVAILABLE');
      for await (const chunk of response.stream) {
        signal.throwIfAborted();
        if (!(chunk instanceof Uint8Array)) throw new RestoreMediaFailure('STORAGE_UNAVAILABLE');
        bytes += chunk.byteLength;
        if (bytes > expectedBytes || bytes > this.limits.objectBytes) throw new RestoreMediaFailure('LIMIT_EXCEEDED');
        hash.update(chunk);
      }
      return { bytes, sha256: hash.digest('hex'), etag: response.etag };
    } finally { signal.removeEventListener('abort', abort); response.stream.destroy(); }
  }
}
export type { RestoreMediaEvidence } from './restore-media.types.js';
