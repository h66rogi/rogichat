import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  GlobalSongLiveNowItemDto,
  GlobalSongMostClippedItemDto,
  GlobalSongMostDonatedItemDto,
  GlobalSongMostLikedItemDto,
  GlobalSongMostRequestedItemDto,
  GlobalSongPopularChannelDto,
  GlobalSongPopularItemDto,
  GlobalSongPopularNewcomerDto,
  GlobalSongPopularResponseDto,
  GlobalSongPopularSectionQueryDto,
  GlobalSongPopularSectionResponseDto,
  type GlobalSongPopularSectionKey,
  GlobalSongPopularTopArtistDto,
} from './dto/global-song-popular.dto';

const RANKING_LIMIT = 50;
const NEWCOMERS_LIMIT = 20;
const TOP_ARTISTS_LIMIT = 10;
const SONGS_PER_ARTIST = 3;
const TOP_CHANNELS_PER_SONG = 5;
const LIVE_NOW_LIMIT = 12;
const MOST_REQUESTED_LIMIT = 12;
const MOST_LIKED_LIMIT = 12;
const MOST_HOT_CLIPS_LIMIT = 12;
const MOST_DONATED_LIMIT = 12;
const RECENT_WINDOW_DAYS = 7;
const SECTION_PAGE_LIMIT = 100;
const SECTION_MAX_RANK = 500;

type RowWithArtist = {
  id: number;
  title: string;
  albumArt: string | null;
  channelCount: number;
  globalArtist: { id: number; canonicalName: string };
};

