import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { readMelomingGatewayConfig } from './meloming-gateway-config.js';

/** Original Meloming gateway callback signature and video-id cache upsert. */
@Injectable()
export class MelomingVideoCacheService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions) {}

  async upsert(timestamp: string | undefined, signature: string | undefined, value: unknown): Promise<void> {
    const config = readMelomingGatewayConfig();
    if (!config) throw new ServiceUnavailableException('Media gateway is not configured');
    if (!timestamp || !signature || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) {
      throw new UnauthorizedException('Invalid callback signature');
    }
    const ts = Number(timestamp);
    if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) throw new UnauthorizedException('Expired callback');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid callback body');
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !['videoId','r2Key','size','contentType'].includes(key)) ||
        typeof body.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(body.videoId) ||
        body.r2Key !== `youtube/${body.videoId}/itag18.mp4` ||
        (body.size !== undefined && body.size !== null && (!Number.isSafeInteger(body.size) || Number(body.size) < 1)) ||
        (body.contentType !== undefined && body.contentType !== null &&
          (typeof body.contentType !== 'string' || body.contentType.length > 100))) {
      throw new BadRequestException('Invalid callback body');
    }
    const canonical = `${timestamp}|${body.videoId}|${body.r2Key}|${body.size == null ? '' : body.size}|${body.contentType ?? ''}`;
    const expected = createHmac('sha256', config.callbackSecret).update(canonical).digest();
    const provided = Buffer.from(signature, 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid callback signature');
    }
    await this.transactions.write(tx => tx.prisma.videoCacheEntry.upsert({
      where: { videoId: body.videoId as string },
      update: { r2Key: body.r2Key as string, cachedAt: new Date() },
      create: { videoId: body.videoId as string, r2Key: body.r2Key as string, itag: '18', source: 'youtube' },
    }));
  }
}
