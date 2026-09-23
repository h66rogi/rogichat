import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DistributedLock } from '../../common/distributed-lock/distributed-lock.decorator';
import { DistributedLockService } from '../../common/distributed-lock/distributed-lock.service';
import { channelCacheKeys } from '../cache/channel.cache-keys';
import { SoftconeConnectionService } from '../../softcone/services/softcone-connection.service';
import { SoftconeReleaseReason, SubscriptionTermStatus } from '@prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/constants/notification-types';
import { MetricsService } from '../../metrics';

type ExpiredUser = {
  id: number;
  channels: Array<{
    id: number;
    webPath: string;
    customization: {
      id: number;
      isEnabled: boolean;
    } | null;
    managers: Array<{
      id: number;
      createdAt: Date | null;
    }>;
  }>;
};

/**
 * 프로 구독 만료 시 커스텀 CSS 및 매니저 자동 비활성화 서비스
 */
@Injectable()
export class CustomizationExpiryService {
  private readonly logger = new Logger(CustomizationExpiryService.name);
  private readonly batchSize = 100;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly distributedLockService: DistributedLockService,
    private readonly softconeConnectionService: SoftconeConnectionService,
    private readonly notificationsService: NotificationsService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * 매일 자정에 프로 구독이 만료된 사용자의 커스텀 CSS 및 추가 매니저를 비활성화
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'customization-expiry',
    timeZone: 'Asia/Seoul',
  })
  @DistributedLock('cron:customization:expiry', 10 * 60 * 1000, 2000)
  async handleExpiredProSubscriptions(): Promise<void> {
    const endTimer = this.metricsService.startJobTimer('customization_expiry');
    try {
      this.logger.log('프로 구독 만료로 인한 비활성화 작업 시작');

      const { customizationCount, managerCount } =
        await this.processAllExpired();

      if (customizationCount > 0 || managerCount > 0) {
        this.logger.log(
          `프로 구독 만료로 인한 비활성화 완료: ` +
            `커스터마이징 ${customizationCount}개, ` +
            `매니저 ${managerCount}명 비활성화`,
        );
      } else {
        this.logger.log('비활성화할 항목이 없습니다.');
      }
      this.metricsService.recordJobRun('customization_expiry', 'success');
    } catch (error) {
      this.metricsService.recordJobRun('customization_expiry', 'error');
      this.logger.error(
        '프로 구독 만료로 인한 비활성화 중 오류 발생:',
        error instanceof Error ? error.stack || error.message : String(error),
      );
    } finally {
      endTimer();
    }
  }

  /**
   * 수동으로 만료된 프로 구독자의 커스터마이징 및 매니저 비활성화 (테스트/관리용)
   */
  async processExpiredManually(): Promise<{
    customizationCount: number;
    managerCount: number;
  }> {
    return this.processAllExpired();
  }

  /**
   * 만료된 모든 프로 구독자를 배치 처리
   */
  private async processAllExpired(): Promise<{
    customizationCount: number;
    managerCount: number;
  }> {
    const now = new Date();
    let totalCustomizationDisabled = 0;
    let totalManagersDisabled = 0;
    let hasMore = true;

    while (hasMore) {
      const expiredUsers = await this.findExpiredUsers(now);

      if (expiredUsers.length === 0) {
        break;
      }

      const { customizationCount, managerCount, processedUserIds } =
        await this.processBatch(expiredUsers, now);
      totalCustomizationDisabled += customizationCount;
      totalManagersDisabled += managerCount;

      this.processPostExpiry(processedUserIds);

      if (expiredUsers.length < this.batchSize) {
        hasMore = false;
      }
    }

    return {
      customizationCount: totalCustomizationDisabled,
      managerCount: totalManagersDisabled,
    };
  }

  /**
   * 프로 구독이 만료된 사용자 조회
   */
  private findExpiredUsers(now: Date): Promise<ExpiredUser[]> {
    return this.prisma.user.findMany({
      where: {
        isProSubscriber: true,
        proSubscriptionEndAt: { lte: now },
      },
      select: {
        id: true,
        channels: {
          select: {
            id: true,
            webPath: true,
            customization: {
              select: {
                id: true,
                isEnabled: true,
              },
            },
            managers: {
              where: { isActive: true },
              select: {
                id: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      take: this.batchSize,
      orderBy: { id: 'asc' },
    });
  }

  /**
   * 배치 처리: 만료된 사용자들의 커스터마이징 및 매니저 비활성화
   */
  private async processBatch(
    expiredUsers: ExpiredUser[],
    now: Date,
  ): Promise<{
    customizationCount: number;
    managerCount: number;
    processedUserIds: number[];
  }> {
    let customizationCount = 0;
    let managerCount = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const user of expiredUsers) {
        for (const channel of user.channels) {
          // 1. 커스터마이징이 있고 활성화되어 있는 경우 비활성화
          if (channel.customization?.isEnabled) {
            await tx.channelCustomization.update({
              where: { channelId: channel.id },
              data: { isEnabled: false },
            });

            customizationCount++;

            // 캐시 무효화
            await Promise.all([
              this.cacheManager.del(channelCacheKeys.byId(channel.id)),
              this.cacheManager.del(
                channelCacheKeys.byWebPath(channel.webPath),
              ),
            ]).catch((error) => {
              this.logger.warn(
                `Failed to invalidate cache for channel ${channel.id}:`,
                error instanceof Error ? error.message : String(error),
              );
            });
          }

          // 2. 매니저가 2명 이상인 경우, 가장 먼저 등록된 1명만 유지하고 나머지 비활성화
          if (channel.managers.length > 1) {
            const managerIdsToDisable = channel.managers
              .slice(1)
              .map((m) => m.id);

            await tx.channelManager.updateMany({
              where: {
                id: { in: managerIdsToDisable },
              },
              data: {
                isActive: false,
                revokedAt: now,
              },
            });

            managerCount += managerIdsToDisable.length;

            this.logger.debug(
              `채널 ${channel.id}: ${managerIdsToDisable.length}명의 매니저 비활성화`,
            );
          }
        }

        // 3. 사용자의 isProSubscriber를 false로, proSubscriptionEndAt을 null로 변경
        await tx.user.update({
          where: { id: user.id },
          data: { isProSubscriber: false, proSubscriptionEndAt: null },
        });

        // 4. 만료된 구독 term 상태를 EXPIRED로 변경
        await tx.userSubscriptionTerm.updateMany({
          where: {
            userId: user.id,
            status: SubscriptionTermStatus.ACTIVE,
            endAt: { lte: now },
          },
          data: { status: SubscriptionTermStatus.EXPIRED },
        });
      }
    });

    const processedUserIds = expiredUsers.map((u) => u.id);
    return { customizationCount, managerCount, processedUserIds };
  }

  /**
   * 만료 후속 처리: Softcone 연동 해제 + 만료 알림 발송
   * 트랜잭션 밖에서 실행, 실패해도 핵심 로직에 영향 없음
   */
  private processPostExpiry(processedUserIds: number[]): void {
    for (const userId of processedUserIds) {
      this.softconeConnectionService
        .enqueueReleaseSync({
          userId,
          reason: SoftconeReleaseReason.ETC,
          actor: 'INTERNAL',
          note: '구독 자연 만료에 따른 소프트콘 연동 해제',
          source: `cron:customization-expiry:${userId}`,
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Failed to enqueue softcone release sync (userId=${userId})`,
            this.stringifyError(error),
          );
        });

      this.notificationsService
        .sendToUser(
          userId,
          {
            type: NotificationType.SUBSCRIPTION_EXPIRED,
            title: 'PRO 구독이 만료되었습니다',
            body: 'PRO 구독 기간이 종료되어 PRO 전용 기능이 비활성화되었습니다.',
            data: { itemName: '멜로밍 PRO' },
          },
          { saveInApp: true },
        )
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to send subscription expiry notification (userId=${userId})`,
            this.stringifyError(error),
          );
        });
    }
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) return error.stack || error.message;
    if (typeof error === 'string') return error;
    if (
      typeof error === 'number' ||
      typeof error === 'boolean' ||
      typeof error === 'bigint' ||
      typeof error === 'symbol' ||
      typeof error === 'undefined'
    ) {
      return String(error);
    }
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
}
