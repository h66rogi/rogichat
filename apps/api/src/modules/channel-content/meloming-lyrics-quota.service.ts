import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import { ChannelContentRepository } from './channel-content.repository.js';

const SETTINGS_ID = 1;
const WINDOW_DAYS = 7 as const;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

type QuotaWindow = { windowStartedAt: Date | null; windowEndsAt: Date | null; usedCount: number };
type LyricsQuotaStatus = {
  userId: string; channelId: number; tier: 'FREE'; limit: number | null;
  unlimited: boolean; used: number; remaining: number | null;
  windowStartedAt: string | null; windowEndsAt: string | null; windowDays: 7;
};

/** Retains Meloming's per-playing-request seven-day ledger and unlimited-by-default setting. */
@Injectable()
export class MelomingLyricsQuotaService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  consumeForLyrics(params: { roomId: string; liveSessionId?: number; songRequestId?: number; songId: number }) {
    return this.transactions.write(async tx => {
      const context = await tx.prisma.songRequest.findFirst({
        where: { ...(params.songRequestId !== undefined ? { id: params.songRequestId } : {}),
          ...(params.liveSessionId !== undefined ? { liveSessionId: params.liveSessionId } : {}), songId: params.songId,
          status: 'PLAYING', liveSession: { channelId: params.roomId, status: 'ACTIVE' } },
        select: { id: true, liveSession: { select: { id: true, channelId: true, userId: true } } },
        orderBy: { id: 'desc' },
      });
      if (!context) throw new NotFoundException('가사 이용량을 기록할 신청곡 컨텍스트를 찾을 수 없습니다.');

      const userId = context.liveSession.userId;
      const channelId = context.liveSession.channelId;
      const liveSessionId = context.liveSession.id;
      const songRequestId = context.id;
      const now = await tx.now();

      await tx.prisma.lyricsQuotaWindow.upsert({ where: { userId }, create: { userId }, update: {} });
      const row = await this.repository.lockLyricsQuotaWindow(tx, userId);
      if (!row) throw new Error('Lyrics quota window lock failed');

      const already = await tx.prisma.lyricsQuotaConsumption.findUnique({
        where: { channelId_liveSessionId_songRequestId: { channelId, liveSessionId, songRequestId } },
        select: { id: true },
      });
      const settings = await tx.prisma.lyricsQuotaSettings.findUnique({
        where: { id: SETTINGS_ID }, select: { freeLimit: true },
      });
      const limit = settings?.freeLimit ?? null;
      let window: QuotaWindow = {
        windowStartedAt: row.window_started_at,
        windowEndsAt: row.window_ends_at,
        usedCount: Number(row.used_count),
      };

      if (already) {
        const activeWindow = window.windowEndsAt && window.windowEndsAt > now
          ? window : { windowStartedAt: null, windowEndsAt: null, usedCount: 0 };
        return { ...this.toStatus(userId, limit, activeWindow), allowed: true, consumed: false, alreadyConsumed: true };
      }

      const hasActiveWindow = window.windowEndsAt !== null && window.windowEndsAt > now;
      if (!hasActiveWindow && limit === 0) {
        const emptyWindow = { windowStartedAt: null, windowEndsAt: null, usedCount: 0 };
        return { ...this.toStatus(userId, limit, emptyWindow), allowed: false, consumed: false, alreadyConsumed: false };
      }
      if (!hasActiveWindow) {
        window = { windowStartedAt: now, windowEndsAt: new Date(now.getTime() + WINDOW_MS), usedCount: 0 };
      }
      if (limit !== null && window.usedCount >= limit) {
        await tx.prisma.lyricsQuotaWindow.update({ where: { userId }, data: window });
        return { ...this.toStatus(userId, limit, window), allowed: false, consumed: false, alreadyConsumed: false };
      }

      const nextWindow = { ...window, usedCount: window.usedCount + 1 };
      await tx.prisma.lyricsQuotaConsumption.create({ data: {
        userId, channelId, liveSessionId, songRequestId, windowStartedAt: window.windowStartedAt as Date,
      } });
      await tx.prisma.lyricsQuotaWindow.update({ where: { userId }, data: nextWindow });
      return { ...this.toStatus(userId, limit, nextWindow), allowed: true, consumed: true, alreadyConsumed: false };
    });
  }

  private toStatus(userId: string, limit: number | null, window: QuotaWindow): LyricsQuotaStatus {
    return { userId, channelId: 1, tier: 'FREE', limit, unlimited: limit === null,
      used: window.usedCount, remaining: limit === null ? null : Math.max(0, limit - window.usedCount),
      windowStartedAt: window.windowStartedAt?.toISOString() ?? null,
      windowEndsAt: window.windowEndsAt?.toISOString() ?? null, windowDays: WINDOW_DAYS };
  }
}
