import { ApiError } from '../../auth/auth-primitives.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { LiveSessionStatus, LiveSessionType, SongRequestSource, SongRequestStatus } from '../../../generated/prisma/client.js';

/**
 * Copied from meloming-back/src/song-live/session.service.ts setlist methods.
 * Only the channel key, transaction boundary, and unavailable clip relation
 * differ. The source's visibility, pagination, ordering and response shape stay.
 */
export class SessionSetlistService {
  constructor(private readonly prisma: Prisma.TransactionClient, private readonly channelId: string) {}

  async getPublicSetlists(page = 1, limit = 20, range?: { from?: string; to?: string }) {
    const fromStr = range?.from;
    const toStr = range?.to;
    const hasFrom = fromStr !== undefined && fromStr !== null && fromStr !== '';
    const hasTo = toStr !== undefined && toStr !== null && toStr !== '';
    let dateFilter: { gte: Date; lt: Date } | undefined;
    if (hasFrom !== hasTo) throw new ApiError('INVALID_REQUEST', 400);
    if (hasFrom && hasTo) {
      const fromDate = new Date(fromStr as string);
      const toDate = new Date(toStr as string);
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || toDate.getTime() <= fromDate.getTime()) throw new ApiError('INVALID_REQUEST', 400);
      const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1000;
      if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_MS) throw new ApiError('INVALID_REQUEST', 400);
      dateFilter = { gte: fromDate, lt: toDate };
    }

    // Source public rule: STANDARD + ENDED + PUBLIC + completed request.
    const where = {
      channelId: this.channelId,
      sessionType: LiveSessionType.STANDARD,
      status: LiveSessionStatus.ENDED,
      visibility: 'PUBLIC' as const,
      songRequests: { some: { status: SongRequestStatus.COMPLETED } },
      ...(dateFilter ? { startedAt: dateFilter } : {}),
    } as const;
    const skip = (page - 1) * limit;
    const [sessions, total] = await Promise.all([
      this.prisma.liveSession.findMany({
        where, orderBy: { startedAt: 'desc' }, skip, take: limit,
        select: { id: true, platform: true, platformChannelId: true, startedAt: true, endedAt: true,
          _count: { select: { songRequests: { where: { status: SongRequestStatus.COMPLETED } } } } },
      }),
      this.prisma.liveSession.count({ where }),
    ]);
    const setlists = await this.buildSetlistSummaries(sessions);
    return { setlists, total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) };
  }

  private async buildSetlistSummaries(sessions: Array<{ id: number; platform: string | null; platformChannelId: string | null;
    startedAt: Date; endedAt: Date | null; _count: { songRequests: number } }>) {
    const previewMap = new Map<number, string[]>();
    await Promise.all(sessions.map(async s => {
      const rows = await this.prisma.songRequest.findMany({
        where: { liveSessionId: s.id, status: SongRequestStatus.COMPLETED },
        orderBy: [{ playedAt: 'asc' }, { createdAt: 'asc' }], take: 16,
        select: { song: { select: { albumArt: true, coverUrl: true } } },
      });
      const arts: string[] = [];
      for (const row of rows) {
        const art = row.song?.albumArt ?? row.song?.coverUrl ?? null;
        if (!art) continue;
        if (!arts.includes(art)) { arts.push(art); if (arts.length >= 6) break; }
      }
      previewMap.set(s.id, arts);
    }));
    return sessions.map(s => {
      const startedAtIso = s.startedAt.toISOString();
      const sessionKey = s.platform && s.platformChannelId ? `${s.platform}:${s.platformChannelId}:${startedAtIso}` : null;
      return { sessionId: s.id, platform: s.platform, platformChannelId: s.platformChannelId,
        startedAt: startedAtIso, endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        completedCount: s._count.songRequests,
        durationMinutes: s.endedAt ? Math.floor((s.endedAt.getTime() - s.startedAt.getTime()) / 1000 / 60) : null,
        albumArtPreviews: previewMap.get(s.id) ?? [], sessionKey };
    });
  }

  async getPublicSetlistAvailability() {
    const count = await this.prisma.liveSession.count({ where: {
      channelId: this.channelId, sessionType: LiveSessionType.STANDARD,
      status: LiveSessionStatus.ENDED, visibility: 'PUBLIC',
      songRequests: { some: { status: SongRequestStatus.COMPLETED } },
    } });
    return { available: count > 0, count };
  }

  async getManageSetlists(page = 1, limit = 20) {
    const where = { channelId: this.channelId, sessionType: LiveSessionType.STANDARD,
      status: LiveSessionStatus.ENDED, songRequests: { some: { status: SongRequestStatus.COMPLETED } } } as const;
    const skip = (page - 1) * limit;
    const [sessions, total] = await Promise.all([
      this.prisma.liveSession.findMany({ where, orderBy: { startedAt: 'desc' }, skip, take: limit,
        select: { id: true, platform: true, platformChannelId: true, startedAt: true, endedAt: true,
          visibility: true, _count: { select: { songRequests: { where: { status: SongRequestStatus.COMPLETED } } } } } }),
      this.prisma.liveSession.count({ where }),
    ]);
    const summaries = await this.buildSetlistSummaries(sessions);
    const setlists = summaries.map((summary, i) => ({ ...summary, visibility: sessions[i]!.visibility }));
    return { setlists, total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) };
  }

  async updateSetlistVisibility(sessionId: number, visibility: 'PUBLIC' | 'PRIVATE') {
    const session = await this.prisma.liveSession.findFirst({ where: { id: sessionId, channelId: this.channelId }, select: { id: true } });
    if (!session) throw new ApiError('NOT_FOUND', 404);
    const updated = await this.prisma.liveSession.update({ where: { id: sessionId }, data: { visibility }, select: { id: true, visibility: true } });
    return { sessionId: updated.id, visibility: updated.visibility };
  }

  async getPublicSetlistDetail(sessionId: number) {
    const session = await this.prisma.liveSession.findFirst({ where: {
      id: sessionId, channelId: this.channelId, status: LiveSessionStatus.ENDED, visibility: 'PUBLIC',
    }, select: { id: true, platform: true, platformChannelId: true, startedAt: true, endedAt: true,
      settings: { select: { showRequesterName: true } },
      songRequests: { where: { status: SongRequestStatus.COMPLETED, source: { not: SongRequestSource.COMPETITOR } },
        orderBy: [{ playedAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, songId: true, rawArtist: true, rawTitle: true, requesterNickname: true,
          isAnonymous: true, playedAt: true, completedAt: true,
          song: { select: { id: true, title: true, albumArt: true, coverUrl: true, artist: { select: { name: true } } } } } },
    } });
    if (!session) throw new ApiError('NOT_FOUND', 404);
    const showRequesterName = session.settings?.showRequesterName ?? true;
    const previewArts: string[] = [];
    for (const sr of session.songRequests) {
      const art = sr.song?.albumArt ?? sr.song?.coverUrl ?? null;
      if (!art) continue;
      if (!previewArts.includes(art)) { previewArts.push(art); if (previewArts.length >= 4) break; }
    }
    const startedAtIso = session.startedAt.toISOString();
    const summary = { sessionId: session.id, platform: session.platform, platformChannelId: session.platformChannelId,
      startedAt: startedAtIso, endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      completedCount: session.songRequests.length, albumArtPreviews: previewArts,
      durationMinutes: session.endedAt ? Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000 / 60) : null,
      sessionKey: session.platform && session.platformChannelId ? `${session.platform}:${session.platformChannelId}:${startedAtIso}` : null };
    const songs = session.songRequests.map(sr => ({ id: sr.id, songId: sr.songId,
      title: sr.song?.title ?? sr.rawTitle, artist: sr.song?.artist?.name ?? sr.rawArtist,
      albumArt: sr.song?.albumArt ?? sr.song?.coverUrl ?? null,
      requesterNickname: showRequesterName ? sr.requesterNickname : '',
      isAnonymous: showRequesterName ? sr.isAnonymous : true,
      playedAt: sr.playedAt ? sr.playedAt.toISOString() : null,
      completedAt: sr.completedAt ? sr.completedAt.toISOString() : null,
      clip: null }));
    return { summary, songs };
  }
}
