import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { GlobalSongMergeService } from './global-song-merge.service';
import { LiveStatusService } from '../live-status/live-status.service';
import { normalizeTitle } from './normalizer/title-normalizer';
import {
  GlobalSongChannelDto,
  GlobalSongDetailResponseDto,
  GlobalSongMyRegistrationsResponseDto,
} from './dto/global-song-detail.dto';
import {
  GlobalSongClipCursorPayload,
  GlobalSongClipDto,
  GlobalSongClipQueryDto,
  GlobalSongClipResponseDto,
} from './dto/global-song-clips.dto';
import {
  GlobalSongByArtistResponseDto,
  GlobalSongSearchCursorPayload,
  GlobalSongSearchItemDto,
  GlobalSongSearchQueryDto,
  GlobalSongSearchResponseDto,
} from './dto/global-song-search.dto';
import {
  GlobalSongLyricsResponseDto,
  GlobalSongLyricsStatus,
} from './dto/global-song-lyrics.dto';
import { parseLrc } from './musixmatch/lrc.parser';

function normalizeGenres(
  raw: unknown,
): Array<{ id?: number; name?: string; vanity?: string }> | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    )
    .map((item) => {
      const out: { id?: number; name?: string; vanity?: string } = {};
      if (typeof item.id === 'number') out.id = item.id;
      if (typeof item.name === 'string') out.name = item.name;
      if (typeof item.vanity === 'string') out.vanity = item.vanity;
      return out;
    });
}

function getLyricsStatus(params: {
  matcherStatus: string;
  mxmInstrumental: boolean;
  hasLyrics: boolean;
  restrictedKr: boolean;
}): GlobalSongLyricsStatus {
  switch (params.matcherStatus) {
    case 'ERROR':
      return 'ERROR';
    case 'PENDING':
    case 'UNMATCHED':
    case 'MANUAL_NEEDED':
    case 'IGNORED':
    case 'MATCHED_DUP_OF_OTHER':
      return 'UNMATCHED';
    case 'MATCHED_NO_LYRICS':
      return 'NO_LYRICS';
    case 'MATCHED_INSTRUMENTAL':
      return 'INSTRUMENTAL';
    case 'MATCHED_RESTRICTED':
      return 'RESTRICTED';
    case 'MATCHED':
      break;
  }

  if (params.mxmInstrumental) return 'INSTRUMENTAL';
  if (!params.hasLyrics) return 'PENDING_LYRICS';
  if (params.restrictedKr) return 'RESTRICTED';
  return 'OK';
}

/**
 * Public read APIs for the GlobalSong detail page.
 *
 * Surfaces three endpoints:
 *   - getDetail(id)         → global-song + cross-channel streamer list
 *   - getClips(id, query)   → clip feed sortable by popularity/recency
 *   - search(query)         → global-song search with channelCount > 0 filter
 *
 * See spec 2026-04-12-globalsong-detail-design.md Section 4 for the
 * authoritative response shapes and edge cases.
 */
@Injectable()
export class GlobalSongPublicService {
  private readonly logger = new Logger(GlobalSongPublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
    private readonly liveStatus: LiveStatusService,
    private readonly mergeService: GlobalSongMergeService,
  ) {}

  /* -------------------------------------------------------------------- */
  /*  GET /global-songs/:id                                                */
  /* -------------------------------------------------------------------- */

