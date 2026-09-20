import { Inject, Injectable } from '@nestjs/common';
import { MediaWorkerRepository } from './media-worker.repository.js';
import { JobsCoreService } from '../jobs/jobs-core.service.js';
import { AccessService } from '../access/access.service.js';
import { MEDIA_STORE, MEDIA_PREFIX, MEDIA_DECODER } from './media.tokens.js';
import { randomUUID } from 'node:crypto';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import { ApiError, digest } from '../../modules/auth/auth-primitives.js';
import { JobFailure } from '../../modules/jobs/jobs.service.js';
import type { JobLease } from '../../modules/jobs/jobs.policy.js';
import { mediaKey } from './adapters/media-store.js';
import type { MediaStore } from './adapters/media-store.js';
import type { ImageDecoder, DecodedMedia } from './adapters/media-decoder-client.js';
import { parseMediaIntent } from '../../common/media/media-policy.js';
import type { MediaIntent } from '../../common/media/media-policy.js';

class StaleMediaLease extends Error {}

interface TransformAttempt { assetId: string; objectId: string; key: string; inputKey: string; input: MediaIntent }

@Injectable()
export class MediaWorkerService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions, @Inject(MEDIA_STORE) private readonly store: MediaStore, @Inject(MEDIA_DECODER) private readonly decoder: ImageDecoder, @Inject(MEDIA_PREFIX) private readonly prefix: string, @Inject(MediaWorkerRepository) private readonly repository: MediaWorkerRepository, @Inject(JobsCoreService) private readonly jobs: JobsCoreService, @Inject(AccessService) private readonly access: AccessService) {}
  private async finish(tx: Transaction, lease: JobLease): Promise<void> { if (!await this.jobs.complete(tx, lease)) throw new StaleMediaLease(); }
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
    if (['READY', 'DELETED'].includes(String(asset.state))) { await this.finish(tx, lease); return 'completed'; }
    let allowed = owner.status === 'ACTIVE' && owner.linked === 'VERIFIED';
    if (allowed && asset.room_id) {
      try { await this.access.requireActiveMember(tx, String(asset.room_id), String(asset.owner_user_id)); }
      catch (error) { if (!(error instanceof ApiError) || error.code !== 'NOT_FOUND') throw error; allowed = false; }
    }
    if (!allowed || asset.deleted_at || asset.state === 'DELETING') {
      await this.repository.block(tx, asset.id);
      return 'cleanup';
    }
    if (asset.state !== 'PROCESSING') throw new JobFailure('SOURCE_UNAVAILABLE');
    const input = parseMediaIntent({ kind: asset.kind, contentType: asset.content_type, byteLength: Number(asset.declared_bytes) }, { canRegisterStickers: true });
    if (input.kind === 'VIDEO') throw new JobFailure('INVALID_RESOURCE', true); // M09 owns video decoding.
    const originals = await this.repository.originals(tx, asset.id);
    if (originals.length !== 1) throw new JobFailure('INVALID_RESOURCE', true);
    // Every retry has an immutable key. Reserve another full output cap before another PUT.
    const previous = await this.repository.attempts(tx, asset.id);
    if (previous.length) {
      const extra = (input.kind === 'AVATAR' ? 2 : input.kind === 'STICKER' ? 1 : 10) * 1024 * 1024;
      const changed = await this.repository.reserveRetry(tx, extra, extra);
      if (!changed.affectedRows) throw new JobFailure('TEMPORARY_UNAVAILABLE');
      await this.repository.reserveAssetRetry(tx, extra, asset.id);
    }
    const objectId = randomUUID(), attempt = randomUUID(), key = mediaKey(this.prefix, String(asset.id), attempt, 'image');
    await this.repository.allocate(tx, objectId, asset.id, attempt, key);
    // Lock/check the job last. The finalization repeats this fence after external I/O.
    const current = await this.repository.fence(tx, lease.id, lease.generation.toString(), lease.leaseOwner, lease.leaseToken);
    if (!current.length) throw new StaleMediaLease();
    return { assetId: String(asset.id), objectId, key, inputKey: String(originals[0]!.object_key), input };
  }
  private async finalizeMedia(tx: Transaction, lease: JobLease, attempt: TransformAttempt, decoded: DecodedMedia) {
    const { asset, owner } = await this.assetLock(tx, attempt.assetId);
    if (asset.state !== 'PROCESSING' || asset.deleted_at || owner.status !== 'ACTIVE' || owner.linked !== 'VERIFIED') throw new JobFailure('SOURCE_UNAVAILABLE');
    if (asset.room_id) await this.access.requireActiveMember(tx, String(asset.room_id), String(asset.owner_user_id));
    const changed = await this.repository.readyObject(tx, decoded.file.bytes, decoded.file.sha256, decoded.width, decoded.height, attempt.objectId, asset.id);
    if (changed.affectedRows !== 1) throw new JobFailure('INVALID_RESOURCE', true);
    await this.repository.readyAsset(tx, asset.id);
    await this.finish(tx, lease);
  }
  private async cleanupMedia(lease: JobLease, signal: AbortSignal) {
    const plan = await this.transactions.write(async tx => {
      const { asset } = await this.assetLock(tx, lease.resourceId!);
      if (asset.state !== 'DELETING') throw new JobFailure('SOURCE_UNAVAILABLE');
      // Wait beyond both the upload lease and every transform attempt's hard timeout.
      // This prevents a late timed-out PUT from recreating an object after quota was released.
      const uploading = await this.repository.uploading(tx, asset.id);
      const recent = await this.repository.recentAttempts(tx, asset.id);
      if (uploading.length || recent.length) {
        await this.jobs.enqueue(tx, { purpose: 'MEDIA', resourceId: String(asset.id), delayMs: 20 * 60 * 1000, dedupeKey: digest(`media-cleanup-deferred:${asset.id}:${lease.id}`) });
        await this.finish(tx, lease); return null;
      }
      const objects = await this.repository.objects(tx, asset.id);
      return objects.map(row => ({ id: String(row.id), key: String(row.object_key) }));
    });
    if (!plan) return;
    for (const object of plan) await this.store.remove(object.key, signal);
    await this.transactions.write(async tx => {
      const { asset } = await this.assetLock(tx, lease.resourceId!);
      if (asset.state !== 'DELETING') throw new JobFailure('SOURCE_UNAVAILABLE');
      const objects = await this.repository.currentObjects(tx, asset.id);
      if (objects.length !== plan.length || objects.some(row => !plan.some(item => item.id === row.id))) throw new JobFailure('SOURCE_UNAVAILABLE');
      await this.repository.deleteObjects(tx, asset.id);
      const changed = await this.repository.releaseBudget(tx, asset.reserved_bytes, asset.reserved_bytes);
      if (changed.affectedRows !== 1) throw new JobFailure('INVALID_RESOURCE', true);
      await this.repository.deleteAsset(tx, asset.id);
      await this.finish(tx, lease);
    });
  }
  async processMedia(lease: JobLease): Promise<'completed' | 'lease_lost'> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 240000);
    let decoded: DecodedMedia | undefined;
    try {
      const attempt = await this.transactions.write(tx => this.prepareMedia(tx, lease));
      if (attempt === 'completed') return 'completed';
      if (attempt === 'cleanup') { await this.cleanupMedia(lease, controller.signal); return 'completed'; }
      const input = await this.store.read(attempt.inputKey, controller.signal);
      if (input.bytes !== attempt.input.byteLength) { input.stream.destroy(); throw new JobFailure('INVALID_RESOURCE', true); }
      decoded = await this.decoder.decode(input.stream, attempt.input, controller.signal);
      await this.store.put(attempt.key, decoded.file.path, decoded.file.bytes, decoded.contentType, controller.signal);
      const result = decoded;
      await this.transactions.write(tx => this.finalizeMedia(tx, lease, attempt, result));
      return 'completed';
    } catch (error) { if (error instanceof StaleMediaLease) return 'lease_lost'; throw error; }
    finally { clearTimeout(timeout); await decoded?.file.dispose(); }
  }

  // Bounded restart recovery. No storage I/O inside the transaction; cleanup remains a fenced job.
  async recoverMedia(tx: Transaction): Promise<void> {
    const assets = await this.repository.recoverable(tx);
    const [time] = await this.repository.epoch(tx);
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
      await this.jobs.enqueue(tx, { purpose: 'MEDIA', resourceId: String(asset.id), dedupeKey: digest(`media-recovery:${asset.id}:${time!.epoch}`) });
    }
  }

}
