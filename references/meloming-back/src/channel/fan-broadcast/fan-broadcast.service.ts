import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FavoritesService } from '../../favorites/favorites.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/constants/notification-types';
import { isProSubscriberActive } from '../customization/utils/pro-subscription.util';
import { FanBroadcastQuotaService } from './fan-broadcast-quota.service';

const FAVORITES_PAGE_SIZE = 500;

export interface SendBroadcastParams {
  channelId: number;
  ownerUserId: number;
  title: string;
  body: string;
  url?: string;
}

@Injectable()
export class FanBroadcastService {
  private readonly logger = new Logger(FanBroadcastService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly favoritesService: FavoritesService,
    private readonly notificationsService: NotificationsService,
    private readonly quotaService: FanBroadcastQuotaService,
  ) {}

  async sendBroadcast(params: SendBroadcastParams) {
    const { channelId, ownerUserId, title, body, url } = params;
    const now = new Date();

    const isPro = await isProSubscriberActive(this.prisma, ownerUserId);
    const limit = this.quotaService.getLimit(isPro);

    // Atomic INCR — 이후 모든 실패 경로에서 반드시 rollback 되도록 try/catch 로 래핑.
    const used = await this.quotaService.incrementAndGetCount(ownerUserId, now);

    try {
      if (used > limit) {
        throw new HttpException(
          {
            message: `오늘 발송 가능한 팬 알림 횟수를 모두 사용했습니다. (한도 ${limit}회/일${isPro ? ' · PRO' : ''})`,
            code: 'FAN_BROADCAST_QUOTA_EXCEEDED',
            limit,
            used: limit,
            isPro,
            resetAt: this.quotaService.getResetAt(now).toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { id: true, webPath: true, name: true },
      });
      if (!channel) {
        throw new NotFoundException('채널을 찾을 수 없습니다.');
      }

      const targetUrl = url ?? this.buildDefaultChannelUrl(channel);

      const recipientIds = await this.collectFavoriterIds(
        channelId,
        ownerUserId,
      );

      if (recipientIds.length === 0) {
        this.logger.log(
          `Fan broadcast: no recipients for channelId=${channelId}, owner=${ownerUserId} (quota still consumed)`,
        );
      }

      const idempotencyKey = `fanbroadcast_${channelId}_${ownerUserId}_${now.getTime()}`;

      const { processedUserIds, skippedUserIds } =
        await this.notificationsService.sendCustomNotificationToUsers(
          recipientIds,
          {
            title,
            body,
            url: targetUrl,
            type: NotificationType.STREAMER_FAN_BROADCAST,
            data: {
              channelId: channel.id,
              channelName: channel.name,
              channelWebPath: channel.webPath ?? null,
              // history 조회 시 동일 broadcast 끼리 묶기 위한 그룹 키.
              broadcastId: idempotencyKey,
            },
          },
          { saveInApp: true, idempotencyKey },
        );

      this.logger.log(
        `Fan broadcast sent: channelId=${channelId}, owner=${ownerUserId}, ` +
          `recipients=${processedUserIds.length}, skipped=${skippedUserIds.length}, ` +
          `quota=${used}/${limit}, pro=${isPro}`,
      );

      return {
        success: true,
        channelId: channel.id,
        enqueuedCount: processedUserIds.length,
        usedQuotaToday: used,
        dailyQuota: limit,
        resetAt: this.quotaService.getResetAt(now).toISOString(),
      };
    } catch (err) {
      // 어떤 사유든 INCR 이후 실패하면 쿼터를 복구한다.
      // rollback 내부가 이미 Redis 오류를 warn 로 흡수하지만, HttpException
      // (429/404) 이외의 예기치 못한 예외는 ops 가 구분할 수 있도록 ERROR
      // 레벨로 별도 로깅한다.
      await this.quotaService.rollback(ownerUserId, now);
      if (!(err instanceof HttpException)) {
        this.logger.error(
          `Fan broadcast failed unexpectedly, quota rolled back: ` +
            `channelId=${channelId}, owner=${ownerUserId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
      throw err;
    }
  }

  /**
   * 채널의 최근 팬 알림 발송 이력 + 읽음 통계.
   *
   * Notification 테이블을 broadcastId 로 그룹화. 별도 FanBroadcast 테이블
   * 없이 saveInApp 로 저장된 인앱 알림에서 통계를 산출한다. 발송 시
   * data.broadcastId(=idempotencyKey) 가 동일한 row 들을 한 묶음으로 본다.
   *
   * 주의: WHERE 절에 type 단독 인덱스가 없으므로 데이터가 매우 커지면
   * scan 비용이 늘어난다. channelId 필터로 좁혀지지만 향후 (type, created_at)
   * 인덱스 추가를 고려할 것.
   */
  async getHistory(channelId: number, limit: number) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    const rows = await this.prisma.$queryRaw<
      Array<{
        broadcast_id: string;
        title: string;
        body: string;
        url: string | null;
        sent_at: Date;
        recipient_count: bigint | number;
        read_count: bigint | number;
      }>
    >`
      SELECT
        JSON_UNQUOTE(JSON_EXTRACT(data, '$.broadcastId')) AS broadcast_id,
        MIN(title) AS title,
        MIN(body) AS body,
        MIN(url) AS url,
        MIN(created_at) AS sent_at,
        COUNT(*) AS recipient_count,
        SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) AS read_count
      FROM notifications
      WHERE type = ${NotificationType.STREAMER_FAN_BROADCAST}
        AND JSON_EXTRACT(data, '$.broadcastId') IS NOT NULL
        AND JSON_EXTRACT(data, '$.channelId') = ${channelId}
      GROUP BY JSON_UNQUOTE(JSON_EXTRACT(data, '$.broadcastId'))
      ORDER BY sent_at DESC
      LIMIT ${safeLimit}
    `;

    return {
      items: rows.map((r) => ({
        broadcastId: r.broadcast_id,
        title: r.title,
        body: r.body,
        url: r.url,
        sentAt: r.sent_at.toISOString(),
        recipientCount: Number(r.recipient_count),
        readCount: Number(r.read_count),
      })),
    };
  }

  async getQuota(userId: number) {
    const now = new Date();
    const [isPro, used] = await Promise.all([
      isProSubscriberActive(this.prisma, userId),
      this.quotaService.getUsed(userId, now),
    ]);
    return {
      used,
      limit: this.quotaService.getLimit(isPro),
      isPro,
      resetAt: this.quotaService.getResetAt(now).toISOString(),
    };
  }

  private buildDefaultChannelUrl(channel: {
    id: number;
    webPath: string | null;
  }): string {
    return channel.webPath
      ? `/channel/${channel.webPath}`
      : `/channel/${channel.id}`;
  }

  private async collectFavoriterIds(
    channelId: number,
    excludeUserId: number,
  ): Promise<number[]> {
    const collected = new Set<number>();
    let page = 1;
    while (true) {
      const result = await this.favoritesService.getChannelFavoritedUsers(
        channelId,
        page,
        FAVORITES_PAGE_SIZE,
      );
      for (const u of result.users) {
        if (u.userId !== excludeUserId) {
          collected.add(u.userId);
        }
      }
      if (result.users.length === 0 || page >= result.totalPages) break;
      page += 1;
    }
    return Array.from(collected);
  }
}
