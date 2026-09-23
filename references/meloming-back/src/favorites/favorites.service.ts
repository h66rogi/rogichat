import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MyFavoritesQueryDto } from './dto/favorites.request.dto';
// mappers not used at service layer anymore; mapping happens in controller
import {
  channelFavoriteListInclude,
  songFavoriteListInclude,
} from './prisma/favorites.selections';
import { PointsService } from '../points/points.service';
import { POINT_ACTIONS } from '../points/constants/point-actions';
import { buildPointReason } from '../points/utils/point-reason';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/constants/notification-types';
import { REDIS_CLIENT, type AppRedisClient } from '../redis/redis.tokens';
import {
  calculateBirthdayDdayFromDate,
  calculateMilestonesFromDate,
  pickNextUpcomingEvent,
} from '../channel/utils/channel-anniversary.utils';

/** 즐겨찾기 채널 기본 정렬: sortOrder 오름차순 (NULL은 뒤로), createdAt 내림차순 */
const FAVORITE_CHANNEL_ORDER_BY = [
  { sortOrder: { sort: 'asc' as const, nulls: 'last' as const } },
  { createdAt: 'desc' as const },
];

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly notificationsService: NotificationsService,
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
  ) {}

  private getKstMonthBounds(now: Date = new Date()): {
    startUtc: Date;
    endUtc: Date;
    yyyymm: string;
  } {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const kst = new Date(now.getTime() + KST_OFFSET_MS);
    kst.setDate(1);
    kst.setHours(0, 0, 0, 0);
    const startUtc = new Date(kst.getTime() - KST_OFFSET_MS);
    // 다음달 1일 00시
    const next = new Date(kst);
    next.setMonth(next.getMonth() + 1);
    const endUtc = new Date(next.getTime() - KST_OFFSET_MS);
    const y = kst.getFullYear();
    const m = String(kst.getMonth() + 1).padStart(2, '0');
    return { startUtc, endUtc, yyyymm: `${y}${m}` };
  }

  private getKstDateKey(now: Date = new Date()): string {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    return new Date(now.getTime() + KST_OFFSET_MS)
      .toISOString()
      .slice(0, 10);
  }

  async toggleChannelFavorite(userId: number, channelId: number) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, name: true, userId: true, webPath: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    const existingFavorite = await this.prisma.userChannelFavorite.findUnique({
      where: {
        unique_user_channel_favorite: {
          userId,
          channelId,
        },
      },
    });

    if (existingFavorite) {
      await this.prisma.userChannelFavorite.delete({
        where: { id: existingFavorite.id },
      });
      // 회수: 같은 월에 지급한 건만 멱등키로 reverse(음수 허용)
      try {
        const { yyyymm } = this.getKstMonthBounds();
        const key = `favorite:channel:${channelId}:${yyyymm}:user:${userId}`;
        const tx = await this.prisma.pointTransaction.findFirst({
          where: { userId, uniqueKey: key },
          select: { id: true },
        });
        if (tx)
          await this.points.reverse(userId, String(tx.id), {
            allowNegative: true,
          });
      } catch {
        // ignore
      }
      return {
        success: true,
        isFavorite: false,
        message: '채널이 즐겨찾기에서 해제되었습니다.',
      };
    }

    return this.addChannelFavorite(userId, channelId);
  }

  /** 채널 즐겨찾기를 멱등적으로 추가합니다. 이미 추가된 경우에도 해제하지 않습니다. */
  async addChannelFavorite(userId: number, channelId: number) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, name: true, userId: true, webPath: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // PointsService takes the balance row before inserting its FK-backed
      // transaction. Use the same lock order as the per-user mutex so channel
      // additions serialize without a users↔balance lock inversion.
      await tx.userPointBalance.upsert({
        where: { userId },
        create: { userId, balance: 0 },
        update: {},
        select: { userId: true },
      });
      await tx.$queryRaw<Array<{ userId: number }>>`
        SELECT user_id AS userId
        FROM user_point_balances
        WHERE user_id = ${userId}
        LIMIT 1
        FOR UPDATE
      `;

      // Compute the KST quota window only after the mutex is acquired so a
      // request waiting across a month boundary cannot use the stale key.
      const { startUtc, endUtc, yyyymm } = this.getKstMonthBounds();
      const rewardKey =
        `favorite:channel:${channelId}:${yyyymm}:user:${userId}`;

      const result = await tx.userChannelFavorite.createMany({
        data: [{ userId, channelId, sortOrder: null }],
        skipDuplicates: true,
      });
      const wasCreated = result.count > 0;
      if (wasCreated) {
        await tx.userChannelFavorite.updateMany({
          where: { userId, sortOrder: { not: null } },
          data: { sortOrder: { increment: 1 } },
        });
        await tx.userChannelFavorite.update({
          where: {
            unique_user_channel_favorite: { userId, channelId },
          },
          data: { sortOrder: 0 },
        });
      }

      const favorite = await tx.userChannelFavorite.findUnique({
        where: {
          unique_user_channel_favorite: { userId, channelId },
        },
        select: { createdAt: true },
      });

      // Retry can heal a reward failure only for a favorite created during
      // the current KST month; an old favorite never earns a fresh-month grant.
      if (
        favorite?.createdAt &&
        favorite.createdAt >= startUtc &&
        favorite.createdAt < endUtc
      ) {
        const existingReward = await tx.pointTransaction.findFirst({
          where: { userId, uniqueKey: rewardKey },
          select: { id: true },
        });
        if (!existingReward) {
          const rewardedFavoriteCount = await tx.pointTransaction.count({
            where: {
              userId,
              action: POINT_ACTIONS.FAVORITE_CHANNEL,
              type: 'CREDIT',
              createdAt: { gte: startUtc, lt: endUtc },
              NOT: { uniqueKey: { endsWith: ':pro_bonus' } },
            },
          });
          if (rewardedFavoriteCount < 10) {
            await this.points.grantWithTx(tx, {
              userId,
              amount: 100,
              action: POINT_ACTIONS.FAVORITE_CHANNEL,
              uniqueKey: rewardKey,
              reason: buildPointReason(POINT_ACTIONS.FAVORITE_CHANNEL, {
                channelName: channel.name,
              }),
              referenceType: 'channel',
              referenceId: String(channelId),
            });
          }
        }
      }

      return wasCreated;
    });

    // 채널 소유자에게 알림 (하루 1회 제한)
    if (created && channel.userId !== userId) {
      const kstDate = this.getKstDateKey();
      const notificationClaimKey =
        `favorite:owner-notification:${channel.userId}:${kstDate}`;
      let claimed = false;
      try {
        claimed =
          (await this.redis.set(notificationClaimKey, '1', {
            NX: true,
            EX: 2 * 24 * 60 * 60,
          })) === 'OK';

        if (claimed) {
          const favoriteUser = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { nickname: true },
          });

          await this.notificationsService.sendToUser(
            channel.userId,
            {
              type: NotificationType.CHANNEL_FAVORITED,
              title: '⭐ 새로운 팬이 생겼어요!',
              body: `${favoriteUser?.nickname}님이 내 채널을 즐겨찾기했어요`,
              url: `/channel/${channel.webPath}`,
              data: { src: `/channel/${channel.webPath}` },
            },
            {
              saveInApp: true,
              idempotencyKey: `channel_favorite_daily_${kstDate}`,
            },
          );
        }
      } catch (error) {
        if (claimed) {
          await this.redis.del(notificationClaimKey).catch(() => undefined);
        }
        console.error(
          `채널 즐겨찾기 알림 전송 실패 - channelId: ${channelId}, error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      success: true,
      isFavorite: true,
      message: created
        ? '채널이 즐겨찾기에 추가되었습니다.'
        : '이미 즐겨찾기에 추가된 채널입니다.',
    };
  }

  async toggleSongFavorite(userId: number, songId: number) {
    const song = await this.prisma.song.findUnique({
      where: { id: songId },
      select: { id: true, title: true },
    });

    if (!song) {
      throw new NotFoundException('노래를 찾을 수 없습니다.');
    }

    const existingLike = await this.prisma.userSongLike.findUnique({
      where: {
        unique_user_song_like: {
          userId,
          songId,
        },
      },
    });

    let isFavorite: boolean;
    let message: string;

    if (existingLike) {
      await this.prisma.userSongLike.delete({ where: { id: existingLike.id } });
      // 회수: 같은 월 지급분 reverse(음수 허용)
      try {
        const { yyyymm } = this.getKstMonthBounds();
        const key = `like:song:${songId}:${yyyymm}:user:${userId}`;
        const tx = await this.prisma.pointTransaction.findFirst({
          where: { userId, uniqueKey: key },
          select: { id: true },
        });
        if (tx)
          await this.points.reverse(userId, String(tx.id), {
            allowNegative: true,
          });
      } catch {
        // ignore
      }
      isFavorite = false;
      message = '노래 즐겨찾기가 해제되었습니다.';
    } else {
      await this.prisma.userSongLike.create({
        data: {
          userId,
          songId,
        },
      });
      // 지급: 월 10개까지 50P
      try {
        const { startUtc, endUtc, yyyymm } = this.getKstMonthBounds();
        const count = await this.prisma.pointTransaction.count({
          where: {
            userId,
            action: POINT_ACTIONS.LIKE_SONG,
            type: 'CREDIT',
            createdAt: { gte: startUtc, lt: endUtc },
          },
        });
        if (count < 10) {
          await this.points.grant({
            userId,
            amount: 50,
            action: POINT_ACTIONS.LIKE_SONG,
            uniqueKey: `like:song:${songId}:${yyyymm}:user:${userId}`,
            reason: buildPointReason(POINT_ACTIONS.LIKE_SONG, {
              songTitle: song.title,
              channelName: (
                await this.prisma.song.findUnique({
                  where: { id: songId },
                  select: { channel: { select: { name: true } } },
                })
              )?.channel?.name,
            }),
            referenceType: 'song',
            referenceId: String(songId),
          });
        }
      } catch {
        // ignore
      }
      isFavorite = true;
      message = '노래를 즐겨찾기에 추가했습니다.';
    }

    return {
      success: true,
      isFavorite,
      message,
    };
  }

  // 나머지 리스트/상태/카운트/삭제 메서드는 그대로 유지
  async getMyChannelFavorites(userId: number, query: MyFavoritesQueryDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const total = await this.prisma.userChannelFavorite.count({
      where: { userId },
    });

    const favorites = await this.prisma.userChannelFavorite.findMany({
      where: { userId },
      include: channelFavoriteListInclude,
      orderBy: FAVORITE_CHANNEL_ORDER_BY,
      skip,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    return {
      favorites,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getMySongFavorites(userId: number, query: MyFavoritesQueryDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const total = await this.prisma.userSongLike.count({ where: { userId } });

    const favorites = await this.prisma.userSongLike.findMany({
      where: { userId },
      include: songFavoriteListInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    return { favorites, total, page, limit, totalPages };
  }

  async getChannelFavoriteStatus(userId: number, channelId: number) {
    const favorite = await this.prisma.userChannelFavorite.findUnique({
      where: {
        unique_user_channel_favorite: {
          userId,
          channelId,
        },
      },
      select: { createdAt: true },
    });

    return { isFavorite: !!favorite, createdAt: favorite?.createdAt };
  }

  async getSongFavoriteStatus(userId: number, songId: number) {
    const like = await this.prisma.userSongLike.findUnique({
      where: {
        unique_user_song_like: {
          userId,
          songId,
        },
      },
      select: { createdAt: true },
    });

    return { isFavorite: !!like, createdAt: like?.createdAt };
  }

  async getFavoriteStats(userId: number) {
    const [channelFavorites, songFavorites] = await Promise.all([
      this.prisma.userChannelFavorite.count({ where: { userId } }),
      this.prisma.userSongLike.count({ where: { userId } }),
    ]);

    return {
      myChannelFavorites: channelFavorites,
      mySongFavorites: songFavorites,
    };
  }

  async removeChannelFavorite(userId: number, channelId: number) {
    const favorite = await this.prisma.userChannelFavorite.findUnique({
      where: {
        unique_user_channel_favorite: {
          userId,
          channelId,
        },
      },
    });

    if (!favorite) {
      throw new NotFoundException('즐겨찾기 항목을 찾을 수 없습니다.');
    }

    await this.prisma.userChannelFavorite.delete({
      where: { id: favorite.id },
    });
    // 회수 시도(음수 허용)
    try {
      const { yyyymm } = this.getKstMonthBounds();
      const key = `favorite:channel:${channelId}:${yyyymm}:user:${userId}`;
      const tx = await this.prisma.pointTransaction.findFirst({
        where: { userId, uniqueKey: key },
        select: { id: true },
      });
      if (tx)
        await this.points.reverse(userId, String(tx.id), {
          allowNegative: true,
        });
    } catch {
      // ignore
    }

    return {
      success: true,
      isFavorite: false,
      message: '채널이 즐겨찾기에서 해제되었습니다.',
    };
  }

  async removeSongFavorite(userId: number, songId: number) {
    const like = await this.prisma.userSongLike.findUnique({
      where: {
        unique_user_song_like: {
          userId,
          songId,
        },
      },
    });

    if (!like) {
      throw new NotFoundException('즐겨찾기 항목을 찾을 수 없습니다.');
    }

    await this.prisma.userSongLike.delete({
      where: { id: like.id },
    });
    // 회수 시도(음수 허용)
    try {
      const { yyyymm } = this.getKstMonthBounds();
      const key = `like:song:${songId}:${yyyymm}:user:${userId}`;
      const tx = await this.prisma.pointTransaction.findFirst({
        where: { userId, uniqueKey: key },
        select: { id: true },
      });
      if (tx)
        await this.points.reverse(userId, String(tx.id), {
          allowNegative: true,
        });
    } catch {
      // ignore
    }

    return {
      success: true,
      isFavorite: false,
      message: '노래 즐겨찾기가 해제되었습니다.',
    };
  }

  async getSongFavoriteCount(songId: number) {
    const song = await this.prisma.song.findUnique({
      where: { id: songId },
      select: { id: true },
    });

    if (!song) {
      throw new NotFoundException('노래를 찾을 수 없습니다.');
    }

    const totalFavorites = await this.prisma.userSongLike.count({
      where: { songId },
    });

    return { songId, totalFavorites };
  }

  async getChannelFavoriteCount(channelId: number) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    const totalFavorites = await this.prisma.userChannelFavorite.count({
      where: { channelId },
    });

    return { channelId, totalFavorites };
  }

  async getChannelFavoritedUsers(
    channelId: number,
    page: number = 1,
    limit: number = 20,
  ) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true },
    });
    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    const skip = (page - 1) * limit;

    const [total, favorites] = await Promise.all([
      this.prisma.userChannelFavorite.count({ where: { channelId } }),
      this.prisma.userChannelFavorite.findMany({
        where: { channelId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          createdAt: true,
          user: {
            select: {
              id: true,
              nickname: true,
              profileImageUrl: true,
            },
          },
        },
      }),
    ]);

    const users = favorites.map((f) => ({
      userId: f.user.id,
      nickname: f.user.nickname,
      profileImageUrl: f.user.profileImageUrl ?? undefined,
      createdAt: f.createdAt,
    }));

    const totalPages = Math.ceil(total / limit);
    return { users, total, page, limit, totalPages };
  }

  async reorderChannelFavorites(
    userId: number,
    channelIds: number[],
  ): Promise<{ success: true }> {
    await this.prisma.$transaction(async (tx) => {
      // 유저의 실제 즐겨찾기 channelId 목록 조회
      const existing = await tx.userChannelFavorite.findMany({
        where: { userId },
        select: { channelId: true },
      });
      const existingSet = new Set(existing.map((e) => e.channelId));

      // 요청된 channelIds 중 실제 즐겨찾기인 것만 필터
      const validChannelIds = channelIds.filter((id) => existingSet.has(id));

      // validChannelIds에 포함된 항목: sortOrder 부여
      for (let i = 0; i < validChannelIds.length; i++) {
        await tx.userChannelFavorite.update({
          where: {
            unique_user_channel_favorite: {
              userId,
              channelId: validChannelIds[i],
            },
          },
          data: { sortOrder: i },
        });
      }

      // validChannelIds에 포함되지 않은 항목: sortOrder NULL로
      const reorderedSet = new Set(validChannelIds);
      const unorderedIds = existing
        .filter((e) => !reorderedSet.has(e.channelId))
        .map((e) => e.channelId);

      if (unorderedIds.length > 0) {
        await tx.userChannelFavorite.updateMany({
          where: {
            userId,
            channelId: { in: unorderedIds },
          },
          data: { sortOrder: null },
        });
      }
    });

    return { success: true };
  }

  async getMyFavoriteChannelAnniversaries(userId: number) {
    const favorites = await this.prisma.userChannelFavorite.findMany({
      where: { userId },
      orderBy: FAVORITE_CHANNEL_ORDER_BY,
      select: {
        channel: {
          select: {
            id: true,
            name: true,
            profileImageUrl: true,
            webPath: true,
            themeColor: true,
            profile: {
              select: {
                birthday: true,
                debutDate: true,
              },
            },
          },
        },
      },
    });

    const items = favorites.map((f) => {
      const channel = f.channel;
      const profile = channel.profile;

      const milestones =
        profile?.debutDate != null
          ? calculateMilestonesFromDate(profile.debutDate)
          : null;

      const birthdayDday =
        profile?.birthday != null
          ? calculateBirthdayDdayFromDate(profile.birthday)
          : null;

      const next =
        milestones || birthdayDday
          ? pickNextUpcomingEvent(
              milestones ?? undefined,
              birthdayDday ?? undefined,
            )
          : null;

      const anniversaries =
        milestones || birthdayDday
          ? {
              milestones,
              birthday: birthdayDday,
              nextUpcomingEvent: next
                ? {
                    type: next.type,
                    label: next.label,
                    daysUntil: next.daysUntil,
                  }
                : null,
            }
          : null;

      return {
        channelId: channel.id,
        channelName: channel.name,
        webPath: channel.webPath,
        profileImageUrl: channel.profileImageUrl ?? null,
        themeColor: channel.themeColor ?? null,
        anniversaries,
      };
    });

    return { items };
  }
}