  async getDetail(id: number): Promise<GlobalSongDetailResponseDto> {
    // 1. Base GlobalSong + artist. If the id was a merged loser, resolve to
    //    the winner and mark mergedFrom so clients (web route, mobile) can
    //    update their stored id / SEO URL.
    const resolved = await this.mergeService.resolveMerged(id);
    const globalSong = await this.prisma.globalSong.findUnique({
      where: { id: resolved.canonicalId },
      include: { globalArtist: true },
    });
    if (!globalSong) {
      throw new NotFoundException(`GlobalSong ${id} not found`);
    }

    // 2. Channels that have this song (via Redis index).
    //
    //    Fall back to Song.globalSongId if Redis is empty — this keeps the
    //    endpoint functional if Redis is cold-started or not indexed yet.
    const channelIds = await this.resolveChannelIds(resolved.canonicalId);

    // 3. Channel details + active filter + platform + followerCount
    const channels = await this.loadChannels(channelIds);

    // 4. isLive (best-effort; swallow gRPC failures as "not live")
    const liveMap = await this.resolveLiveStatus(channels.map((c) => c.id));

    // 5. Clip count (DISTINCT — a clip may link via multiple ClipChannels to
    //    different Song rows of the same GlobalSong).
    const clipCount = await this.countClipsForGlobalSong(resolved.canonicalId);

    // 5.5. albumArt fallback chain (Musixmatch → most-used Song.albumArt →
    //      GlobalSong.albumArt). 클라이언트가 onError 시 다음 url 로 자동
    //      fallback 한 뒤, 전부 실패하면 음표 placeholder 를 노출한다.
    const albumArtUrls = await this.resolveAlbumArtUrls(globalSong);

    // 6. Assemble + sort (live first, then followerCount desc, then id asc).
    const channelDtos: GlobalSongChannelDto[] = channels
      .map((c) => ({
        id: c.id,
        name: c.name,
        profileImage: c.profileImage,
        platform: c.platform,
        followerCount: c.followerCount,
        isLive: liveMap.has(c.id),
      }))
      .sort((a, b) => {
        if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
        if (a.followerCount !== b.followerCount) {
          return b.followerCount - a.followerCount;
        }
        return a.id - b.id;
      });

    return {
      id: globalSong.id,
      title: globalSong.title,
      artist: {
        id: globalSong.globalArtist.id,
        name: globalSong.globalArtist.canonicalName,
      },
      albumArt: albumArtUrls[0] ?? null,
      albumArtUrls,
      channelCount: channelDtos.length,
      clipCount,
      channels: channelDtos,
      spotifyTrackId: globalSong.spotifyTrackId,
      mergedFrom: resolved.mergedFrom,
    };
  }

  /* -------------------------------------------------------------------- */
  /*  GET /global-songs/:id/lyrics                                         */
  /* -------------------------------------------------------------------- */

