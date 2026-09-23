import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  GlobalArtistLiveNowItemDto,
  GlobalArtistMostDonatedItemDto,
  GlobalArtistMostLikedItemDto,
  GlobalArtistMostRequestedItemDto,
  GlobalArtistPopularItemDto,
  GlobalArtistPopularNewcomerDto,
  GlobalArtistPopularResponseDto,
} from './dto/global-artist-popular.dto';
import {
  GlobalSongPopularChannelDto,
  GlobalSongPopularItemDto,
} from './dto/global-song-popular.dto';

const RANKING_LIMIT = 24;
const NEWCOMERS_LIMIT = 12;
const MOST_CLIPPED_LIMIT = 12;
const LIVE_NOW_LIMIT = 12;
const MOST_REQUESTED_LIMIT = 12;
const MOST_LIKED_LIMIT = 12;
const MOST_DONATED_LIMIT = 12;
const RECENT_WINDOW_DAYS = 7;
const SONGS_PER_ARTIST = 3;
const TOP_CHANNELS_PER_SONG = 5;

type RowWithArtist = {
  id: number;
  title: string;
  albumArt: string | null;
  channelCount: number;
  globalArtistId: number;
};

type ArtistAggregateRow = {
  artistId: number;
  songCount: number;
  totalChannelCount: number;
  clipCount: number;
  firstSongAt: Date | null;
};

