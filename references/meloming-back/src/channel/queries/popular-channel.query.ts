import { PrismaService } from '../../prisma/prisma.service';

export type PopularWeights = { fav: number; like: number; song: number };

export class PopularChannelQuery {
  constructor(private readonly prisma: PrismaService) {}

  async findPopularChannelIds(options: {
    limit: number;
    weights?: PopularWeights;
    since?: Date | null;
    minSongs?: number; // 최소 보유 노래 수
  }): Promise<
    Array<{
      id: number;
      favoritesCount: number;
      songLikesCount: number;
      songsCount: number;
      popularityScore: number;
    }>
  > {
    const w = options.weights ?? { fav: 1.5, like: 1.0, song: 0.1 };
    const since = options.since ?? null;
    const minSongs = options.minSongs ?? 10;
    const limit = Math.max(1, options.limit);

    // NOTE: MySQL 호환 RAW 쿼리. since가 null이면 조건 생략
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: number;
        favoritesCount: number | null;
        songLikesCount: number | null;
        songsCount: number | null;
        popularityScore: number | string | null;
      }>
    >(
      `
      SELECT
        c.id AS id,
        CAST(COALESCE(fav.cnt, 0) AS SIGNED)   AS favoritesCount,
        CAST(COALESCE(lks.cnt, 0) AS SIGNED)   AS songLikesCount,
        CAST(COALESCE(s.cnt, 0) AS SIGNED)     AS songsCount,
        CAST(
          (CAST(COALESCE(fav.cnt,0) AS SIGNED) * ?)
          + (CAST(COALESCE(lks.cnt,0) AS SIGNED) * ?)
          + (CAST(COALESCE(s.cnt,0) AS SIGNED)   * ?)
        AS DOUBLE) AS popularityScore
      FROM channels c
      LEFT JOIN (
        SELECT channel_id, COUNT(*) AS cnt
        FROM user_channel_favorites
        ${since ? 'WHERE created_at >= ?' : ''}
        GROUP BY channel_id
      ) fav ON fav.channel_id = c.id
      LEFT JOIN (
        SELECT channel_id, COUNT(*) AS cnt
        FROM songs
        ${since ? 'WHERE created_at >= ?' : ''}
        GROUP BY channel_id
      ) s ON s.channel_id = c.id
      LEFT JOIN (
        SELECT s.channel_id, COUNT(*) AS cnt
        FROM user_song_likes usl
        JOIN songs s ON s.id = usl.song_id
        ${since ? 'WHERE usl.created_at >= ?' : ''}
        GROUP BY s.channel_id
      ) lks ON lks.channel_id = c.id
      WHERE (SELECT COUNT(*) FROM songs ss WHERE ss.channel_id = c.id) >= ?
        AND c.visibility = 'PUBLIC'
      ORDER BY popularityScore DESC, c.created_at DESC
      LIMIT ?
      `,
      w.fav,
      w.like,
      w.song,
      ...(since ? [since] : []),
      ...(since ? [since] : []),
      ...(since ? [since] : []),
      minSongs,
      limit,
    );

    return rows.map((r) => ({
      id: r.id,
      favoritesCount: r.favoritesCount || 0,
      songLikesCount: r.songLikesCount || 0,
      songsCount: r.songsCount || 0,
      popularityScore: Number(r.popularityScore || 0), // string일 수 있음
    }));
  }
}
