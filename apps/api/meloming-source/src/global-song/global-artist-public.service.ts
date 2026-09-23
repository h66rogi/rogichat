import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LiveStatusService } from '../live-status/live-status.service';
import { decodeCursor, encodeCursor } from './global-song-public.service';
import type { GlobalArtistDetailResponseDto } from './dto/global-artist-detail.dto';
import {
  GlobalArtistSongItemDto,
  GlobalArtistSongsCursorPayload,
  GlobalArtistSongsQueryDto,
  GlobalArtistSongsResponseDto,
} from './dto/global-artist-songs.dto';
import {
  GlobalArtistChannelItemDto,
  GlobalArtistChannelsCursorPayload,
  GlobalArtistChannelsQueryDto,
  GlobalArtistChannelsResponseDto,
} from './dto/global-artist-channels.dto';
import {
  GlobalSongClipCursorPayload,
  GlobalSongClipDto,
  GlobalSongClipQueryDto,
  GlobalSongClipResponseDto,
} from './dto/global-song-clips.dto';

/**
 * Public read APIs for the /artist/[id] page.
 *
 *   - getDetail(id)            → artist hero (name + summary counts + cover)
 *   - getSongs(id, query)      → cursor-paginated song catalog
 *   - getChannels(id, query)   → cursor-paginated streamers covering artist
 *   - getClips(id, query)      → cursor-paginated clip feed across all songs
 *
 * Mirrors GlobalSongPublicService conventions (cursor codec, validation,
 * Cache-Control budgets) so frontends can reuse the same hooks/types.
 */
@Injectable()
export class GlobalArtistPublicService {
  private readonly logger = new Logger(GlobalArtistPublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly liveStatus: LiveStatusService,
  ) {}

  /* -------------------------------------------------------------------- */
  /*  GET /global-artists/:id                                              */
  /* -------------------------------------------------------------------- */

  async getDetail(id: number): Promise<GlobalArtistDetailResponseDto> {
    const resolved = await this.resolveMergedArtist(id);
    const artist = await this.prisma.globalArtist.findUnique({
      where: { id: resolved.canonicalId },
      select: { id: true, canonicalName: true },
    });
    if (!artist) {
      throw new NotFoundException(`GlobalArtist ${id} not found`);
    }

    // Top GlobalSong cover by channelCount DESC. Used as the artist hero
    // image. NULL when the artist has no song with channelCount > 0 yet.
    const topSong = await this.prisma.globalSong.findFirst({
      where: {
        globalArtistId: resolved.canonicalId,
        channelCount: { gt: 0 },
        albumArt: { not: null },
      },
      select: { albumArt: true },
      orderBy: [{ channelCount: 'desc' }, { id: 'desc' }],
    });

    const songCount = await this.prisma.globalSong.count({
      where: {
        globalArtistId: resolved.canonicalId,
        channelCount: { gt: 0 },
      },
    });

    // channelCount: distinct PUBLIC channels covering any of this artist's
    // songs. clipCount: distinct visible clips on PUBLIC channels for the
    // same set. Both via raw SQL to avoid N+1.
    const [channelCnt, clipCnt] = await Promise.all([
      this.countDistinctChannels(resolved.canonicalId),
      this.countDistinctClips(resolved.canonicalId),
    ]);

    return {
      id: artist.id,
      name: artist.canonicalName,
      albumArt: topSong?.albumArt ?? null,
      songCount,
      channelCount: channelCnt,
      clipCount: clipCnt,
      mergedFrom: resolved.mergedFrom,
    };
  }

  /* -------------------------------------------------------------------- */
  /*  GET /global-artists/:id/songs                                        */
  /* -------------------------------------------------------------------- */