  async getLyrics(id: number): Promise<GlobalSongLyricsResponseDto> {
    const resolved = await this.mergeService.resolveMerged(id);
    const globalSong = await this.prisma.globalSong.findUnique({
      where: { id: resolved.canonicalId },
      select: {
        id: true,
        title: true,
        albumArt: true,
        mxmAlbumName: true,
        mxmTrackLengthSec: true,
        primaryIsrc: true,
        mxmInstrumental: true,
        mxmGenresJson: true,
        matcherStatus: true,
        globalArtist: { select: { id: true, canonicalName: true } },
        lyrics: {
          select: {
            body: true,
            bodyKoPron: true,
            bodyTranslation: true,
            bodyTranslationLanguage: true,
            language: true,
            hasSubtitle: true,
            subtitleBody: true,
            hasRichsync: true,
            copyrightLine: true,
            shareUrl: true,
            trackingPixel: true,
            restrictedKr: true,
            fetchedAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!globalSong) {
      throw new NotFoundException(`GlobalSong ${id} not found`);
    }

    const globalSongMeta = {
      id: globalSong.id,
      title: globalSong.title,
      artist: globalSong.globalArtist.canonicalName,
      albumArt: globalSong.albumArt,
      mxmAlbumName: globalSong.mxmAlbumName,
      mxmTrackLengthSec: globalSong.mxmTrackLengthSec,
      primaryIsrc: globalSong.primaryIsrc,
      language: globalSong.lyrics?.language ?? null,
      genres: normalizeGenres(globalSong.mxmGenresJson),
    };

    const status = getLyricsStatus({
      matcherStatus: globalSong.matcherStatus,
      mxmInstrumental: globalSong.mxmInstrumental,
      hasLyrics: globalSong.lyrics !== null,
      restrictedKr: globalSong.lyrics?.restrictedKr ?? false,
    });

    const response: GlobalSongLyricsResponseDto = {
      status,
      globalSong: globalSongMeta,
      mergedFrom: resolved.mergedFrom,
    };

    if (status !== 'OK' || !globalSong.lyrics) {
      return response;
    }

    const lrcLines = globalSong.lyrics.hasSubtitle
      ? parseLrc(globalSong.lyrics.subtitleBody)
      : [];
    const koPronLines = splitAlignedLines(
      globalSong.lyrics.bodyKoPron,
      lrcLines.length,
    );
    const translationLines = splitAlignedLines(
      globalSong.lyrics.bodyTranslation,
      lrcLines.length,
    );
    const syncedLines = lrcLines.map((line, index) => ({
      ...line,
      koPron: koPronLines?.[index] ?? null,
      translation: translationLines?.[index] ?? null,
    }));
    response.lyrics = {
      body: globalSong.lyrics.body,
      bodyKoPron: globalSong.lyrics.bodyKoPron,
      bodyTranslation: globalSong.lyrics.bodyTranslation,
      bodyTranslationLanguage: globalSong.lyrics.bodyTranslationLanguage,
      language: globalSong.lyrics.language,
      synced: {
        format:
          globalSong.lyrics.hasSubtitle && syncedLines.length > 0
            ? 'lrc'
            : null,
        lines:
          globalSong.lyrics.hasSubtitle && syncedLines.length > 0
            ? syncedLines
            : null,
      },
      hasRichsync: globalSong.lyrics.hasRichsync,
      richsync: null,
      copyrightLine: globalSong.lyrics.copyrightLine,
      shareUrl: globalSong.lyrics.shareUrl,
      tracking: {
        script: null,
        pixel: globalSong.lyrics.trackingPixel,
      },
      fetchedAt: globalSong.lyrics.fetchedAt.toISOString(),
      updatedAt: globalSong.lyrics.updatedAt.toISOString(),
    };

    return response;
  }

  /**
   * 단일 GlobalSong 의 album art fallback chain 을 우선순위 배열로 만든다.
   * popular endpoint 의 batch fallback 과 동일 우선순위 (Musixmatch → most-used
   * Song.albumArt → GlobalSong.albumArt) 를 단일 곡에 inline 적용한 형태.
   */
  private async resolveAlbumArtUrls(globalSong: {
    id: number;
    albumArt: string | null;
    mxmAlbumArtUrl: string | null;
  }): Promise<string[]> {
    // PUBLIC 채널의 Song.albumArt 만 후보. PRIVATE/UNLISTED 채널이 들고 있는
    // url 이 public detail 응답으로 새어 나가지 않게 visibility 필터 명시.
    // tie-break 결정성 위해 (count DESC, url ASC) 로 popular 와 동일 규칙 적용.
    const songRows = await this.prisma.song.findMany({
      where: {
        globalSongId: globalSong.id,
        albumArt: { not: null },
        channel: { visibility: 'PUBLIC' },
      },
      select: { albumArt: true },
    });

    const freq = new Map<string, number>();
    for (const r of songRows) {
      const url = r.albumArt;
      if (!url) continue;
      freq.set(url, (freq.get(url) ?? 0) + 1);
    }
    let mostUsed: string | null = null;
    let bestCount = 0;
    for (const [url, count] of freq) {
      if (
        count > bestCount ||
        (count === bestCount && mostUsed !== null && url < mostUsed)
      ) {
        mostUsed = url;
        bestCount = count;
      }
    }

    const urls: string[] = [];
    if (globalSong.mxmAlbumArtUrl) urls.push(globalSong.mxmAlbumArtUrl);
    if (mostUsed && !urls.includes(mostUsed)) urls.push(mostUsed);
    if (globalSong.albumArt && !urls.includes(globalSong.albumArt)) {
      urls.push(globalSong.albumArt);
    }
    return urls;
  }

  /* -------------------------------------------------------------------- */
  /*  GET /global-songs/:id/clips                                           */
  /* -------------------------------------------------------------------- */

  async getClips(
    globalSongId: number,
    query: GlobalSongClipQueryDto,
  ): Promise<GlobalSongClipResponseDto> {
    const limit = query.limit ?? 20;
    const sort: 'popular' | 'recent' = query.sort ?? 'popular';

    // Merged loser → winner resolution (same contract as getDetail).
    const resolved = await this.mergeService.resolveMerged(globalSongId);

    // Verify GlobalSong exists so callers get a proper 404 rather than an
    // empty list when the ID is bogus.
    const exists = await this.prisma.globalSong.findUnique({
      where: { id: resolved.canonicalId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`GlobalSong ${globalSongId} not found`);
    }

    // Cursor: decode failure → 400. Sort mismatch → ignore (first page).
    let cursor: GlobalSongClipCursorPayload | null = null;
    if (query.cursor) {
      const decoded = decodeCursor<GlobalSongClipCursorPayload>(query.cursor);
      if (!decoded) {
        // Base64 / JSON parse failure → caller sent a malformed cursor.
        throw new BadRequestException('Invalid cursor');
      }
      // The cursor payload must carry a sort tag matching the enum; anything
      // else is structurally invalid (not just a sort mismatch).
      if (decoded.sort !== 'popular' && decoded.sort !== 'recent') {
        throw new BadRequestException('Invalid cursor');
      }
      // Validate the payload fields for the claimed sort variant. A well-formed
      // base64 JSON with a valid `sort` tag is not enough — the per-branch
      // fields (viewCount/createdAt + id) must be the right types, otherwise
      // they flow into raw SQL (popular) or `new Date()` (recent) and produce
      // silently wrong data or 500s downstream.
      if (decoded.sort === 'popular') {
        if (
          typeof decoded.viewCount !== 'number' ||
          typeof decoded.id !== 'number'
        ) {
          throw new BadRequestException('Invalid cursor');
        }
      } else {
        // decoded.sort === 'recent'
        if (
          typeof decoded.createdAt !== 'string' ||
          typeof decoded.id !== 'number' ||
          Number.isNaN(Date.parse(decoded.createdAt))
        ) {
          throw new BadRequestException('Invalid cursor');
        }
      }
      // Sort mismatch → silently ignore and treat as first page (spec:
      // "sort 변경 시 cursor 무효"). Sort match → use cursor.
      if (decoded.sort === sort) {
        cursor = decoded;
      }
    }

    // Stage A: DISTINCT clip IDs ordered by the chosen sort.
    const idRows = await this.fetchClipIdsOrdered(
      resolved.canonicalId,
      sort,
      cursor,
      limit + 1, // +1 sentinel to detect "has more"
    );

    const hasMore = idRows.length > limit;
    const pageRows = hasMore ? idRows.slice(0, limit) : idRows;
    if (pageRows.length === 0) {
      return {
        items: [],
        nextCursor: null,
        globalSongId: resolved.canonicalId,
        mergedFrom: resolved.mergedFrom,
      };
    }

    // Stage B: fetch details for the IDs, re-sort to preserve Stage A order.
    // Only PUBLIC channels are surfaced — private/unlisted channels must not
    // leak identity via the clip primary channel even if the clip itself is
    // visible (mirrors the visibility=PUBLIC filter used in getDetail).
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
      const primaryChannel =
        clip.clipChannels.find((cc) => cc.isPrimary) ?? clip.clipChannels[0];
      if (!primaryChannel) continue;

      items.push({
        id: clip.id,
        title: clip.title,
        thumbnailUrl: clip.thumbnailUrl,
        duration: clip.duration,
        platform: String(clip.platform),
        channel: {
          id: primaryChannel.channel.id,
          name: primaryChannel.channel.name,
          profileImage: primaryChannel.channel.profileImageUrl ?? null,
        },
        viewCount: clip.stat?.viewCount ?? 0,
        createdAt: (clip.createdAt ?? new Date(0)).toISOString(),
      });
    }

    // nextCursor is derived from the LAST item of the page (not the sentinel).
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
      globalSongId: resolved.canonicalId,
      mergedFrom: resolved.mergedFrom,
    };
  }

  /* -------------------------------------------------------------------- */
  /*  GET /global-songs/search                                              */
  /* -------------------------------------------------------------------- */

  async search(
    query: GlobalSongSearchQueryDto,
  ): Promise<GlobalSongSearchResponseDto> {
    const limit = query.limit ?? 20;

    // Normalize q the same way the indexer/matcher does so prefix LIKE
    // hits the same rows as exact matching.
    let normalized: string;
    try {
      normalized = normalizeTitle(query.q).normTitle;
    } catch {
      // Empty-after-normalize or too-long — treat as empty result.
      return { items: [], nextCursor: null };
    }
    if (!normalized) {
      return { items: [], nextCursor: null };
    }

    // Decode cursor. Parse failure → 400.
    let cursor: GlobalSongSearchCursorPayload | null = null;
    if (query.cursor) {
      const decoded = decodeCursor<GlobalSongSearchCursorPayload>(query.cursor);
      if (
        !decoded ||
        typeof decoded.channelCount !== 'number' ||
        typeof decoded.id !== 'number'
      ) {
        throw new BadRequestException('Invalid cursor');
      }
      cursor = decoded;
    }

    // Match either normTitle or any alias's normAliasTitle for the song.
    // Keyset pagination by (channelCount DESC, id DESC) is applied below.
    const where: Prisma.GlobalSongWhereInput = {
      channelCount: { gt: 0 },
      OR: [
        { normTitle: { startsWith: normalized } },
        {
          aliases: {
            some: {
              normAliasTitle: { startsWith: normalized },
            },
          },
        },
      ],
    };

    if (cursor) {
      // (channelCount, id) < (cursor.channelCount, cursor.id)
      where.AND = [
        {
          OR: [
            { channelCount: { lt: cursor.channelCount } },
            {
              AND: [
                { channelCount: cursor.channelCount },
                { id: { lt: cursor.id } },
              ],
            },
          ],
        },
      ];
    }

    const rows = await this.prisma.globalSong.findMany({
      where,
      include: { globalArtist: true },
      orderBy: [{ channelCount: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: GlobalSongSearchItemDto[] = pageRows.map((row) => ({
      id: row.id,
      title: row.title,
      artist: {
        id: row.globalArtist.id,
        name: row.globalArtist.canonicalName,
      },
      albumArt: row.albumArt,
      channelCount: row.channelCount,
    }));

    const nextCursor = hasMore
      ? encodeCursor<GlobalSongSearchCursorPayload>({
          channelCount: pageRows[pageRows.length - 1].channelCount,
          id: pageRows[pageRows.length - 1].id,
        })
      : null;

    return { items, nextCursor };
  }

  /* -------------------------------------------------------------------- */
  /*  GET /global-songs/:id/by-artist                                       */
  /* -------------------------------------------------------------------- */

  /**
   * Other GlobalSongs of the same GlobalArtist that have at least one channel
   * registered. Ordered (channelCount DESC, id DESC), excludes self.
   *
   * No pagination — caller passes `limit` (1..50, default 10). The "이
   * 아티스트의 다른 노래" surface on /song/:id is bounded; if richer browsing
   * is needed callers should use `/global-songs/search` with the artist name
   * instead.
   */
  async getByArtist(
    globalSongId: number,
    limit: number,
  ): Promise<GlobalSongByArtistResponseDto> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 10));

    const resolved = await this.mergeService.resolveMerged(globalSongId);

    const self = await this.prisma.globalSong.findUnique({
      where: { id: resolved.canonicalId },
      select: { globalArtistId: true },
    });
    if (!self) return { items: [] };

    const rows = await this.prisma.globalSong.findMany({
      where: {
        globalArtistId: self.globalArtistId,
        id: { not: resolved.canonicalId },
        channelCount: { gt: 0 },
      },
      include: { globalArtist: true },
      orderBy: [{ channelCount: 'desc' }, { id: 'desc' }],
      take: safeLimit,
    });

    const items: GlobalSongSearchItemDto[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      artist: {
        id: row.globalArtist.id,
        name: row.globalArtist.canonicalName,
      },
      albumArt: row.albumArt,
      channelCount: row.channelCount,
    }));

    return { items };
  }

  /* -------------------------------------------------------------------- */
  /*  GET /global-songs/:id/my-registrations  (JWT)                         */
  /* -------------------------------------------------------------------- */

  /**
   * Channel ids belonging to the caller (owned + active manager) that already
   * have this GlobalSong registered. Visibility-agnostic — `getDetail` only
   * surfaces PUBLIC channels in `detail.channels`, so the front-end can't
   * derive correct "이미 등록되어 있어요" status from that list alone when
   * the user has UNLISTED/PRIVATE channels.
   */
  async getMyRegistrations(
    globalSongId: number,
    userId: number,
  ): Promise<GlobalSongMyRegistrationsResponseDto> {
    const resolved = await this.mergeService.resolveMerged(globalSongId);

    const myChannels = await this.prisma.channel.findMany({
      where: {
        OR: [
          { userId },
          { managers: { some: { userId, isActive: true } } },
        ],
      },
      select: { id: true },
    });

    if (myChannels.length === 0) {
      return {
        registeredChannelIds: [],
        globalSongId: resolved.canonicalId,
        mergedFrom: resolved.mergedFrom,
      };
    }

    const songs = await this.prisma.song.findMany({
      where: {
        globalSongId: resolved.canonicalId,
        channelId: { in: myChannels.map((c) => c.id) },
      },
      select: { channelId: true },
      distinct: ['channelId'],
    });

    return {
      registeredChannelIds: songs.map((s) => s.channelId),
      globalSongId: resolved.canonicalId,
      mergedFrom: resolved.mergedFrom,
    };
  }

  /* -------------------------------------------------------------------- */
  /*  GET /global-songs/me/registered-ids  (JWT)                          */
  /* -------------------------------------------------------------------- */

  /**
   * Distinct GlobalSong ids the caller has under any owned + active-manager
   * channel. Used by the SongCard overlay to suppress the "+ 노래책에 추가"
   * button on songs the user already has somewhere.
   *
   * Caller without any channels gets an empty list. Songs whose
   * Song.globalSongId is null (unmapped channel-local rows) are skipped.
   */
  async getMyRegisteredGlobalSongIds(
    userId: number,
  ): Promise<{ registeredGlobalSongIds: number[] }> {
    const myChannels = await this.prisma.channel.findMany({
      where: {
        OR: [
          { userId },
          { managers: { some: { userId, isActive: true } } },
        ],
      },
      select: { id: true },
    });
    if (myChannels.length === 0) {
      return { registeredGlobalSongIds: [] };
    }

    const songs = await this.prisma.song.findMany({
      where: {
        channelId: { in: myChannels.map((c) => c.id) },
        globalSongId: { not: null },
      },
      select: { globalSongId: true },
      distinct: ['globalSongId'],
    });

    return {
      registeredGlobalSongIds: songs
        .map((s) => s.globalSongId)
        .filter((id): id is number => id !== null),
    };
  }

  /* ==================================================================== */
  /*  Helpers                                                               */
  /* ==================================================================== */

  /**
   * Read the `gs:{id}:channels` HASH for active channel IDs. Falls back to
   * Song.globalSongId lookup if Redis is unavailable or the hash is empty.
   */
  private async resolveChannelIds(globalSongId: number): Promise<number[]> {
    if (this.redis.isReady()) {
      try {
        const hash = await this.redis.getChannelSongMappingAll(globalSongId);
        if (hash && Object.keys(hash).length > 0) {
          return Object.keys(hash)
            .map((k) => parseInt(k, 10))
            .filter((n) => Number.isFinite(n));
        }
      } catch (error) {
        this.logger.warn(
          `Redis getChannelSongMappingAll failed, falling back to DB: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    const songs = await this.prisma.song.findMany({
      where: { globalSongId },
      select: { channelId: true },
      distinct: ['channelId'],
    });
    return songs.map((s) => s.channelId);
  }

  /**
   * Load active channels (visibility=PUBLIC) with platform + follower count.
   *
   *   - platform: first APPROVED ChannelVerification (falls back to 'OTHER').
   *   - followerCount: COUNT(user_channel_favorites) — meloming's equivalent
   *     of a platform follower count.
   */
  private async loadChannels(channelIds: number[]): Promise<
    Array<{
      id: number;
      name: string;
      profileImage: string | null;
      platform: string;
      followerCount: number;
    }>
  > {
    if (channelIds.length === 0) return [];

    const rows = await this.prisma.channel.findMany({
      where: {
        id: { in: channelIds },
        visibility: 'PUBLIC',
      },
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

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      profileImage: r.profileImageUrl ?? null,
      platform: r.verifications[0]?.platform ?? 'OTHER',
      followerCount: r._count.userFavorites,
    }));
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
      // gRPC / chat-query outage → treat everyone as offline so we still
      // serve a usable detail page.
      this.logger.warn(
        `live status lookup failed, defaulting all channels to offline: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return new Set();
    }
  }

  private async countClipsForGlobalSong(globalSongId: number): Promise<number> {
    // Prisma enum PostStatus.VISIBLE is persisted as the lowercase string
    // 'visible' (see @map in schema.prisma).
    // Only count clips that have at least one PUBLIC ClipChannel linked via
    // this GlobalSong's Songs — otherwise Stage A would exclude the clip but
    // the count would still include it (visibility leak via count delta).
    const rows = await this.prisma.$queryRaw<Array<{ cnt: number }>>`
      SELECT CAST(COUNT(DISTINCT c.id) AS SIGNED) AS cnt
        FROM clip_channels cc
        JOIN songs s ON cc.song_id = s.id
        JOIN clips c ON cc.clip_id = c.id
        JOIN channels ch ON cc.channel_id = ch.id
       WHERE s.global_song_id = ${globalSongId}
         AND c.status = 'visible'
         AND ch.visibility = 'PUBLIC'
    `;
    return Number(rows[0]?.cnt ?? 0);
  }

  /**
   * Stage A clip query: DISTINCT Clip IDs ordered + paged.
   *
   * Returns the ordered clip IDs, the viewCount snapshot used for sorting
   * (via COALESCE on clip_stats), and createdAt. The service uses these to
   * build the next cursor + to re-sort Stage B results.
   */
  private async fetchClipIdsOrdered(
    globalSongId: number,
    sort: 'popular' | 'recent',
    cursor: GlobalSongClipCursorPayload | null,
    take: number,
  ): Promise<Array<{ id: number; viewCount: number; createdAt: Date }>> {
    // CAST(... AS SIGNED) on the viewCount expression avoids BigInt returns
    // from the MySQL driver and keeps numbers JS-friendly.
    let raw: Array<{
      id: number | bigint;
      viewCount: number | bigint;
      createdAt: Date;
    }>;
    // Every Stage A query joins channels and restricts cc.channel_id to a
    // PUBLIC channel. This ensures DISTINCT clip IDs only surface clips that
    // have at least one PUBLIC ClipChannel linked via this GlobalSong's Songs.
    // Without this join, a clip whose only link to the GlobalSong is a
    // PRIVATE-channel ClipChannel would still appear — and Stage B would have
    // nothing to render because its visibility filter drops all rows.
    if (sort === 'popular') {
      if (cursor && cursor.sort === 'popular') {
        raw = await this.prisma.$queryRaw<
          Array<{
            id: number | bigint;
            viewCount: number | bigint;
            createdAt: Date;
          }>
        >`
          SELECT DISTINCT
                 c.id AS id,
                 CAST(COALESCE(cs.view_count, 0) AS SIGNED) AS viewCount,
                 c.created_at AS createdAt
            FROM clip_channels cc
            JOIN songs s ON cc.song_id = s.id
            JOIN clips c ON cc.clip_id = c.id
            JOIN channels ch ON cc.channel_id = ch.id
            LEFT JOIN clip_stats cs ON cs.clip_id = c.id
           WHERE s.global_song_id = ${globalSongId}
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
           LIMIT ${take}
        `;
      } else {
        raw = await this.prisma.$queryRaw<
          Array<{
            id: number | bigint;
            viewCount: number | bigint;
            createdAt: Date;
          }>
        >`
          SELECT DISTINCT
                 c.id AS id,
                 CAST(COALESCE(cs.view_count, 0) AS SIGNED) AS viewCount,
                 c.created_at AS createdAt
            FROM clip_channels cc
            JOIN songs s ON cc.song_id = s.id
            JOIN clips c ON cc.clip_id = c.id
            JOIN channels ch ON cc.channel_id = ch.id
            LEFT JOIN clip_stats cs ON cs.clip_id = c.id
           WHERE s.global_song_id = ${globalSongId}
             AND c.status = 'visible'
             AND ch.visibility = 'PUBLIC'
           ORDER BY COALESCE(cs.view_count, 0) DESC, c.id DESC
           LIMIT ${take}
        `;
      }
    } else {
      // sort === 'recent'
      if (cursor && cursor.sort === 'recent') {
        const cursorDate = new Date(cursor.createdAt);
        raw = await this.prisma.$queryRaw<
          Array<{
            id: number | bigint;
            viewCount: number | bigint;
            createdAt: Date;
          }>
        >`
          SELECT DISTINCT
                 c.id AS id,
                 CAST(COALESCE(cs.view_count, 0) AS SIGNED) AS viewCount,
                 c.created_at AS createdAt
            FROM clip_channels cc
            JOIN songs s ON cc.song_id = s.id
            JOIN clips c ON cc.clip_id = c.id
            JOIN channels ch ON cc.channel_id = ch.id
            LEFT JOIN clip_stats cs ON cs.clip_id = c.id
           WHERE s.global_song_id = ${globalSongId}
             AND c.status = 'visible'
             AND ch.visibility = 'PUBLIC'
             AND (
               c.created_at < ${cursorDate}
               OR (c.created_at = ${cursorDate} AND c.id < ${cursor.id})
             )
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT ${take}
        `;
      } else {
        raw = await this.prisma.$queryRaw<
          Array<{
            id: number | bigint;
            viewCount: number | bigint;
            createdAt: Date;
          }>
        >`
          SELECT DISTINCT
                 c.id AS id,
                 CAST(COALESCE(cs.view_count, 0) AS SIGNED) AS viewCount,
                 c.created_at AS createdAt
            FROM clip_channels cc
            JOIN songs s ON cc.song_id = s.id
            JOIN clips c ON cc.clip_id = c.id
            JOIN channels ch ON cc.channel_id = ch.id
            LEFT JOIN clip_stats cs ON cs.clip_id = c.id
           WHERE s.global_song_id = ${globalSongId}
             AND c.status = 'visible'
             AND ch.visibility = 'PUBLIC'
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT ${take}
        `;
      }
    }

    return raw.map((r) => ({
      id: Number(r.id),
      viewCount: Number(r.viewCount),
      createdAt: r.createdAt,
    }));
  }
}

function splitAlignedLines(
  body: string | null,
  expectedLineCount: number,
): string[] | null {
  if (!body || expectedLineCount <= 0) return null;
  const lines = body.split(/\r?\n/);
  return lines.length === expectedLineCount ? lines : null;
}

/* -------------------------------------------------------------------------- */
/*  Cursor codec                                                                */
/* -------------------------------------------------------------------------- */

export function encodeCursor<T>(payload: T): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode a Base64(url)-encoded JSON cursor. Returns null if the payload is
 * malformed — callers decide whether to 400 or fall back to first-page.
 */
export function decodeCursor<T>(raw: string): T | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed as T;
    return null;
  } catch {
    return null;
  }
}
