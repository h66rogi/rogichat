import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChannelSchedule, Prisma, ScheduleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { NotificationsService } from '../notifications/notifications.service';
import { POINT_ACTIONS } from '../points/constants/point-actions';
import { buildPointReason } from '../points/utils/point-reason';
import { NotificationType } from '../notifications/constants/notification-types';
import {
  ScheduleListQueryDto,
  CreateScheduleDto,
  UpdateScheduleDto,
} from './dto/schedule.request.dto';

@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly notifications: NotificationsService,
  ) {}

  private getKstDayBounds(now: Date = new Date()): {
    startUtc: Date;
    endUtc: Date;
  } {
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const kst = new Date(now.getTime() + KST_OFFSET_MS);
    kst.setHours(0, 0, 0, 0);
    const startUtc = new Date(kst.getTime() - KST_OFFSET_MS);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
    return { startUtc, endUtc };
  }

  private async grantScheduleCreateBonus(row: {
    id: number;
    authorUserId: number;
    title?: string | null;
    channel?: { name?: string | null } | null;
  }) {
    const uniqueKey = `schedule:create:${row.id}`;
    const userId = row.authorUserId;

    const { startUtc, endUtc } = this.getKstDayBounds();

    const transaction = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.pointTransaction.findFirst({
          where: { userId, uniqueKey },
          select: { id: true },
        });
        if (existing) return null;

        const todayCount = await tx.pointTransaction.count({
          where: {
            userId,
            action: POINT_ACTIONS.SCHEDULE_CREATE,
            type: 'CREDIT',
            createdAt: { gte: startUtc, lt: endUtc },
          },
        });
        if (todayCount >= 7) return null;

        return this.points.grantWithTx(
          tx,
          {
            userId,
            amount: 300,
            action: POINT_ACTIONS.SCHEDULE_CREATE,
            uniqueKey,
            reason: buildPointReason(POINT_ACTIONS.SCHEDULE_CREATE, {
              channelName: row.channel?.name ?? undefined,
              scheduleTitle: row.title ?? undefined,
            }),
            referenceType: 'schedule',
            referenceId: String(row.id),
          },
          { skipUniqueCheck: true },
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!transaction) return;

    // 프로 구독자 보너스 정보 확인
    const proBonusAmount =
      (transaction as { proBonusAmount?: number })?.proBonusAmount ?? 0;
    const totalAmount = 300 + proBonusAmount;
    const bonusText =
      proBonusAmount > 0
        ? ` (프로 구독자 보너스 +${proBonusAmount}P, 가중치 30%)`
        : '';

    await this.notifications.sendToUser(
      userId,
      {
        type: NotificationType.SCHEDULE_POINT_REWARD,
        title: '🗓️ 일정 등록 포인트 지급',
        body: `새 일정을 등록해 ${totalAmount}P를 획득했어요!${bonusText} (하루 최대 7회)`,
        url: '/page/point',
        data: {
          src: '/page/point',
          amount: totalAmount,
          baseAmount: 300,
          proBonusAmount,
          weight: proBonusAmount > 0 ? 30 : 0,
          action: POINT_ACTIONS.SCHEDULE_CREATE,
          scheduleId: row.id,
          transactionId: String(transaction.id),
        },
      },
      { saveInApp: true, idempotencyKey: uniqueKey },
    );
  }

  private async ensureChannelOwnerOrManager(channelId: number, userId: number) {
    const ch = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, userId: true },
    });
    if (!ch) throw new NotFoundException('Channel not found');
    if (ch.userId === userId) return;
    const mgr = await this.prisma.channelManager.findUnique({
      where: { channelId_userId: { channelId, userId } },
      select: { isActive: true, canManageContent: true },
    });
    if (!mgr?.isActive || !mgr.canManageContent)
      throw new ForbiddenException('권한이 없습니다.');
  }

  async create(channelId: number, userId: number, dto: CreateScheduleDto) {
    await this.ensureChannelOwnerOrManager(channelId, userId);
    const startAt = new Date(dto.startAt);
    const endAt = dto.endAt ? new Date(dto.endAt) : undefined;
    if (endAt && startAt > endAt)
      throw new ForbiddenException('startAt must be before endAt');
    const created = await this.prisma.channelSchedule.create({
      data: {
        channelId,
        authorUserId: userId,
        title: dto.title,
        content: dto.content,
        startAt,
        endAt,
        allDay: dto.allDay ?? false,
        visibility: dto.visibility ?? 'PUBLIC',
        location: dto.location,
        status: dto.status ?? 'TBD',
        externalUrl: dto.externalUrl,
      },
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            profileImageUrl: true,
            webPath: true,
            user: {
              select: {
                isProSubscriber: true,
                proSubscriptionEndAt: true,
                isAmbassador: true,
              },
            },
          },
        },
      },
    });
    try {
      await this.grantScheduleCreateBonus(created);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to grant schedule create bonus: ${msg}`);
    }
    return created;
  }

  async update(id: number, userId: number, dto: UpdateScheduleDto) {
    const existing = await this.prisma.channelSchedule.findUnique({
      where: { id },
      select: { id: true, channelId: true, recurringScheduleId: true },
    });
    if (!existing) throw new NotFoundException('Schedule not found');
    await this.ensureChannelOwnerOrManager(existing.channelId, userId);
    const data: any = { ...dto };
    if (dto.startAt) data.startAt = new Date(dto.startAt);
    if (dto.endAt) data.endAt = new Date(dto.endAt);
    if (data.startAt && data.endAt && data.startAt > data.endAt)
      throw new ForbiddenException('startAt must be before endAt');

    // 수동 수정 시 반복 일정 연결 해제
    if (existing.recurringScheduleId !== null) {
      data.recurringScheduleId = null;
    }

    return this.prisma.channelSchedule.update({
      where: { id },
      data,
      include: {
        channel: {
          select: {
            id: true,
            name: true,
            profileImageUrl: true,
            webPath: true,
            user: {
              select: {
                isProSubscriber: true,
                proSubscriptionEndAt: true,
                isAmbassador: true,
              },
            },
          },
        },
      },
    });
  }

  async remove(id: number, userId: number) {
    const existing = await this.prisma.channelSchedule.findUnique({
      where: { id },
      select: { id: true, channelId: true },
    });
    if (!existing) throw new NotFoundException('Schedule not found');
    await this.ensureChannelOwnerOrManager(existing.channelId, userId);
    return this.prisma.channelSchedule.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }

  private toWhereOverlap(from?: string, to?: string) {
    if (!from && !to) return undefined;
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (fromDate && toDate) {
      return {
        OR: [
          { AND: [{ startAt: { lt: toDate } }, { endAt: { gte: fromDate } }] },
          {
            AND: [{ startAt: { gte: fromDate, lt: toDate } }, { endAt: null }],
          },
        ],
      };
    }
    if (fromDate)
      return {
        OR: [
          { endAt: { gte: fromDate } },
          { AND: [{ endAt: null }, { startAt: { gte: fromDate } }] },
        ],
      };
    if (toDate) return { startAt: { lt: toDate } };
    return undefined;
  }

  private kstMonthRange(ym: string): { from: string; to: string } | undefined {
    if (!/^\d{4}-\d{2}$/.test(ym)) return undefined;
    const [y, m] = ym.split('-').map((s) => Number(s));
    // KST 00:00을 UTC로 저장하기 위해 +9h 시프트(이전날 15:00Z)
    const kstStart = new Date(Date.UTC(y, m - 1, 1, 15, 0, 0));
    const kstNext = new Date(Date.UTC(y, m, 1, 15, 0, 0));
    return { from: kstStart.toISOString(), to: kstNext.toISOString() };
  }

  /**
   * 채널 일정 공개 목록 (페이지네이션 + month/range overlap).
   *
   * ⚠ visibility 분기 (owner / active manager / PUBLIC fallback) 는
   *    `ChannelCalendarService.fetchSchedules` 와 의도적 중복.
   *    변경 시 양쪽 동기화 필요. 향후 공통 util 추출 검토.
   */
  async listChannelPublic(
    channelId: number,
    query: ScheduleListQueryDto,
    requesterUserId?: number,
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const take = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = (page - 1) * take;
    const month = query.ym ? this.kstMonthRange(query.ym) : undefined;
    const overlap = month
      ? this.toWhereOverlap(month.from, month.to)
      : this.toWhereOverlap(query.from, query.to);

    // PRIVATE 포함 여부: 소유자/매니저/관리자만 포함. 간단히 소유/매니저 체크
    let includePrivate = false;
    if (requesterUserId) {
      const ch = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { userId: true },
      });
      if (ch?.userId === requesterUserId) includePrivate = true;
      else {
        const mgr = await this.prisma.channelManager.findUnique({
          where: { channelId_userId: { channelId, userId: requesterUserId } },
          select: { isActive: true },
        });
        if (mgr?.isActive) includePrivate = true;
      }
    }

    const where: any = { channelId, isDeleted: false };
    if (!includePrivate) where.visibility = 'PUBLIC';
    if (overlap) Object.assign(where, overlap);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.channelSchedule.findMany({
        where,
        orderBy: { startAt: 'desc' },
        take,
        skip,
        include: {
          author: {
            select: { id: true, nickname: true, profileImageUrl: true },
          },
          channel: {
            select: {
              id: true,
              name: true,
              profileImageUrl: true,
              webPath: true,
              user: {
                select: {
                  isProSubscriber: true,
                  proSubscriptionEndAt: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.channelSchedule.count({ where }),
    ]);
    return { rows, total, page, limit: take };
  }

  async listFavorites(
    userId: number,
    query: ScheduleListQueryDto,
    onlyMyChannels = false,
  ) {
    const favIds = await this.prisma.userChannelFavorite.findMany({
      where: { userId },
      select: { channelId: true },
    });
    const candidateIds = favIds.map((f) => f.channelId);
    if (candidateIds.length === 0)
      return {
        rows: [],
        total: 0,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      };
    const page = Math.max(query.page ?? 1, 1);
    const take = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = (page - 1) * take;
    const month = query.ym ? this.kstMonthRange(query.ym) : undefined;
    const overlap = month
      ? this.toWhereOverlap(month.from, month.to)
      : this.toWhereOverlap(query.from, query.to);

    // 채널 필터
    const filterIds =
      query.channelIds && query.channelIds.length > 0
        ? query.channelIds.filter((id) => candidateIds.includes(id))
        : candidateIds;

    // 내 채널/내 매니저 채널 판단
    const myChannelIdsRows = await this.prisma.channel.findMany({
      where: { userId },
      select: { id: true },
    });
    const managerRows = await this.prisma.channelManager.findMany({
      where: { userId, isActive: true },
      select: { channelId: true },
    });
    const myOrManagerIds = new Set<number>([
      ...myChannelIdsRows.map((r) => r.id),
      ...managerRows.map((r) => r.channelId),
    ]);

    const where: any = { channelId: { in: filterIds }, isDeleted: false };
    if (overlap) Object.assign(where, overlap);
    if (!onlyMyChannels) where.visibility = 'PUBLIC';
    else where.visibility = undefined; // 내/매니저 채널이면 PRIVATE 포함
    if (onlyMyChannels)
      where.channelId = {
        in: filterIds.filter((id) => myOrManagerIds.has(id)),
      };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.channelSchedule.findMany({
        where,
        orderBy: { startAt: 'desc' },
        take,
        skip,
        include: {
          author: {
            select: { id: true, nickname: true, profileImageUrl: true },
          },
          channel: {
            select: {
              id: true,
              name: true,
              profileImageUrl: true,
              webPath: true,
              user: {
                select: {
                  isProSubscriber: true,
                  proSubscriptionEndAt: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.channelSchedule.count({ where }),
    ]);
    return { rows, total, page, limit: take };
  }

  async listMine(userId: number, query: ScheduleListQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const take = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const skip = (page - 1) * take;
    const month = query.ym ? this.kstMonthRange(query.ym) : undefined;
    const overlap = month
      ? this.toWhereOverlap(month.from, month.to)
      : this.toWhereOverlap(query.from, query.to);
    const myChannelIdsRows = await this.prisma.channel.findMany({
      where: { userId },
      select: { id: true },
    });
    const managerRows = await this.prisma.channelManager.findMany({
      where: { userId, isActive: true },
      select: { channelId: true },
    });
    const ids = [
      ...new Set<number>([
        ...myChannelIdsRows.map((r) => r.id),
        ...managerRows.map((r) => r.channelId),
      ]),
    ];
    if (ids.length === 0) return { rows: [], total: 0, page, limit: take };
    const where: any = { channelId: { in: ids }, isDeleted: false };
    if (overlap) Object.assign(where, overlap);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.channelSchedule.findMany({
        where,
        orderBy: { startAt: 'desc' },
        take,
        skip,
        include: {
          author: {
            select: { id: true, nickname: true, profileImageUrl: true },
          },
          channel: {
            select: {
              id: true,
              name: true,
              profileImageUrl: true,
              webPath: true,
              user: {
                select: {
                  isProSubscriber: true,
                  proSubscriptionEndAt: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.channelSchedule.count({ where }),
    ]);
    return { rows, total, page, limit: take };
  }

  async getPublicOrAuthorized(
    id: number,
    requesterUserId?: number,
    isAdmin?: boolean,
  ) {
    const row = await this.prisma.channelSchedule.findUnique({
      where: { id },
      include: {
        channel: {
          select: {
            userId: true,
            id: true,
            name: true,
            profileImageUrl: true,
            webPath: true,
            user: {
              select: {
                isProSubscriber: true,
                proSubscriptionEndAt: true,
                isAmbassador: true,
              },
            },
          },
        },
        author: { select: { id: true, nickname: true, profileImageUrl: true } },
      },
    });
    if (!row || row.isDeleted)
      throw new NotFoundException('Schedule not found');
    if (row.visibility === 'PUBLIC') return row;
    if (isAdmin) return row;
    if (requesterUserId) {
      if (row.channel.userId === requesterUserId) return row;
      const mgr = await this.prisma.channelManager.findUnique({
        where: {
          channelId_userId: {
            channelId: row.channelId,
            userId: requesterUserId,
          },
        },
        select: { isActive: true },
      });
      if (mgr?.isActive) return row;
    }
    throw new ForbiddenException('권한이 없습니다.');
  }

  /**
   * 홈 화면용 다가오는 주요 일정 (랜덤 7일 이내, LIVE/COLLAB)
   * @param limit 랜덤 개수
   * @returns 랜덤 7일 이내, LIVE/COLLAB 일정 목록
   */
  async getUpcomingHighlights(limit = 10): Promise<ChannelSchedule[]> {
    const now = new Date();
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(now.getDate() + 7);

    const candidates = await this.prisma.channelSchedule.findMany({
      where: {
        isDeleted: false,
        visibility: 'PUBLIC',
        status: { in: [ScheduleStatus.LIVE, ScheduleStatus.COLLAB] },
        startAt: {
          gte: now,
          lte: sevenDaysLater,
        },
      },
      select: { id: true },
    });

    if (candidates.length === 0) return [];

    // Fisher-Yates Shuffle to pick random highlights uniformly
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const selectedIds = candidates.slice(0, limit).map((c) => c.id);

    const rows = await this.prisma.channelSchedule.findMany({
      where: { id: { in: selectedIds } },
      include: {
        author: {
          select: { id: true, nickname: true, profileImageUrl: true },
        },
        channel: {
          select: {
            id: true,
            name: true,
            profileImageUrl: true,
            webPath: true,
            user: {
              select: {
                isProSubscriber: true,
                proSubscriptionEndAt: true,
                isAmbassador: true,
              },
            },
          },
        },
      },
      orderBy: { startAt: 'asc' },
    });

    return rows;
  }
}