@Injectable()
export class GlobalSongPopularService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregates the three sections that power /musicbook/song.
   * All sections are computed in parallel; controller serves the result with
   * a public Cache-Control header.
   */
  async getPopular(): Promise<GlobalSongPopularResponseDto> {
    const [
      ranking,
      newcomers,
      topArtists,
      liveNowMetrics,
      mostRequestedMetrics,
      mostLikedMetrics,
      mostHotClipsMetrics,
      mostDonatedMetrics,
    ] = await Promise.all([
      this.fetchRanking(),
      this.fetchNewcomers(),
      this.fetchTopArtists(),
      this.fetchLiveNowMetrics(),
      this.fetchMostRequestedMetrics(),
      this.fetchMostLikedMetrics(),
      this.fetchMostHotClipsMetrics(),
      this.fetchMostDonatedMetrics(),
    ]);

    const allGsIds = new Set<number>();
    ranking.forEach((s) => allGsIds.add(s.id));
    newcomers.forEach((s) => allGsIds.add(s.id));
    topArtists.forEach((a) => a.topSongs.forEach((s) => allGsIds.add(s.id)));
    liveNowMetrics.forEach((m) => allGsIds.add(m.globalSongId));
    mostRequestedMetrics.forEach((m) => allGsIds.add(m.globalSongId));
    mostLikedMetrics.forEach((m) => allGsIds.add(m.globalSongId));
    mostHotClipsMetrics.forEach((m) => allGsIds.add(m.globalSongId));
    mostDonatedMetrics.forEach((m) => allGsIds.add(m.globalSongId));

    const facetIds = uniqueFacetIds([
      ...liveNowMetrics.map((m) => m.globalSongId),
      ...mostRequestedMetrics.map((m) => m.globalSongId),
      ...mostLikedMetrics.map((m) => m.globalSongId),
      ...mostHotClipsMetrics.map((m) => m.globalSongId),
      ...mostDonatedMetrics.map((m) => m.globalSongId),
    ]);
    const facetBaseRows = await this.fetchBaseRowsByIds(facetIds);

    const ids = [...allGsIds];
    const [channelsBySong, mostUsedAlbumArtBySong, mxmAlbumArtBySong] =
      await Promise.all([
        this.fetchTopChannelsBySong(ids),
        this.fetchMostUsedAlbumArtBySong(ids),
        this.fetchMxmAlbumArtBySong(ids),
      ]);

    attachChannels(ranking, channelsBySong);
    attachChannels(newcomers, channelsBySong);
    topArtists.forEach((a) => attachChannels(a.topSongs, channelsBySong));

    buildAlbumArtChain(ranking, mostUsedAlbumArtBySong, mxmAlbumArtBySong);
    buildAlbumArtChain(newcomers, mostUsedAlbumArtBySong, mxmAlbumArtBySong);
    topArtists.forEach((a) =>
      buildAlbumArtChain(
        a.topSongs,
        mostUsedAlbumArtBySong,
        mxmAlbumArtBySong,
      ),
    );

    const buildBase = (gsId: number): GlobalSongPopularItemDto | null => {
      const row = facetBaseRows.get(gsId);
      if (!row) return null;
      const item = rowToItem(row);
      attachChannels([item], channelsBySong);
      buildAlbumArtChain([item], mostUsedAlbumArtBySong, mxmAlbumArtBySong);
      return item;
    };

    const liveNow: GlobalSongLiveNowItemDto[] = [];
    for (const m of liveNowMetrics) {
      const base = buildBase(m.globalSongId);
      if (!base) continue;
      liveNow.push({ ...base, liveCount: m.liveCount });
    }

    const mostRequestedThisWeek: GlobalSongMostRequestedItemDto[] = [];
    for (const m of mostRequestedMetrics) {
      const base = buildBase(m.globalSongId);
      if (!base) continue;
      mostRequestedThisWeek.push({
        ...base,
        recentRequestCount: m.recentRequestCount,
      });
    }

    const mostLiked: GlobalSongMostLikedItemDto[] = [];
    for (const m of mostLikedMetrics) {
      const base = buildBase(m.globalSongId);
      if (!base) continue;
      mostLiked.push({ ...base, likeCount: m.likeCount });
    }

    const mostHotClips: GlobalSongMostClippedItemDto[] = [];
    for (const m of mostHotClipsMetrics) {
      const base = buildBase(m.globalSongId);
      if (!base) continue;
      mostHotClips.push({
        ...base,
        clipCount: m.clipCount,
        clipViewSum: m.clipViewSum,
      });
    }

    const mostDonated: GlobalSongMostDonatedItemDto[] = [];
    for (const m of mostDonatedMetrics) {
      const base = buildBase(m.globalSongId);
      if (!base) continue;
      mostDonated.push({
        ...base,
        recentDonationKrw: m.recentDonationKrw,
      });
    }

    return {
      ranking,
      newcomers,
      topArtists,
      liveNow,
      mostRequestedThisWeek,
      mostLiked,
      mostHotClips,
      mostDonated,
      generatedAt: new Date().toISOString(),
    };
  }

  async getPopularSection(
    section: GlobalSongPopularSectionKey,
    query: GlobalSongPopularSectionQueryDto,
  ): Promise<GlobalSongPopularSectionResponseDto> {
    const requestedLimit = Math.min(
      query.limit ?? SECTION_PAGE_LIMIT,
      SECTION_PAGE_LIMIT,
    );
    const offset = Math.min(query.offset ?? 0, SECTION_MAX_RANK);
    const readableCount = Math.max(0, SECTION_MAX_RANK - offset);
    const take = Math.min(requestedLimit + 1, readableCount);

    if (take === 0) {
      return {
        section,
        items: [],
        limit: requestedLimit,
        offset,
        maxRank: SECTION_MAX_RANK,
        hasNextPage: false,
        generatedAt: new Date().toISOString(),
      };
    }

    const items = await this.fetchSectionItems(section, take, offset);
    const hasNextPage = items.length > requestedLimit;

    return {
      section,
      items: items.slice(0, requestedLimit),
      limit: requestedLimit,
      offset,
      maxRank: SECTION_MAX_RANK,
      hasNextPage,
      generatedAt: new Date().toISOString(),
    };
  }

  private async fetchSectionItems(
    section: GlobalSongPopularSectionKey,
    limit: number,
    offset: number,
  ): Promise<GlobalSongPopularSectionResponseDto['items']> {
    switch (section) {
      case 'ranking': {
        const items = await this.fetchRanking(limit, offset);
        await this.hydrateSongItems(items);
        return items;
      }
      case 'newcomers': {
        const items = await this.fetchNewcomers(limit, offset);
        await this.hydrateSongItems(items);
        return items;
      }
      case 'live-now':
        return this.buildLiveNowItems(
          await this.fetchLiveNowMetrics(limit, offset),
        );
      case 'most-requested':
        return this.buildMostRequestedItems(
          await this.fetchMostRequestedMetrics(limit, offset),
        );
      case 'most-liked':
        return this.buildMostLikedItems(
          await this.fetchMostLikedMetrics(limit, offset),
        );
      case 'most-hot-clips':
        return this.buildMostHotClipItems(
          await this.fetchMostHotClipsMetrics(limit, offset),
        );
      case 'most-donated':
        return this.buildMostDonatedItems(
          await this.fetchMostDonatedMetrics(limit, offset),
        );
    }
  }

  private async fetchRanking(
    limit = RANKING_LIMIT,
    offset = 0,
  ): Promise<GlobalSongPopularItemDto[]> {
    const rows = await this.prisma.globalSong.findMany({
      where: { channelCount: { gt: 0 } },
      include: { globalArtist: true },
      orderBy: [{ channelCount: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: offset,
    });
    return rows.map(rowToItem);
  }

  private async fetchNewcomers(
    limit = NEWCOMERS_LIMIT,
    offset = 0,
  ): Promise<GlobalSongPopularNewcomerDto[]> {
    const rows = await this.prisma.globalSong.findMany({
      where: { channelCount: { gt: 0 } },
      include: { globalArtist: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: offset,
    });
    return rows.map((row) => ({
      ...rowToItem(row),
      createdAt: (row as RowWithArtist & { createdAt: Date }).createdAt.toISOString(),
    }));
  }

  private async fetchTopArtists(): Promise<GlobalSongPopularTopArtistDto[]> {
    const grouped = await this.prisma.globalSong.groupBy({
      by: ['globalArtistId'],
      where: { channelCount: { gt: 0 } },
      _sum: { channelCount: true },
      _count: { _all: true },
      orderBy: { _sum: { channelCount: 'desc' } },
      take: TOP_ARTISTS_LIMIT,
    });
    if (grouped.length === 0) return [];

    const artistIds = grouped.map((g) => g.globalArtistId);
    const artists = await this.prisma.globalArtist.findMany({
      where: { id: { in: artistIds } },
      select: { id: true, canonicalName: true },
    });
    const artistMap = new Map(artists.map((a) => [a.id, a]));

    const topSongsEntries = await Promise.all(
      artistIds.map(async (artistId) => {
        const songs = await this.prisma.globalSong.findMany({
          where: { globalArtistId: artistId, channelCount: { gt: 0 } },
          include: { globalArtist: true },
          orderBy: [{ channelCount: 'desc' }, { id: 'desc' }],
          take: SONGS_PER_ARTIST,
        });
        return [artistId, songs.map(rowToItem)] as const;
      }),
    );
    const songsByArtist = new Map(topSongsEntries);

    const result: GlobalSongPopularTopArtistDto[] = [];
    for (const g of grouped) {
      const artist = artistMap.get(g.globalArtistId);
      if (!artist) continue;
      result.push({
        id: artist.id,
        name: artist.canonicalName,
        songCount: g._count?._all ?? 0,
        totalChannelCount: g._sum.channelCount ?? 0,
        topSongs: songsByArtist.get(g.globalArtistId) ?? [],
      });
    }
    return result;
  }

  /**
   * Songs currently being PLAYED in any ACTIVE LiveSession. SongRequest is
   * the source of truth for "what is on the deck right now" (status=playing).
   * We only count a song once per LiveSession so a queue with multiple
   * accepted-but-still-pending repeats doesn't inflate the live count.
   */
  private async fetchLiveNowMetrics(
    limit = LIVE_NOW_LIMIT,
    offset = 0,
  ): Promise<
    Array<{ globalSongId: number; liveCount: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ global_song_id: number; live_count: number | bigint }>
    >`
      SELECT s.global_song_id                           AS global_song_id,
             CAST(COUNT(DISTINCT sr.live_session_id) AS SIGNED) AS live_count
        FROM song_requests sr
        JOIN live_sessions ls ON sr.live_session_id = ls.id
        JOIN songs s          ON sr.song_id = s.id
       WHERE sr.status = 'playing'
         AND ls.status = 'active'
         AND ls.visibility = 'PUBLIC'
         AND s.global_song_id IS NOT NULL
       GROUP BY s.global_song_id
       ORDER BY live_count DESC, s.global_song_id ASC
       LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => ({
      globalSongId: Number(r.global_song_id),
      liveCount: Number(r.live_count),
    }));
  }

  /**
   * Songs requested most often in the last RECENT_WINDOW_DAYS days. Counts
   * SongRequest rows (any status) on PUBLIC LiveSessions so private setlist
   * activity doesn't drive the public ranking. Self-joining LiveSession is
   * cheap because the relevant index covers (status, visibility).
   */
  private async fetchMostRequestedMetrics(
    limit = MOST_REQUESTED_LIMIT,
    offset = 0,
  ): Promise<
    Array<{ globalSongId: number; recentRequestCount: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ global_song_id: number; cnt: number | bigint }>
    >`
      SELECT s.global_song_id            AS global_song_id,
             CAST(COUNT(*) AS SIGNED)    AS cnt
        FROM song_requests sr
        JOIN live_sessions ls ON sr.live_session_id = ls.id
        JOIN songs s          ON sr.song_id = s.id
       WHERE sr.created_at >= DATE_SUB(NOW(), INTERVAL ${RECENT_WINDOW_DAYS} DAY)
         AND ls.visibility = 'PUBLIC'
         AND s.global_song_id IS NOT NULL
       GROUP BY s.global_song_id
       ORDER BY cnt DESC, s.global_song_id ASC
       LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => ({
      globalSongId: Number(r.global_song_id),
      recentRequestCount: Number(r.cnt),
    }));
  }

  /**
   * GlobalSongs with the most user_song_likes summed across every channel-
   * specific Song row attached to them. Songs are channel-scoped so the same
   * GlobalSong can pick up likes from many channels simultaneously.
   */
  private async fetchMostLikedMetrics(
    limit = MOST_LIKED_LIMIT,
    offset = 0,
  ): Promise<
    Array<{ globalSongId: number; likeCount: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ global_song_id: number; cnt: number | bigint }>
    >`
      SELECT s.global_song_id          AS global_song_id,
             CAST(COUNT(*) AS SIGNED)  AS cnt
        FROM user_song_likes usl
        JOIN songs s ON usl.song_id = s.id
       WHERE s.global_song_id IS NOT NULL
       GROUP BY s.global_song_id
       ORDER BY cnt DESC, s.global_song_id ASC
       LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => ({
      globalSongId: Number(r.global_song_id),
      likeCount: Number(r.cnt),
    }));
  }

  /**
   * GlobalSongs whose attached visible clips collected the most aggregate
   * views. We carry both clipCount and clipViewSum so the frontend card can
   * surface either signal — view sum leads the sort but a clip count near
   * 1 with huge views means the song lives off a single viral cover.
   */
  private async fetchMostHotClipsMetrics(
    limit = MOST_HOT_CLIPS_LIMIT,
    offset = 0,
  ): Promise<
    Array<{ globalSongId: number; clipCount: number; clipViewSum: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{
        global_song_id: number;
        clip_count: number | bigint;
        view_sum: number | bigint | null;
      }>
    >`
      SELECT s.global_song_id                          AS global_song_id,
             CAST(COUNT(DISTINCT c.id) AS SIGNED)      AS clip_count,
             CAST(COALESCE(SUM(cs.view_count), 0) AS SIGNED) AS view_sum
        FROM clip_channels cc
        JOIN clips c          ON cc.clip_id = c.id
        JOIN songs s          ON cc.song_id = s.id
        JOIN channels ch      ON cc.channel_id = ch.id
        LEFT JOIN clip_stats cs ON cs.clip_id = c.id
       WHERE c.status = 'visible'
         AND c.publish_to_hot_clip = true
         AND ch.visibility = 'PUBLIC'
         AND s.global_song_id IS NOT NULL
       GROUP BY s.global_song_id
      HAVING view_sum > 0
       ORDER BY view_sum DESC, clip_count DESC, s.global_song_id ASC
       LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => ({
      globalSongId: Number(r.global_song_id),
      clipCount: Number(r.clip_count),
      clipViewSum: Number(r.view_sum ?? 0),
    }));
  }

  /**
   * SongRequests with non-null donation_amount in the last week, summed by
   * KRW-normalized amount per GlobalSong. Donation rows are infrequent so a
   * tight LIMIT here usually surfaces the standout super-chat covers.
   */
  private async fetchMostDonatedMetrics(
    limit = MOST_DONATED_LIMIT,
    offset = 0,
  ): Promise<
    Array<{ globalSongId: number; recentDonationKrw: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ global_song_id: number; krw_sum: number | bigint | null }>
    >`
      SELECT s.global_song_id                              AS global_song_id,
             CAST(COALESCE(SUM(sr.donation_amount), 0) AS SIGNED) AS krw_sum
        FROM song_requests sr
        JOIN live_sessions ls ON sr.live_session_id = ls.id
        JOIN songs s          ON sr.song_id = s.id
       WHERE sr.created_at >= DATE_SUB(NOW(), INTERVAL ${RECENT_WINDOW_DAYS} DAY)
         AND sr.donation_amount IS NOT NULL
         AND sr.donation_amount > 0
         AND ls.visibility = 'PUBLIC'
         AND s.global_song_id IS NOT NULL
       GROUP BY s.global_song_id
      HAVING krw_sum > 0
       ORDER BY krw_sum DESC, s.global_song_id ASC
       LIMIT ${limit} OFFSET ${offset}
    `;
    return rows.map((r) => ({
      globalSongId: Number(r.global_song_id),
      recentDonationKrw: Number(r.krw_sum ?? 0),
    }));
  }

  private async buildLiveNowItems(
    metrics: Array<{ globalSongId: number; liveCount: number }>,
  ): Promise<GlobalSongLiveNowItemDto[]> {
    const baseById = await this.buildBaseItemsByIds(
      metrics.map((m) => m.globalSongId),
    );
    return metrics.flatMap((m) => {
      const base = baseById.get(m.globalSongId);
      return base ? [{ ...base, liveCount: m.liveCount }] : [];
    });
  }

  private async buildMostRequestedItems(
    metrics: Array<{ globalSongId: number; recentRequestCount: number }>,
  ): Promise<GlobalSongMostRequestedItemDto[]> {
    const baseById = await this.buildBaseItemsByIds(
      metrics.map((m) => m.globalSongId),
    );
    return metrics.flatMap((m) => {
      const base = baseById.get(m.globalSongId);
      return base
        ? [{ ...base, recentRequestCount: m.recentRequestCount }]
        : [];
    });
  }

  private async buildMostLikedItems(
    metrics: Array<{ globalSongId: number; likeCount: number }>,
  ): Promise<GlobalSongMostLikedItemDto[]> {
    const baseById = await this.buildBaseItemsByIds(
      metrics.map((m) => m.globalSongId),
    );
    return metrics.flatMap((m) => {
      const base = baseById.get(m.globalSongId);
      return base ? [{ ...base, likeCount: m.likeCount }] : [];
    });
  }

  private async buildMostHotClipItems(
    metrics: Array<{
      globalSongId: number;
      clipCount: number;
      clipViewSum: number;
    }>,
  ): Promise<GlobalSongMostClippedItemDto[]> {
    const baseById = await this.buildBaseItemsByIds(
      metrics.map((m) => m.globalSongId),
    );
    return metrics.flatMap((m) => {
      const base = baseById.get(m.globalSongId);
      return base
        ? [
            {
              ...base,
              clipCount: m.clipCount,
              clipViewSum: m.clipViewSum,
            },
          ]
        : [];
    });
  }

  private async buildMostDonatedItems(
    metrics: Array<{ globalSongId: number; recentDonationKrw: number }>,
  ): Promise<GlobalSongMostDonatedItemDto[]> {
    const baseById = await this.buildBaseItemsByIds(
      metrics.map((m) => m.globalSongId),
    );
    return metrics.flatMap((m) => {
      const base = baseById.get(m.globalSongId);
      return base
        ? [{ ...base, recentDonationKrw: m.recentDonationKrw }]
        : [];
    });
  }

  private async buildBaseItemsByIds(
    ids: number[],
  ): Promise<Map<number, GlobalSongPopularItemDto>> {
    const rowsById = await this.fetchBaseRowsByIds(uniqueFacetIds(ids));
    const items = ids.flatMap((id) => {
      const row = rowsById.get(id);
      return row ? [rowToItem(row)] : [];
    });
    await this.hydrateSongItems(items);
    return new Map(items.map((item) => [item.id, item]));
  }

  private async hydrateSongItems(
    items: GlobalSongPopularItemDto[],
  ): Promise<void> {
    const ids = items.map((item) => item.id);
    const [channelsBySong, mostUsedAlbumArtBySong, mxmAlbumArtBySong] =
      await Promise.all([
        this.fetchTopChannelsBySong(ids),
        this.fetchMostUsedAlbumArtBySong(ids),
        this.fetchMxmAlbumArtBySong(ids),
      ]);

    attachChannels(items, channelsBySong);
    buildAlbumArtChain(items, mostUsedAlbumArtBySong, mxmAlbumArtBySong);
  }

  /**
   * Bulk-load the GlobalSong rows that the new facet metrics reference so the
   * card hydration step doesn't fire one row-fetch per facet entry.
   */
  private async fetchBaseRowsByIds(
    ids: number[],
  ): Promise<Map<number, RowWithArtist>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.globalSong.findMany({
      where: { id: { in: ids } },
      include: { globalArtist: true },
    });
    return new Map(rows.map((row) => [row.id, row as RowWithArtist]));
  }

  /**
   * For every globalSongId, return up to 5 PUBLIC channels sorted by
   * follower count (UserChannelFavorite count) Desc. One pair-fetch + one
   * channel-info fetch keeps the round trips bounded; sort + cap happens in
   * memory.
   */
  private async fetchTopChannelsBySong(
    gsIds: number[],
  ): Promise<Map<number, GlobalSongPopularChannelDto[]>> {
    if (gsIds.length === 0) return new Map();

    const songRows = await this.prisma.song.findMany({
      where: {
        globalSongId: { in: gsIds },
        channel: { visibility: 'PUBLIC' },
      },
      select: { globalSongId: true, channelId: true },
    });
    if (songRows.length === 0) return new Map();

    const channelIds = [...new Set(songRows.map((r) => r.channelId))];
    const channels = await this.prisma.channel.findMany({
      where: { id: { in: channelIds } },
      select: {
        id: true,
        name: true,
        profileImageUrl: true,
        _count: { select: { userFavorites: true } },
      },
    });
    const channelMap = new Map(channels.map((c) => [c.id, c]));

    const grouped = new Map<
      number,
      Array<{
        id: number;
        name: string;
        profileImage: string | null;
        followerCount: number;
      }>
    >();
    for (const row of songRows) {
      const gsId = row.globalSongId;
      if (gsId == null) continue;
      const c = channelMap.get(row.channelId);
      if (!c) continue;
      let list = grouped.get(gsId);
      if (!list) {
        list = [];
        grouped.set(gsId, list);
      }
      list.push({
        id: c.id,
        name: c.name,
        profileImage: c.profileImageUrl ?? null,
        followerCount: c._count.userFavorites,
      });
    }

    const result = new Map<number, GlobalSongPopularChannelDto[]>();
    for (const [gsId, list] of grouped) {
      list.sort(
        (a, b) => b.followerCount - a.followerCount || a.id - b.id,
      );
      result.set(
        gsId,
        list.slice(0, TOP_CHANNELS_PER_SONG).map((c) => ({
          id: c.id,
          name: c.name,
          profileImage: c.profileImage,
        })),
      );
    }
    return result;
  }

  /**
   * GlobalSong.albumArt 가 비었을 때 fallback 으로 쓸 "멜로밍 채널들이 가장 많이
   * 사용 중인 Song.albumArt URL" 을 globalSongId 별로 1개 골라 반환한다.
   *
   * indexer 가 GlobalSong.albumArt 를 last-write-wins 로 박고 있어 한 채널이
   * 박은 이상한 url 이 winner 로 굳을 수 있는데, 다수가 쓰는 url 이 평균적으로
   * 더 신뢰할 만하다는 가정. NULL/빈 url 은 frequency 집계에서 제외.
   */
  private async fetchMostUsedAlbumArtBySong(
    gsIds: number[],
  ): Promise<Map<number, string>> {
    if (gsIds.length === 0) return new Map();

    // PUBLIC 채널의 Song.albumArt 만 후보로. PRIVATE/UNLISTED 채널이 들고 있는
    // url 이 public 응답에 새어 나가지 않도록 visibility 필터 명시. tie-break
    // 결정성을 위해 (count DESC, url ASC) 로 정렬해 같은 곡에 대해 popular/detail
    // 양쪽이 항상 동일 url 을 선택.
    const rows = await this.prisma.song.findMany({
      where: {
        globalSongId: { in: gsIds },
        albumArt: { not: null },
        channel: { visibility: 'PUBLIC' },
      },
      select: { globalSongId: true, albumArt: true },
    });
    if (rows.length === 0) return new Map();

    const freq = new Map<number, Map<string, number>>();
    for (const row of rows) {
      const gsId = row.globalSongId;
      const url = row.albumArt;
      if (gsId == null || !url) continue;
      let inner = freq.get(gsId);
      if (!inner) {
        inner = new Map();
        freq.set(gsId, inner);
      }
      inner.set(url, (inner.get(url) ?? 0) + 1);
    }

    const result = new Map<number, string>();
    for (const [gsId, urlMap] of freq) {
      let best: { url: string; count: number } | null = null;
      for (const [url, count] of urlMap) {
        if (
          !best ||
          count > best.count ||
          (count === best.count && url < best.url)
        ) {
          best = { url, count };
        }
      }
      if (best) result.set(gsId, best.url);
    }
    return result;
  }

  /**
   * Musixmatch 매칭에서 받아둔 album art URL. most-used Song.albumArt 도 없을 때
   * 마지막 fallback. 매칭 안 된 GlobalSong 은 null.
   */
  private async fetchMxmAlbumArtBySong(
    gsIds: number[],
  ): Promise<Map<number, string>> {
    if (gsIds.length === 0) return new Map();
    const rows = await this.prisma.globalSong.findMany({
      where: { id: { in: gsIds }, mxmAlbumArtUrl: { not: null } },
      select: { id: true, mxmAlbumArtUrl: true },
    });
    const result = new Map<number, string>();
    for (const r of rows) {
      if (r.mxmAlbumArtUrl) result.set(r.id, r.mxmAlbumArtUrl);
    }
    return result;
  }
}

function uniqueFacetIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function rowToItem(row: RowWithArtist): GlobalSongPopularItemDto {
  return {
    id: row.id,
    title: row.title,
    artist: { id: row.globalArtist.id, name: row.globalArtist.canonicalName },
    // albumArt / albumArtUrls 는 buildAlbumArtChain 에서 batch 로 채운다.
    albumArt: null,
    albumArtUrls: [],
    channelCount: row.channelCount,
    topChannels: [],
    _rawAlbumArt: row.albumArt,
  } as GlobalSongPopularItemDto & { _rawAlbumArt: string | null };
}

function attachChannels(
  items: GlobalSongPopularItemDto[],
  channelsBySong: Map<number, GlobalSongPopularChannelDto[]>,
): void {
  for (const item of items) {
    item.topChannels = channelsBySong.get(item.id) ?? [];
  }
}

/**
 * albumArt 우선순위 chain — Musixmatch → most-used Song.albumArt →
 * GlobalSong.albumArt. 동일 url 은 중복 제거. 결과를 albumArtUrls 배열에 박고,
 * 단일 url 호환을 위해 albumArt = albumArtUrls[0] ?? null 로 동기화한다.
 *
 * rowToItem 단계에서 임시로 보관한 _rawAlbumArt 를 마지막에 제거해
 * 응답 페이로드에는 노출되지 않게 한다.
 */
function buildAlbumArtChain(
  items: GlobalSongPopularItemDto[],
  mostUsed: Map<number, string>,
  mxm: Map<number, string>,
): void {
  for (const item of items) {
    const tagged = item as GlobalSongPopularItemDto & {
      _rawAlbumArt?: string | null;
    };
    const urls: string[] = [];
    const mxmUrl = mxm.get(item.id);
    if (mxmUrl) urls.push(mxmUrl);
    const mostUsedUrl = mostUsed.get(item.id);
    if (mostUsedUrl && !urls.includes(mostUsedUrl)) urls.push(mostUsedUrl);
    const raw = tagged._rawAlbumArt;
    if (raw && !urls.includes(raw)) urls.push(raw);
    item.albumArtUrls = urls;
    item.albumArt = urls[0] ?? null;
    delete tagged._rawAlbumArt;
  }
}
