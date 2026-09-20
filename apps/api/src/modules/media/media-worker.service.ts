import { MediaWriteProofService } from './media-write-proof.service.js';
import { Inject, Injectable } from '@nestjs/common';
import { MediaWorkerRepository, acknowledgedWrite } from './media-worker.repository.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import { AccessService } from '../access/access.service.js';
import { MessagesCoreService } from '../messages/messages-core.service.js';
import { MEDIA_STORE, MEDIA_PREFIX, MEDIA_DECODER } from './media.tokens.js';
import type { Readable } from 'node:stream';
import { parseDecoderResponse } from '../../common/media/media-decoder-protocol.js';
import { randomUUID } from 'node:crypto';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError, digest } from '../../modules/auth/auth-primitives.js';
import { JobFailure } from '../../modules/jobs/jobs.service.js';
import type { JobLease } from '../../modules/jobs/jobs.policy.js';
import { mediaKey } from './adapters/media-store.js';
import type { MediaStore } from './adapters/media-store.js';
import type { ImageDecoder, VideoDecoder, DecodedVideoMedia, DecodedMedia } from './adapters/media-decoder-client.js';
import { parseMediaIntent } from '../../common/media/media-policy.js';
import type { MediaIntent } from '../../common/media/media-policy.js';

class StaleMediaLease extends Error {}
async function disposeOutputs(decoded: DecodedMedia | DecodedVideoMedia | undefined): Promise<void> {
  const outputs = decoded?.kind === 'VIDEO' ? [decoded.video.file, decoded.poster.file] : decoded ? [decoded.file] : [];
  const disposed = await Promise.allSettled(outputs.map(async file => file.dispose()));
  if (disposed.some(result => result.status === 'rejected')) throw new Error('media_cleanup');
}

interface TransformAttempt { assetId: string; objectId: string; key: string; inputKey: string; input: MediaIntent; poster: { objectId: string; key: string } | undefined }

