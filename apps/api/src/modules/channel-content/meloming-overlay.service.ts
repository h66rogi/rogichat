import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { OverlayService } from './upstream/overlay/overlay.service.js';

@Injectable()
export class MelomingOverlayService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  get(token: string) {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      return new OverlayService(tx.prisma, roomId).getOverlayData(token);
    });
  }
}