@Injectable()
export class GlobalArtistPopularService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregates the three sections that power /musicbook/artist:
   *   - ranking      : SUM(channelCount) DESC
   *   - newcomers    : MIN(GlobalSong.createdAt) DESC across artist's songs
   *   - mostClipped  : DISTINCT visible clip count DESC
   *
   * The candidate artist set is the union of those three section heads, so
   * heavy enrichment work (top-songs lookup, album-art chain, top-channel
   * lookup) only fires for that bounded set.
   */
  async getPopular(): Promise<GlobalArtistPopularResponseDto> {
    const [
      ranking,
      newcomers,
      mostClipped,
      liveNowMetrics,
      mostRequestedMetrics,
      mostLikedMetrics,
      mostDonatedMetrics,
    ] = await Promise.all([
      this.fetchRankingArtistIds(),
      this.fetchNewcomerArtistIds(),
      this.fetchMostClippedArtistIds(),
      this.fetchLiveNowMetrics(),
      this.fetchMostRequestedMetrics(),
      this.fetchMostLikedMetrics(),
      this.fetchMostDonatedMetrics(),
    ]);

    const artistIds = uniqueOrder([
      ...ranking.map((r) => r.artistId),
      ...newcomers.map((r) => r.artistId),
      ...mostClipped.map((r) => r.artistId),
      ...liveNowMetrics.map((m) => m.artistId),
      ...mostRequestedMetrics.map((m) => m.artistId),
      ...mostLikedMetrics.map((m) => m.artistId),
      ...mostDonatedMetrics.map((m) => m.artistId),
    ]);
    if (artistIds.length === 0) {
      return {
        ranking: [],
        newcomers: [],
        mostClipped: [],
        liveNow: [],
        mostRequestedThisWeek: [],
        mostLiked: [],
        mostDonated: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const aggregates = await this.fetchArtistAggregates(artistIds);
    const aggregateMap = new Map(aggregates.map((a) => [a.artistId, a]));

    const artists = await this.prisma.globalArtist.findMany({
      where: { id: { in: artistIds } },
      select: { id: true, canonicalName: true },
    });
    const artistMap = new Map(artists.map((a) => [a.id, a]));

    const topSongsByArtist = await this.fetchTopSongsByArtist(artistIds);

    const allGsIds = new Set<number>();
    for (const songs of topSongsByArtist.values()) {
      songs.forEach((s) => allGsIds.add(s.id));
    }
    const gsIdList = [...allGsIds];

    const [channelsBySong, mostUsedAlbumArtBySong, mxmAlbumArtBySong] =
      await Promise.all([
        this.fetchTopChannelsBySong(gsIdList),
        this.fetchMostUsedAlbumArtBySong(gsIdList),
        this.fetchMxmAlbumArtBySong(gsIdList),
      ]);

    const buildItem = (artistId: number): GlobalArtistPopularItemDto | null => {
      const artist = artistMap.get(artistId);
      const agg = aggregateMap.get(artistId);
      if (!artist || !agg) return null;
      const topSongs = (topSongsByArtist.get(artistId) ?? []).map((song) =>
        finalizeSong(
          song,
          artist,
          channelsBySong,
          mostUsedAlbumArtBySong,
          mxmAlbumArtBySong,
        ),
      );
      return {
        id: artist.id,
        name: artist.canonicalName,
        songCount: agg.songCount,
        totalChannelCount: agg.totalChannelCount,
        clipCount: agg.clipCount,
        topSongs,
      };
    };

    const rankingItems = ranking
      .map((r) => buildItem(r.artistId))
      .filter((x): x is GlobalArtistPopularItemDto => x !== null);

    const newcomerItems: GlobalArtistPopularNewcomerDto[] = [];
    for (const r of newcomers) {
      const base = buildItem(r.artistId);
      if (!base || !r.firstSongAt) continue;
      newcomerItems.push({ ...base, firstSongAt: r.firstSongAt.toISOString() });
    }

    const mostClippedItems = mostClipped
      .map((r) => buildItem(r.artistId))
      .filter((x): x is GlobalArtistPopularItemDto => x !== null);

    const liveNowItems: GlobalArtistLiveNowItemDto[] = [];
    for (const m of liveNowMetrics) {
      const base = buildItem(m.artistId);
      if (!base) continue;
      liveNowItems.push({ ...base, liveCount: m.liveCount });
    }

    const mostRequestedItems: GlobalArtistMostRequestedItemDto[] = [];
    for (const m of mostRequestedMetrics) {
      const base = buildItem(m.artistId);
      if (!base) continue;
      mostRequestedItems.push({
        ...base,
        recentRequestCount: m.recentRequestCount,
      });
    }

    const mostLikedItems: GlobalArtistMostLikedItemDto[] = [];
    for (const m of mostLikedMetrics) {
      const base = buildItem(m.artistId);
      if (!base) continue;
      mostLikedItems.push({ ...base, likeCount: m.likeCount });
    }

    const mostDonatedItems: GlobalArtistMostDonatedItemDto[] = [];
    for (const m of mostDonatedMetrics) {
      const base = buildItem(m.artistId);
      if (!base) continue;
      mostDonatedItems.push({
        ...base,
        recentDonationKrw: m.recentDonationKrw,
      });
    }

    return {
      ranking: rankingItems,
      newcomers: newcomerItems,
      mostClipped: mostClippedItems,
      liveNow: liveNowItems,
      mostRequestedThisWeek: mostRequestedItems,
      mostLiked: mostLikedItems,
      mostDonated: mostDonatedItems,
      generatedAt: new Date().toISOString(),
    };
  }

  /** SUM(channelCount) DESC across active GlobalSongs grouped by artist. */
  private async fetchRankingArtistIds(): Promise<
    Array<{ artistId: number }>
  > {
    const grouped = await this.prisma.globalSong.groupBy({
      by: ['globalArtistId'],
      where: { channelCount: { gt: 0 } },
      _sum: { channelCount: true },
      orderBy: { _sum: { channelCount: 'desc' } },
      take: RANKING_LIMIT,
    });
    return grouped.map((g) => ({ artistId: g.globalArtistId }));
  }

  /**
   * MIN(GlobalSong.createdAt) per artist DESC — the most-recently-surfaced
   * artists whose first registered song is newest. Aggregated in SQL so the
   * sort key matches the row pulled.
   */
  private async fetchNewcomerArtistIds(): Promise<
    Array<{ artistId: number; firstSongAt: Date }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ artist_id: number; first_song_at: Date }>
    >`
      SELECT gs.global_artist_id AS artist_id,
             MIN(gs.created_at)  AS first_song_at
        FROM global_songs gs
       WHERE gs.channel_count > 0
       GROUP BY gs.global_artist_id
       ORDER BY MIN(gs.created_at) DESC
       LIMIT ${NEWCOMERS_LIMIT}
    `;
    return rows.map((r) => ({
      artistId: Number(r.artist_id),
      firstSongAt: r.first_song_at,
    }));
  }

  /**
   * DISTINCT visible Clip count grouped by artist (via clip_channels →
   * songs → global_songs). PUBLIC channel filter mirrors the per-artist
   * countDistinctClips already used on /global-artists/:id.
   */
  private async fetchMostClippedArtistIds(): Promise<
    Array<{ artistId: number; clipCount: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ artist_id: number; clip_count: number | bigint }>
    >`
      SELECT gs.global_artist_id            AS artist_id,
             CAST(COUNT(DISTINCT c.id) AS SIGNED) AS clip_count
        FROM clip_channels cc
        JOIN songs s         ON cc.song_id = s.id
        JOIN global_songs gs ON s.global_song_id = gs.id
        JOIN clips c         ON cc.clip_id = c.id
        JOIN channels ch     ON cc.channel_id = ch.id
       WHERE c.status = 'visible'
         AND ch.visibility = 'PUBLIC'
         AND gs.channel_count > 0
       GROUP BY gs.global_artist_id
      HAVING clip_count > 0
       ORDER BY clip_count DESC, gs.global_artist_id ASC
       LIMIT ${MOST_CLIPPED_LIMIT}
    `;
    return rows.map((r) => ({
      artistId: Number(r.artist_id),
      clipCount: Number(r.clip_count),
    }));
  }

  /**
   * Artists with at least one song currently being PLAYED in any ACTIVE
   * LiveSession. Same source as song-popular liveNow but aggregated up to
   * the artist level — distinct LiveSession count keeps repeat queue rows
   * from inflating the metric.
   */
  private async fetchLiveNowMetrics(): Promise<
    Array<{ artistId: number; liveCount: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ artist_id: number; live_count: number | bigint }>
    >`
      SELECT gs.global_artist_id                          AS artist_id,
             CAST(COUNT(DISTINCT sr.live_session_id) AS SIGNED) AS live_count
        FROM song_requests sr
        JOIN live_sessions ls ON sr.live_session_id = ls.id
        JOIN songs s          ON sr.song_id = s.id
        JOIN global_songs gs  ON s.global_song_id = gs.id
       WHERE sr.status = 'playing'
         AND ls.status = 'active'
         AND ls.visibility = 'PUBLIC'
       GROUP BY gs.global_artist_id
       ORDER BY live_count DESC, gs.global_artist_id ASC
       LIMIT ${LIVE_NOW_LIMIT}
    `;
    return rows.map((r) => ({
      artistId: Number(r.artist_id),
      liveCount: Number(r.live_count),
    }));
  }

  /**
   * Artists whose songs were requested most often in the last RECENT_WINDOW
   * _DAYS days on PUBLIC LiveSessions. Counts every SongRequest row, not
   * just accepted ones — what we want is gross demand signal.
   */
  private async fetchMostRequestedMetrics(): Promise<
    Array<{ artistId: number; recentRequestCount: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ artist_id: number; cnt: number | bigint }>
    >`
      SELECT gs.global_artist_id            AS artist_id,
             CAST(COUNT(*) AS SIGNED)       AS cnt
        FROM song_requests sr
        JOIN live_sessions ls ON sr.live_session_id = ls.id
        JOIN songs s          ON sr.song_id = s.id
        JOIN global_songs gs  ON s.global_song_id = gs.id
       WHERE sr.created_at >= DATE_SUB(NOW(), INTERVAL ${RECENT_WINDOW_DAYS} DAY)
         AND ls.visibility = 'PUBLIC'
       GROUP BY gs.global_artist_id
       ORDER BY cnt DESC, gs.global_artist_id ASC
       LIMIT ${MOST_REQUESTED_LIMIT}
    `;
    return rows.map((r) => ({
      artistId: Number(r.artist_id),
      recentRequestCount: Number(r.cnt),
    }));
  }

  /**
   * Artists with the most user_song_likes summed across every channel-
   * specific Song under any of their GlobalSongs.
   */
  private async fetchMostLikedMetrics(): Promise<
    Array<{ artistId: number; likeCount: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ artist_id: number; cnt: number | bigint }>
    >`
      SELECT gs.global_artist_id          AS artist_id,
             CAST(COUNT(*) AS SIGNED)     AS cnt
        FROM user_song_likes usl
        JOIN songs s          ON usl.song_id = s.id
        JOIN global_songs gs  ON s.global_song_id = gs.id
       GROUP BY gs.global_artist_id
       ORDER BY cnt DESC, gs.global_artist_id ASC
       LIMIT ${MOST_LIKED_LIMIT}
    `;
    return rows.map((r) => ({
      artistId: Number(r.artist_id),
      likeCount: Number(r.cnt),
    }));
  }

  /**
   * Artists whose songs received the largest total donation_amount via
   * donation-message song-requests in the last week.
   */
  private async fetchMostDonatedMetrics(): Promise<
    Array<{ artistId: number; recentDonationKrw: number }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{ artist_id: number; krw_sum: number | bigint | null }>
    >`
      SELECT gs.global_artist_id                              AS artist_id,
             CAST(COALESCE(SUM(sr.donation_amount), 0) AS SIGNED) AS krw_sum
        FROM song_requests sr
        JOIN live_sessions ls ON sr.live_session_id = ls.id
        JOIN songs s          ON sr.song_id = s.id
        JOIN global_songs gs  ON s.global_song_id = gs.id
       WHERE sr.created_at >= DATE_SUB(NOW(), INTERVAL ${RECENT_WINDOW_DAYS} DAY)
         AND sr.donation_amount IS NOT NULL
         AND sr.donation_amount > 0
         AND ls.visibility = 'PUBLIC'
       GROUP BY gs.global_artist_id
      HAVING krw_sum > 0
       ORDER BY krw_sum DESC, gs.global_artist_id ASC
       LIMIT ${MOST_DONATED_LIMIT}
    `;
    return rows.map((r) => ({
      artistId: Number(r.artist_id),
      recentDonationKrw: Number(r.krw_sum ?? 0),
    }));
  }

  /**
   * Single-pass aggregate (songCount + sum + clipCount + earliest createdAt)
   * for a bounded set of artist ids. The clip subquery avoids the N+1 we'd
   * get from looping over countDistinctClips per artist on /artists/:id.
   */
  private async fetchArtistAggregates(
    artistIds: number[],
  ): Promise<ArtistAggregateRow[]> {
    if (artistIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{
        artist_id: number;
        song_count: number | bigint;
        total_channel_count: number | bigint;
        first_song_at: Date | null;
        clip_count: number | bigint;
      }>
    >`
      SELECT gs.global_artist_id                 AS artist_id,
             CAST(COUNT(DISTINCT gs.id) AS SIGNED) AS song_count,
             CAST(SUM(gs.channel_count) AS SIGNED) AS total_channel_count,
             MIN(gs.created_at)                  AS first_song_at,
             COALESCE((
               SELECT CAST(COUNT(DISTINCT c.id) AS SIGNED)
                 FROM clip_channels cc
                 JOIN songs s2        ON cc.song_id = s2.id
                 JOIN global_songs g2 ON s2.global_song_id = g2.id
                 JOIN clips c         ON cc.clip_id = c.id
                 JOIN channels ch     ON cc.channel_id = ch.id
                WHERE g2.global_artist_id = gs.global_artist_id
                  AND c.status = 'visible'
                  AND ch.visibility = 'PUBLIC'
             ), 0) AS clip_count
        FROM global_songs gs
       WHERE gs.global_artist_id IN (${Prisma.join(artistIds)})
         AND gs.channel_count > 0
       GROUP BY gs.global_artist_id
    `;
    return rows.map((r) => ({
      artistId: Number(r.artist_id),
      songCount: Number(r.song_count),
      totalChannelCount: Number(r.total_channel_count ?? 0),
      clipCount: Number(r.clip_count ?? 0),
      firstSongAt: r.first_song_at,
    }));
  }

  /**
   * For each artist, pull up to SONGS_PER_ARTIST top GlobalSongs by
   * channelCount Desc. One query per artist — bounded by total number of
   * artists in the candidate union (≤ 24+12+12 unique).
   */
  private async fetchTopSongsByArtist(
    artistIds: number[],
  ): Promise<Map<number, RowWithArtist[]>> {
    if (artistIds.length === 0) return new Map();
    const entries = await Promise.all(
      artistIds.map(async (artistId) => {
        const rows = await this.prisma.globalSong.findMany({
          where: { globalArtistId: artistId, channelCount: { gt: 0 } },
          orderBy: [{ channelCount: 'desc' }, { id: 'desc' }],
          take: SONGS_PER_ARTIST,
          select: {
            id: true,
            title: true,
            albumArt: true,
            channelCount: true,
            globalArtistId: true,
          },
        });
        return [artistId, rows] as const;
      }),
    );
    return new Map(entries);
  }

  /**
   * For every globalSongId, return up to 5 PUBLIC channels sorted by
   * follower count Desc. Mirrors GlobalSongPopularService.fetchTopChannels-
   * BySong — kept private here so the artist popular pipeline doesn't
   * depend on the song-popular service surface.
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
      list.sort((a, b) => b.followerCount - a.followerCount || a.id - b.id);
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

  /** Most-frequent Song.albumArt URL per globalSongId — see GlobalSongPopularService for rationale. */
  private async fetchMostUsedAlbumArtBySong(
    gsIds: number[],
  ): Promise<Map<number, string>> {
    if (gsIds.length === 0) return new Map();
    const rows = await this.prisma.song.findMany({
      where: { globalSongId: { in: gsIds }, albumArt: { not: null } },
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
        if (!best || count > best.count) best = { url, count };
      }
      if (best) result.set(gsId, best.url);
    }
    return result;
  }

  /** Musixmatch-derived URL — final fallback for the album-art chain. */
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

function finalizeSong(
  row: RowWithArtist,
  artist: { id: number; canonicalName: string },
  channelsBySong: Map<number, GlobalSongPopularChannelDto[]>,
  mostUsed: Map<number, string>,
  mxm: Map<number, string>,
): GlobalSongPopularItemDto {
  const urls: string[] = [];
  const mxmUrl = mxm.get(row.id);
  if (mxmUrl) urls.push(mxmUrl);
  const mostUsedUrl = mostUsed.get(row.id);
  if (mostUsedUrl && !urls.includes(mostUsedUrl)) urls.push(mostUsedUrl);
  if (row.albumArt && !urls.includes(row.albumArt)) urls.push(row.albumArt);
  return {
    id: row.id,
    title: row.title,
    artist: { id: artist.id, name: artist.canonicalName },
    albumArt: urls[0] ?? null,
    albumArtUrls: urls,
    channelCount: row.channelCount,
    topChannels: channelsBySong.get(row.id) ?? [],
  };
}

function uniqueOrder(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

