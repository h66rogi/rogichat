import { Controller, Get, Header, Inject, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { OverlayService } from './upstream/overlay/overlay.service.js';

@ApiTags('Overlay/Meloming compatibility')
@Controller('v1/overlay')
export class MelomingOverlayController {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  @Get(':token')
  @Header('Cache-Control', 'no-store, must-revalidate')
  get(@Param('token') token: string) {
    return this.transactions.write(async tx => {
      const { roomId } = await this.repository.primary(tx);
      return new OverlayService(tx.prisma, roomId).getOverlayData(token);
    });
  }
}