  async getSongs(
    id: number,
    query: GlobalArtistSongsQueryDto,
  ): Promise<GlobalArtistSongsResponseDto> {
    const limit = query.limit ?? 24;
    const resolved = await this.resolveMergedArtist(id);
    await this.assertArtistExists(resolved.canonicalId, id);

    let cursor: GlobalArtistSongsCursorPayload | null = null;
    if (query.cursor) {
      const decoded = decodeCursor<GlobalArtistSongsCursorPayload>(
        query.cursor,
      );
      if (
        !decoded ||
        typeof decoded.channelCount !== 'number' ||
        typeof decoded.id !== 'number'
      ) {
        throw new BadRequestException('Invalid cursor');
      }
      cursor = decoded;
    }

    // Keyset on (channelCount DESC, id DESC). Mirror search endpoint pattern.
    const rows = await this.prisma.globalSong.findMany({
      where: {
        globalArtistId: resolved.canonicalId,
        channelCount: { gt: 0 },
        ...(cursor
          ? {
              OR: [
                { channelCount: { lt: cursor.channelCount } },
                {
                  AND: [
                    { channelCount: cursor.channelCount },
                    { id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        title: true,
        albumArt: true,
        channelCount: true,
      },
      orderBy: [{ channelCount: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: GlobalArtistSongItemDto[] = pageRows.map((r) => ({
      id: r.id,
      title: r.title,
      albumArt: r.albumArt,
      channelCount: r.channelCount,
    }));

    const nextCursor = hasMore
      ? encodeCursor<GlobalArtistSongsCursorPayload>({
          channelCount: pageRows[pageRows.length - 1].channelCount,
          id: pageRows[pageRows.length - 1].id,
        })
      : null;

    return { items, nextCursor, mergedFrom: resolved.mergedFrom };
  }

  /* -------------------------------------------------------------------- */
  /*  GET /global-artists/:id/channels                                     */
  /* -------------------------------------------------------------------- */

  async getChannels(
    id: number,
    query: GlobalArtistChannelsQueryDto,
  ): Promise<GlobalArtistChannelsResponseDto> {
    const limit = query.limit ?? 24;
    const resolved = await this.resolveMergedArtist(id);
    await this.assertArtistExists(resolved.canonicalId, id);

    let cursor: GlobalArtistChannelsCursorPayload | null = null;
    if (query.cursor) {
      const decoded = decodeCursor<GlobalArtistChannelsCursorPayload>(
        query.cursor,
      );
      if (
        !decoded ||
        typeof decoded.songCount !== 'number' ||
        typeof decoded.id !== 'number'
      ) {
        throw new BadRequestException('Invalid cursor');
      }
      cursor = decoded;
    }

    // Stage A — channel ids ordered by (songCount DESC, channel_id DESC) via
    // a GROUP BY over Songs joined to global_songs / channels. Cursor in
    // HAVING because the ordering key is an aggregate.
    type Row = {
      id: number | bigint;
      songCount: number | bigint;
    };

    let raw: Row[];
    if (cursor) {
      raw = await this.prisma.$queryRaw<Row[]>`
        SELECT s.channel_id AS id,
               CAST(COUNT(DISTINCT s.id) AS SIGNED) AS songCount
          FROM songs s
          JOIN global_songs gs ON s.global_song_id = gs.id
          JOIN channels ch ON s.channel_id = ch.id
         WHERE gs.global_artist_id = ${resolved.canonicalId}
           AND ch.visibility = 'PUBLIC'
         GROUP BY s.channel_id
        HAVING (
          COUNT(DISTINCT s.id) < ${cursor.songCount}
          OR (
            COUNT(DISTINCT s.id) = ${cursor.songCount}
            AND s.channel_id < ${cursor.id}
          )
        )
         ORDER BY songCount DESC, s.channel_id DESC
         LIMIT ${limit + 1}
      `;
    } else {
      raw = await this.prisma.$queryRaw<Row[]>`
        SELECT s.channel_id AS id,
               CAST(COUNT(DISTINCT s.id) AS SIGNED) AS songCount
          FROM songs s
          JOIN global_songs gs ON s.global_song_id = gs.id
          JOIN channels ch ON s.channel_id = ch.id
         WHERE gs.global_artist_id = ${resolved.canonicalId}
           AND ch.visibility = 'PUBLIC'
         GROUP BY s.channel_id
         ORDER BY songCount DESC, s.channel_id DESC
         LIMIT ${limit + 1}
      `;
    }

    const ordered = raw.map((r) => ({
      id: Number(r.id),
      songCount: Number(r.songCount),
    }));
    const hasMore = ordered.length > limit;
    const pageRows = hasMore ? ordered.slice(0, limit) : ordered;
    if (pageRows.length === 0) {
      return { items: [], nextCursor: null, mergedFrom: resolved.mergedFrom };
    }

    // Stage B — channel detail (name, profile, platform, followerCount).
    const channelIds = pageRows.map((r) => r.id);
    const channelRows = await this.prisma.channel.findMany({
      where: { id: { in: channelIds } },
      select: {
        id: true,
        name: true,
        profileImageUrl: true,
        verifications: {
          select: { platform: true },
          where: { status: 'APPROVED' },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { userFavorites: true } },
      },
    });
    const channelById = new Map(channelRows.map((c) => [c.id, c]));

    const liveSet = await this.resolveLiveStatus(channelIds);

    // Re-sort to preserve Stage A order (Stage B's findMany returns arbitrary order).
    const items: GlobalArtistChannelItemDto[] = [];
    for (const row of pageRows) {
      const ch = channelById.get(row.id);
      if (!ch) continue; // visibility flipped between stages → drop
      items.push({
        id: ch.id,
        name: ch.name,
        profileImage: ch.profileImageUrl ?? null,
        platform: ch.verifications[0]?.platform ?? 'OTHER',
        followerCount: ch._count.userFavorites,
        songCount: row.songCount,
        isLive: liveSet.has(ch.id),
      });
    }

    const nextCursor = hasMore
      ? encodeCursor<GlobalArtistChannelsCursorPayload>({
          songCount: pageRows[pageRows.length - 1].songCount,
          id: pageRows[pageRows.length - 1].id,
        })
      : null;

    return { items, nextCursor, mergedFrom: resolved.mergedFrom };
  }

  /* -------------------------------------------------------------------- */
  /*  GET /global-artists/:id/clips                                        */
  /* -------------------------------------------------------------------- */

  async getClips(
    id: number,
    query: GlobalSongClipQueryDto,
  ): Promise<GlobalSongClipResponseDto> {
    const limit = query.limit ?? 20;
    const sort: 'popular' | 'recent' = query.sort ?? 'popular';

    const resolved = await this.resolveMergedArtist(id);
    await this.assertArtistExists(resolved.canonicalId, id);

    let cursor: GlobalSongClipCursorPayload | null = null;
    if (query.cursor) {
      const decoded = decodeCursor<GlobalSongClipCursorPayload>(query.cursor);
      if (!decoded) {
        throw new BadRequestException('Invalid cursor');
      }
      if (decoded.sort !== 'popular' && decoded.sort !== 'recent') {
        throw new BadRequestException('Invalid cursor');
      }
      if (decoded.sort === 'popular') {
        if (
          typeof decoded.viewCount !== 'number' ||
          typeof decoded.id !== 'number'
        ) {
          throw new BadRequestException('Invalid cursor');
        }
      } else {
        if (
          typeof decoded.createdAt !== 'string' ||
          typeof decoded.id !== 'number' ||
          Number.isNaN(Date.parse(decoded.createdAt))
        ) {
          throw new BadRequestException('Invalid cursor');
        }
      }
      // Sort mismatch → silently ignore (treat as first page).
      if (decoded.sort === sort) {
        cursor = decoded;
      }
    }

    type IdRow = {
      id: number | bigint;
      viewCount: number | bigint;
      createdAt: Date;
    };

    let raw: IdRow[];
    if (sort === 'popular') {
      if (cursor && cursor.sort === 'popular') {
        raw = await this.prisma.$queryRaw<IdRow[]>`
          SELECT DISTINCT
                 c.id AS id,
                 CAST(COALESCE(cs.view_count, 0) AS SIGNED) AS viewCount,
                 c.created_at AS createdAt
            FROM clip_channels cc
            JOIN songs s ON cc.song_id = s.id
            JOIN global_songs gs ON s.global_song_id = gs.id
            JOIN clips c ON cc.clip_id = c.id
            JOIN channels ch ON cc.channel_id = ch.id
            LEFT JOIN clip_stats cs ON cs.clip_id = c.id
           WHERE gs.global_artist_id = ${resolved.canonicalId}
             AND c.status = 'visible'
             AND ch.visibility = 'PUBLIC'
             AND (
               COALESCE(cs.view_count, 0) < ${cursor.viewCount}
               OR (
                 COALESCE(cs.view_count, 0) = ${cursor.viewCount}
                 AND c.id < ${cursor.id}
               )
             )
           ORDER BY COALESCE(cs.view_count, 0) DESC, c.id DESC
           LIMIT ${limit + 1}
        `;
      } else {
        raw = await this.prisma.$queryRaw<IdRow[]>`
          SELECT DISTINCT
                 c.id AS id,
                 CAST(COALESCE(cs.view_count, 0) AS SIGNED) AS viewCount,
                 c.created_at AS createdAt
            FROM clip_channels cc
            JOIN songs s ON cc.song_id = s.id
            JOIN global_songs gs ON s.global_song_id = gs.id
            JOIN clips c ON cc.clip_id = c.id
            JOIN channels ch ON cc.channel_id = ch.id
            LEFT JOIN clip_stats cs ON cs.clip_id = c.id
           WHERE gs.global_artist_id = ${resolved.canonicalId}
             AND c.status = 'visible'
             AND ch.visibility = 'PUBLIC'
           ORDER BY COALESCE(cs.view_count, 0) DESC, c.id DESC
           LIMIT ${limit + 1}
        `;
      }
    } else {
      if (cursor && cursor.sort === 'recent') {
        const cursorDate = new Date(cursor.createdAt);
        raw = await this.prisma.$queryRaw<IdRow[]>`
          SELECT DISTINCT
                 c.id AS id,
                 CAST(COALESCE(cs.view_count, 0) AS SIGNED) AS viewCount,
                 c.created_at AS createdAt
            FROM clip_channels cc
            JOIN songs s ON cc.song_id = s.id
            JOIN global_songs gs ON s.global_song_id = gs.id
            JOIN clips c ON cc.clip_id = c.id
            JOIN channels ch ON cc.channel_id = ch.id
            LEFT JOIN clip_stats cs ON cs.clip_id = c.id
           WHERE gs.global_artist_id = ${resolved.canonicalId}
             AND c.status = 'visible'
             AND ch.visibility = 'PUBLIC'
             AND (
               c.created_at < ${cursorDate}
               OR (c.created_at = ${cursorDate} AND c.id < ${cursor.id})
             )
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT ${limit + 1}
        `;
      } else {
        raw = await this.prisma.$queryRaw<IdRow[]>`
          SELECT DISTINCT
                 c.id AS id,
                 CAST(COALESCE(cs.view_count, 0) AS SIGNED) AS viewCount,
                 c.created_at AS createdAt
            FROM clip_channels cc
            JOIN songs s ON cc.song_id = s.id
            JOIN global_songs gs ON s.global_song_id = gs.id
            JOIN clips c ON cc.clip_id = c.id
            JOIN channels ch ON cc.channel_id = ch.id
            LEFT JOIN clip_stats cs ON cs.clip_id = c.id
           WHERE gs.global_artist_id = ${resolved.canonicalId}
             AND c.status = 'visible'
             AND ch.visibility = 'PUBLIC'
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT ${limit + 1}
        `;
      }
    }

    const ordered = raw.map((r) => ({
      id: Number(r.id),
      viewCount: Number(r.viewCount),
      createdAt: r.createdAt,
    }));
    const hasMore = ordered.length > limit;
    const pageRows = hasMore ? ordered.slice(0, limit) : ordered;
    if (pageRows.length === 0) {
      return {
        items: [],
        nextCursor: null,
        mergedFrom: resolved.mergedFrom,
      };
    }

    // Stage B — clip detail + primary PUBLIC ClipChannel.
    const clipIds = pageRows.map((r) => r.id);
    const clips = await this.prisma.clip.findMany({
      where: { id: { in: clipIds } },
      select: {
        id: true,
        title: true,
        thumbnailUrl: true,
        duration: true,
        platform: true,
        createdAt: true,
        stat: { select: { viewCount: true } },
        clipChannels: {
          where: { channel: { visibility: 'PUBLIC' } },
          select: {
            isPrimary: true,
            channel: {
              select: {
                id: true,
                name: true,
                profileImageUrl: true,
              },
            },
          },
          orderBy: { isPrimary: 'desc' },
        },
      },
    });
    const clipsById = new Map(clips.map((c) => [c.id, c]));

    const items: GlobalSongClipDto[] = [];
    for (const row of pageRows) {
      const clip = clipsById.get(row.id);
      if (!clip) continue;
      const primary =
        clip.clipChannels.find((cc) => cc.isPrimary) ?? clip.clipChannels[0];
      if (!primary) continue;
      items.push({
        id: clip.id,
        title: clip.title,
        thumbnailUrl: clip.thumbnailUrl,
        duration: clip.duration,
        platform: String(clip.platform),
        channel: {
          id: primary.channel.id,
          name: primary.channel.name,
          profileImage: primary.channel.profileImageUrl ?? null,
        },
        viewCount: clip.stat?.viewCount ?? 0,
        createdAt: (clip.createdAt ?? new Date(0)).toISOString(),
      });
    }

    let nextCursor: string | null = null;
    if (hasMore) {
      const last = pageRows[pageRows.length - 1];
      const payload: GlobalSongClipCursorPayload =
        sort === 'popular'
          ? { sort: 'popular', viewCount: last.viewCount, id: last.id }
          : {
              sort: 'recent',
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            };
      nextCursor = encodeCursor(payload);
    }

    return {
      items,
      nextCursor,
      mergedFrom: resolved.mergedFrom,
    };
  }

  /* ==================================================================== */
  /*  Helpers                                                               */
  /* ==================================================================== */

  /**
   * Map a possibly-merged loser GlobalArtist id to its canonical winner.
   * Returns `mergedFrom = id` when the request landed on a loser, else null.
   */
  private async resolveMergedArtist(
    id: number,
  ): Promise<{ canonicalId: number; mergedFrom: number | null }> {
    const merge = await this.prisma.globalArtistMerge.findUnique({
      where: { loserId: id },
      select: { winnerId: true },
    });
    if (merge) {
      return { canonicalId: merge.winnerId, mergedFrom: id };
    }
    return { canonicalId: id, mergedFrom: null };
  }

  private async assertArtistExists(
    canonicalId: number,
    requestedId: number,
  ): Promise<void> {
    const exists = await this.prisma.globalArtist.findUnique({
      where: { id: canonicalId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`GlobalArtist ${requestedId} not found`);
    }
  }

  private async countDistinctChannels(globalArtistId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
      SELECT CAST(COUNT(DISTINCT s.channel_id) AS SIGNED) AS cnt
        FROM songs s
        JOIN global_songs gs ON s.global_song_id = gs.id
        JOIN channels ch ON s.channel_id = ch.id
       WHERE gs.global_artist_id = ${globalArtistId}
         AND ch.visibility = 'PUBLIC'
    `;
    return Number(rows[0]?.cnt ?? 0);
  }

  private async countDistinctClips(globalArtistId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ cnt: number | bigint }>>`
      SELECT CAST(COUNT(DISTINCT c.id) AS SIGNED) AS cnt
        FROM clip_channels cc
        JOIN songs s ON cc.song_id = s.id
        JOIN global_songs gs ON s.global_song_id = gs.id
        JOIN clips c ON cc.clip_id = c.id
        JOIN channels ch ON cc.channel_id = ch.id
       WHERE gs.global_artist_id = ${globalArtistId}
         AND c.status = 'visible'
         AND ch.visibility = 'PUBLIC'
    `;
    return Number(rows[0]?.cnt ?? 0);
  }

  private async resolveLiveStatus(channelIds: number[]): Promise<Set<number>> {
    if (channelIds.length === 0) return new Set();
    try {
      const statuses = await this.liveStatus.getLiveStatuses(channelIds);
      return new Set(
        statuses
          .filter((s) => (s.liveStatuses?.length ?? 0) > 0)
          .map((s) => s.channelId),
      );
    } catch (error) {
      this.logger.warn(
        `live status lookup failed, defaulting all to offline: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return new Set();
    }
  }
}