@Injectable()
export class MediaWorkerService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions, @Inject(MEDIA_STORE) private readonly store: MediaStore, @Inject(MEDIA_DECODER) private readonly decoder: ImageDecoder & VideoDecoder, @Inject(MEDIA_PREFIX) private readonly prefix: string, @Inject(MediaWorkerRepository) private readonly repository: MediaWorkerRepository, @Inject(JobsCoreService) private readonly jobs: JobsCoreService, @Inject(AccessService) private readonly access: AccessService, @Inject(MessagesCoreService) private readonly messages: MessagesCoreService, @Inject(MediaWriteProofService) private readonly writes: MediaWriteProofService) {}
  private async finish(tx: Transaction, lease: JobLease): Promise<void> {
    if (!(await this.repository.fence(tx, lease)).length || !await this.jobs.complete(tx, lease)) throw new StaleMediaLease();
  }
  private async assetLock(tx: Transaction, assetId: string) {
    const [reference] = await this.repository.reference(tx, assetId);
    if (!reference) throw new JobFailure('INVALID_RESOURCE', true);
    const [owner] = await this.repository.lockOwner(tx, reference.owner_user_id);
    const [asset] = await this.repository.lockAsset(tx, assetId);
    return { asset: asset!, owner: owner! };
  }
  async prepareMedia(tx: Transaction, lease: JobLease): Promise<TransformAttempt | 'cleanup' | 'completed'> {
    if (lease.purpose !== 'MEDIA' || !lease.resourceId) throw new JobFailure('INVALID_RESOURCE', true);
    const { asset, owner } = await this.assetLock(tx, lease.resourceId);
    if (asset.state === 'DELETED') {
      const objects = await this.repository.currentObjects(tx, asset.id);
      if (objects.length > 500 || objects.some(row => row.state !== 'DELETED' || !acknowledgedWrite(row) || (row.cleanup_proof_id && !row.delete_observed_at))) {
        // Old cleanup may have refunded quota without writer termination proof.
        // Recover the key obligation; never invent the lost historical charge.
        await this.repository.block(tx, asset.id);
        if (!(await this.repository.fence(tx, lease)).length) throw new StaleMediaLease();
        return 'cleanup';
      }
      await this.finish(tx, lease); return 'completed';
    }
    if (asset.state === 'READY') { await this.finish(tx, lease); return 'completed'; }
    // Deletion needs no membership grant. Do not acquire a room lock after
    // owner/asset locks: publication and message deletion lock room before assets.
    if (asset.state === 'DELETING') return 'cleanup';
    let allowed = owner.status === 'ACTIVE' && owner.linked === 'VERIFIED';
    if (allowed && asset.room_id) {
      try { await this.access.requireActiveMember(tx, String(asset.room_id), String(asset.owner_user_id)); }
      catch (error) { if (!(error instanceof ApiError) || error.code !== 'NOT_FOUND') throw error; allowed = false; }
    }
    if (!allowed || asset.deleted_at || asset.state === 'DELETING') {
      await this.repository.block(tx, asset.id);
      if (!(await this.repository.fence(tx, lease)).length) throw new StaleMediaLease();
      return 'cleanup';
    }
    if (asset.state !== 'PROCESSING') throw new JobFailure('SOURCE_UNAVAILABLE');
    const input = parseMediaIntent({ kind: asset.kind, contentType: asset.content_type, byteLength: Number(asset.declared_bytes) }, { canRegisterStickers: true });
    const originals = await this.repository.originals(tx, asset.id);
    if (originals.length !== 1) throw new JobFailure('INVALID_RESOURCE', true);
    // Every retry has an immutable key. Reserve another full output cap before another PUT.
    const previous = await this.repository.attempts(tx, asset.id);
    if (previous.length) {
      const extra = (input.kind === 'VIDEO' ? 52 : input.kind === 'AVATAR' ? 2 : input.kind === 'STICKER' ? 1 : 10) * 1024 * 1024;
      const changed = await this.repository.reserveRetry(tx, extra, extra);
      if (!changed.affectedRows) throw new JobFailure('TEMPORARY_UNAVAILABLE');
      await this.repository.reserveAssetRetry(tx, extra, asset.id);
    }
    const objectId = randomUUID(), attempt = randomUUID(), key = mediaKey(this.prefix, String(asset.id), attempt, input.kind === 'VIDEO' ? 'video' : 'image');
    await this.repository.allocate(tx, objectId, asset.id, attempt, key, input.kind === 'VIDEO' ? 'video' : 'image');
    const poster = input.kind === 'VIDEO' ? { objectId: randomUUID(), key: mediaKey(this.prefix, String(asset.id), attempt, 'poster') } : undefined;
    if (poster) await this.repository.allocate(tx, poster.objectId, asset.id, attempt, poster.key, 'poster');
    // Lock/check the job last. The finalization repeats this fence after external I/O.
    const current = await this.repository.fence(tx, lease);
    if (!current.length) throw new StaleMediaLease();
    return { assetId: String(asset.id), objectId, key, inputKey: String(originals[0]!.object_key), input, poster };
  }
  private async finalizeMedia(tx: Transaction, lease: JobLease, attempt: TransformAttempt, decoded: DecodedMedia | DecodedVideoMedia) {
    const { asset, owner } = await this.assetLock(tx, attempt.assetId);
    if (asset.state !== 'PROCESSING' || asset.deleted_at || owner.status !== 'ACTIVE' || owner.linked !== 'VERIFIED') throw new JobFailure('SOURCE_UNAVAILABLE');
    if (asset.room_id) await this.access.requireActiveMember(tx, String(asset.room_id), String(asset.owner_user_id));
    const output = decoded.kind === 'VIDEO' ? decoded.video : decoded;
    const changed = await this.repository.readyObject(tx, output.file.bytes, output.file.sha256, output.width, output.height, attempt.objectId, asset.id, decoded.kind === 'VIDEO' ? decoded.video.durationMs : null);
    if (decoded.kind === 'VIDEO') {
      if (!attempt.poster) throw new JobFailure('INVALID_RESOURCE', true);
      const poster = decoded.poster;
      const saved = await this.repository.readyObject(tx, poster.file.bytes, poster.file.sha256, poster.width, poster.height, attempt.poster.objectId, asset.id);
      if (saved.affectedRows !== 1) throw new JobFailure('INVALID_RESOURCE', true);
    }
    if (changed.affectedRows !== 1) throw new JobFailure('INVALID_RESOURCE', true);
    await this.repository.readyAsset(tx, asset.id);
    await this.finish(tx, lease);
  }
  private async cleanupMedia(lease: JobLease, signal: AbortSignal) {
    const plan = await this.transactions.write(async tx => {
      const { asset } = await this.assetLock(tx, lease.resourceId!);
      if (asset.state !== 'DELETING') throw new JobFailure('SOURCE_UNAVAILABLE');
      const page = await this.repository.cleanupPage(tx, String(asset.id));
      if (!(await this.repository.fence(tx, lease)).length) throw new StaleMediaLease();
      return page;
    });
    // Even unacknowledged attempts get a best-effort DELETE, but never closure.
    for (const object of plan) await this.store.remove(object.object_key, signal);
    return this.transactions.write(async tx => {
      const { asset } = await this.assetLock(tx, lease.resourceId!);
      if (asset.state !== 'DELETING') throw new JobFailure('SOURCE_UNAVAILABLE');
      const closed = await this.repository.finishPage(tx, String(asset.id), plan);
      if (!closed) { await this.jobs.continueMedia(tx, lease, plan.length > 0); return plan.length ? 'progress' as const : 'deferred' as const; }
      if (BigInt(String(asset.reserved_bytes)) > 0n) {
        const changed = await this.repository.releaseBudget(tx, asset.reserved_bytes, asset.reserved_bytes);
        if (changed.affectedRows !== 1) throw new JobFailure('INVALID_RESOURCE', true);
      }
      await this.repository.deleteAsset(tx, asset.id);
      await this.finish(tx, lease);
      return 'completed' as const;
    });
  }
  async processMedia(lease: JobLease): Promise<'completed' | 'lease_lost' | 'progress' | 'deferred'> {
    // Includes GET, decoder transport and both PUTs. This bounds the caller;
    // timeout alone is never storage-writer termination proof.
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 450000);
    let decoded: DecodedMedia | DecodedVideoMedia | undefined;
    let source: Readable | undefined;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    let renewal: Promise<void> | undefined;
    let stopped = false, leaseLost = false;
    // WorkerLoop does not heartbeat handlers. Renew in a separate job-only
    // transaction, never while holding domain locks, and fail closed on unknown
    // renewal outcomes. Self-scheduling prevents overlapping renewals.
    const renew = async () => {
      try {
        const changed = await this.transactions.write(tx => this.repository.renew(tx, lease.id, lease.generation.toString(), lease.leaseOwner, lease.leaseToken));
        if (changed.affectedRows !== 1) throw new StaleMediaLease();
      } catch { leaseLost = true; controller.abort(); }
    };
    const schedule = () => {
      if (stopped || controller.signal.aborted) return;
      heartbeat = setTimeout(() => { renewal = renew().finally(schedule); }, 30_000);
      heartbeat.unref();
    };
    try {
      if (lease.purpose !== 'MEDIA' || !lease.resourceId) throw new JobFailure('INVALID_RESOURCE', true);
      await renew();
      if (leaseLost) return 'lease_lost';
      schedule();
      // Run before asset-owner locks and before the DELETED early return. Large
      // revocations fan out in durable, fenced one-room batches without an asset
      // -> room lock inversion or relying on a live worker's memory.
      const invalidated = await this.transactions.write(async tx => {
        const progress = await this.messages.invalidateRevokedSticker(tx, lease.resourceId!);
        if (!progress) return false;
        await this.jobs.enqueue(tx, { purpose: 'MEDIA', resourceId: lease.resourceId!, dedupeKey: digest(`sticker-invalidation:${lease.resourceId}:${progress}`) });
        await this.finish(tx, lease);
        return true;
      });
      if (invalidated) return 'completed';
      const attempt = await this.transactions.write(tx => this.prepareMedia(tx, lease));
      if (attempt === 'completed') return 'completed';
      if (attempt === 'cleanup') return await this.cleanupMedia(lease, controller.signal);
      const input = await this.store.read(attempt.inputKey, controller.signal);
      source = input.stream;
      controller.signal.throwIfAborted();
      if (input.bytes !== attempt.input.byteLength) { input.stream.destroy(); throw new JobFailure('INVALID_RESOURCE', true); }
      decoded = attempt.input.kind === 'VIDEO'
        ? await this.decoder.decodeVideo(input.stream, attempt.input, controller.signal)
        : await this.decoder.decode(input.stream, attempt.input, controller.signal);
      if (decoded.kind === 'VIDEO') {
        const { video, poster } = decoded;
        parseDecoderResponse({ version: 1, kind: 'VIDEO', variants: [
          { role: video.role, contentType: video.contentType, byteLength: video.file.bytes, width: video.width, height: video.height, durationMs: video.durationMs },
          { role: poster.role, contentType: poster.contentType, byteLength: poster.file.bytes, width: poster.width, height: poster.height },
        ] }, attempt.input);
        if (!Number.isSafeInteger(video.durationMs) || !attempt.poster || [video.file, poster.file].some(file => !/^[a-f0-9]{64}$/.test(file.sha256))) throw new JobFailure('INVALID_RESOURCE', true);
        controller.signal.throwIfAborted();
        await this.store.put(attempt.key, video.file.path, video.file.bytes, video.contentType, controller.signal);
        await this.transactions.write(tx => this.writes.acknowledge(tx, attempt.assetId, attempt.objectId, attempt.key));
        controller.signal.throwIfAborted();
        await this.store.put(attempt.poster.key, poster.file.path, poster.file.bytes, poster.contentType, controller.signal);
        const output = attempt.poster;
        await this.transactions.write(tx => this.writes.acknowledge(tx, attempt.assetId, output.objectId, output.key));
      } else {
        if (attempt.input.kind === 'VIDEO') throw new JobFailure('INVALID_RESOURCE', true);
        controller.signal.throwIfAborted();
        await this.store.put(attempt.key, decoded.file.path, decoded.file.bytes, decoded.contentType, controller.signal);
        await this.transactions.write(tx => this.writes.acknowledge(tx, attempt.assetId, attempt.objectId, attempt.key));
      }
      controller.signal.throwIfAborted();
      const result = decoded;
      await this.transactions.write(tx => this.finalizeMedia(tx, lease, attempt, result));
      return 'completed';
    } catch (error) { if (leaseLost || error instanceof StaleMediaLease || (error instanceof Error && error.message === 'media_cleanup_lease_lost')) return 'lease_lost'; throw error; }
    finally {
      stopped = true; clearTimeout(timeout); clearTimeout(heartbeat); source?.destroy();
      await renewal;
      await disposeOutputs(decoded);
    }
  }

  // Bounded restart recovery. No storage I/O inside the transaction; cleanup remains a fenced job.
  async recoverMedia(tx: Transaction): Promise<void> {
    const assets = await this.repository.recoverable(tx);
    for (const asset of assets) {
      // Attachment commands lock the asset before installing a reference. Re-read references
      // using current locking reads after our asset lock, not an earlier consistent snapshot.
      // Explicitly DELETING assets must still be purged even if historical links remain.
      const [current] = await this.repository.currentState(tx, asset.id);
      if (current?.state === 'READY') {
        const attachments = await this.repository.attachments(tx, asset.id);
        const avatars = await this.repository.avatars(tx, asset.id);
        const catalog = await this.repository.catalog(tx, asset.id);
        const copies = await this.repository.copies(tx, asset.id);
        if (attachments.length || avatars.length || catalog.length || copies.length) continue;
      }
      await this.repository.blockRecovery(tx, asset.id);
      await this.jobs.enqueue(tx, { purpose: 'MEDIA', resourceId: String(asset.id), dedupeKey: digest(`media-cleanup:${asset.id}`) });
      await this.jobs.recoverMedia(tx, String(asset.id));
    }
  }

}
