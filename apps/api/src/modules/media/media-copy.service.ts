import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { MediaSpooler } from '../../common/media/media-spool.js';
import type { SpooledMedia } from '../../common/media/media-spool.js';
import { PublicationsCoreService } from '../publications/publications-core.service.js';
import type { JobLease } from '../jobs/jobs.policy.js';
import { JobFailure } from '../jobs/jobs.service.js';
import { MEDIA_STORE, MEDIA_PREFIX } from './media.tokens.js';
import type { MediaStore } from './adapters/media-store.js';

@Injectable()
export class MediaCopyService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(MEDIA_STORE) private readonly store: MediaStore,
    @Inject(MEDIA_PREFIX) private readonly prefix: string,
    @Inject(MediaSpooler) private readonly spool: MediaSpooler,
    @Inject(PublicationsCoreService) private readonly publications: PublicationsCoreService) {}

  async processPublication(lease: JobLease): Promise<'completed' | 'lease_lost'> {
    const controller = new AbortController();
    // Shorter than the five-minute worker lease and the existing ten-minute
    // recent-attempt / twenty-minute deferred cleanup protection.
    const timeout = setTimeout(() => controller.abort(), 240000);
    try {
      const plan = await this.transactions.write(tx => this.publications.preparePhoto(tx, lease, this.prefix));
      if (plan === 'completed') return 'completed';
      if (plan === 'text') return this.publications.publishText(this.transactions, lease);
      for (const attempt of plan) {
        controller.signal.throwIfAborted();
        const source = await this.store.read(attempt.object_key, controller.signal);
        if (source.bytes !== Number(attempt.byte_length)) { source.stream.destroy(); throw new JobFailure('INVALID_RESOURCE', true); }
        let file: SpooledMedia | undefined;
        try {
          file = await this.spool.receive(source.stream, { id: attempt.objectId, maxBytes: 10 * 1024 * 1024, expectedBytes: source.bytes, signal: controller.signal });
          if (file.sha256 !== attempt.sha256) throw new JobFailure('INVALID_RESOURCE', true);
          await this.store.put(attempt.key, file.path, file.bytes, 'image/webp', controller.signal);
        } finally { source.stream.destroy(); await file?.dispose(); }
      }
      controller.signal.throwIfAborted();
      await this.transactions.write(tx => this.publications.finalizePhoto(tx, lease, plan));
      return 'completed';
    } catch (error) {
      if (this.publications.isStaleLease(error)) return 'lease_lost';
      throw error;
    } finally { clearTimeout(timeout); }
  }
}
