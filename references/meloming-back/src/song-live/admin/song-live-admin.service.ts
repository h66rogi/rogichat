import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LiveSessionStatus,
  LiveSessionType,
  SongRequestStatus,
} from '@prisma/client';

interface GetSessionsParams {
  status?: string;
  channelId?: number;
  page: number;
  size: number;
}

@Injectable()
export class SongLiveAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getSessions({ status, channelId, page, size }: GetSessionsParams) {
    const where: Record<string, unknown> = {
      sessionType: LiveSessionType.STANDARD,
    };

    if (status === 'ACTIVE' || status === 'ENDED') {
      where.status = status as LiveSessionStatus;
    }
    if (channelId) {
      where.channelId = channelId;
    }

    const skip = (page - 1) * size;

    const [sessions, total] = await Promise.all([
      this.prisma.liveSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: size,
        select: {
          id: true,
          platform: true,
          status: true,
          startedAt: true,
          endedAt: true,
          channel: {
            select: {
              id: true,
              name: true,
              webPath: true,
              profileImageUrl: true,
            },
          },
        },
      }),
      this.prisma.liveSession.count({ where }),
    ]);

    if (sessions.length === 0) {
      return {
        sessions: [],
        pagination: { page, size, total, totalPages: Math.ceil(total / size) },
      };
    }

    const sessionIds = sessions.map((s) => s.id);

    // Bulk fetch status counts per session
    const statusCounts = await this.prisma.songRequest.groupBy({
      by: ['liveSessionId', 'status'],
      where: { liveSessionId: { in: sessionIds } },
      _count: true,
    });

    // Bulk fetch donation sums per session
    const donationSums = await this.prisma.songRequest.groupBy({
      by: ['liveSessionId'],
      where: { liveSessionId: { in: sessionIds } },
      _sum: { donationAmount: true },
      _count: true,
    });

    const countMap = new Map<number, Map<string, number>>();
    for (const row of statusCounts) {
      if (!countMap.has(row.liveSessionId)) {
        countMap.set(row.liveSessionId, new Map());
      }
      countMap.get(row.liveSessionId).set(row.status, row._count);
    }

    const donationMap = new Map<number, { total: number; count: number }>();
    for (const row of donationSums) {
      donationMap.set(row.liveSessionId, {
        total: row._sum.donationAmount ?? 0,
        count: row._count,
      });
    }

    const sessionsWithStats = sessions.map((session) => {
      const counts = countMap.get(session.id) ?? new Map<string, number>();
      const donation = donationMap.get(session.id) ?? { total: 0, count: 0 };
      const totalRequests = [...counts.values()].reduce((a, b) => a + b, 0);

      const duration = session.endedAt
        ? Math.floor(
            (new Date(session.endedAt).getTime() -
              new Date(session.startedAt).getTime()) /
              1000 /
              60,
          )
        : null;

      return {
        id: session.id,
        platform: session.platform,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        duration,
        channel: session.channel,
        stats: {
          totalRequests,
          completedCount: counts.get(SongRequestStatus.COMPLETED) ?? 0,
          rejectedCount: counts.get(SongRequestStatus.REJECTED) ?? 0,
          pendingCount: counts.get(SongRequestStatus.PENDING) ?? 0,
          acceptedCount: counts.get(SongRequestStatus.ACCEPTED) ?? 0,
          totalDonation: donation.total,
        },
      };
    });

    return {
      sessions: sessionsWithStats,
      pagination: {
        page,
        size,
        total,
        totalPages: Math.ceil(total / size),
      },
    };
  }

  async getSessionDetail(sessionId: number) {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: sessionId },
      include: {
        settings: true,
        channel: {
          select: {
            id: true,
            name: true,
            webPath: true,
            profileImageUrl: true,
          },
        },
        songRequests: {
          orderBy: [{ queueOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            song: {
              select: {
                id: true,
                title: true,
                albumArt: true,
                artist: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`세션 #${sessionId}을(를) 찾을 수 없습니다.`);
    }

    const stats = {
      totalRequests: session.songRequests.length,
      completedCount: session.songRequests.filter(
        (r) => r.status === SongRequestStatus.COMPLETED,
      ).length,
      rejectedCount: session.songRequests.filter(
        (r) => r.status === SongRequestStatus.REJECTED,
      ).length,
      pendingCount: session.songRequests.filter(
        (r) => r.status === SongRequestStatus.PENDING,
      ).length,
      acceptedCount: session.songRequests.filter(
        (r) => r.status === SongRequestStatus.ACCEPTED,
      ).length,
      totalDonation: session.songRequests.reduce(
        (sum, r) => sum + (r.donationAmount ?? 0),
        0,
      ),
      donationRequests: session.songRequests.filter(
        (r) => r.donationAmount && r.donationAmount > 0,
      ).length,
    };

    const duration = session.endedAt
      ? Math.floor(
          (new Date(session.endedAt).getTime() -
            new Date(session.startedAt).getTime()) /
            1000 /
            60,
        )
      : null;

    return {
      id: session.id,
      platform: session.platform,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      duration,
      channel: session.channel,
      settings: session.settings,
      stats,
      songRequests: session.songRequests.map((req) => ({
        id: req.id,
        title: req.song?.title ?? req.rawTitle,
        artist: req.song?.artist?.name ?? req.rawArtist,
        rawTitle: req.rawTitle,
        rawArtist: req.rawArtist,
        requester: req.requesterNickname,
        status: req.status,
        source: req.source,
        donationAmount: req.donationAmount,
        calculatedPrice: req.calculatedPrice,
        queueOrder: req.queueOrder,
        playedAt: req.playedAt,
        completedAt: req.completedAt,
        rejectionReason: req.rejectionReason,
        createdAt: req.createdAt,
        albumArt: req.song?.albumArt ?? null,
      })),
    };
  }

  async getStats() {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const [activeCount, todayCount, totalCount, todayRequests] =
      await Promise.all([
        this.prisma.liveSession.count({
          where: {
            status: LiveSessionStatus.ACTIVE,
            sessionType: LiveSessionType.STANDARD,
          },
        }),
        this.prisma.liveSession.count({
          where: {
            startedAt: { gte: todayStart },
            sessionType: LiveSessionType.STANDARD,
          },
        }),
        this.prisma.liveSession.count({
          where: { sessionType: LiveSessionType.STANDARD },
        }),
        this.prisma.songRequest.count({
          where: { createdAt: { gte: todayStart } },
        }),
      ]);

    return {
      activeSessions: activeCount,
      todaySessions: todayCount,
      totalSessions: totalCount,
      todayRequests,
    };
  }
}
