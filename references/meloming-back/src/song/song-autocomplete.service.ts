import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLock } from '../common/distributed-lock/distributed-lock.decorator';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import { MetricsService } from '../metrics';
import {
  CacheKeyTrackingService,
  type CacheScope,
} from '../redis/cache-key-tracking.service';
import { songAutocompleteCacheKeys } from './cache/song-autocomplete.cache-keys';
import {
  SongAutocompleteItemDto,
  SongAutocompleteResponseDto,
} from './dto/responses/song-autocomplete.response.dto';
import {
  SongArtistSuggestResponseDto,
  SongArtistSuggestionDto,
} from './dto/responses/song-artist-suggest.response.dto';

const POPULAR_WARM_LIMIT = 500;
const POPULAR_CACHE_TTL_SEC = 24 * 60 * 60; // 24h
const QUERY_CACHE_TTL_SEC = 6 * 60 * 60; // 6h
const ARTIST_CACHE_TTL_SEC = 24 * 60 * 60; // 24h
const DEFAULT_AUTOCOMPLETE_LIMIT = 8;
const DEFAULT_ARTIST_LIMIT = 5;
const MAX_LIMIT = 20;
const WARM_MIN_SONGS = 200;
const WARM_BATCH_SIZE = 50;

interface PopularSongRow {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  requestCount: number;
  likeCount: number;
}

interface PopularSongCacheItem extends PopularSongRow {
  normalizedTitle: string;
}

interface ArtistMatchRow {
  artistId: number;
  artistName: string;
  matchCount: number;
}

@Injectable()
export class SongAutocompleteService {
  private readonly logger = new Logger(SongAutocompleteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly distributedLockService: DistributedLockService,
    private readonly cacheTracker: CacheKeyTrackingService,
    private readonly metricsService: MetricsService,
  ) {}

  private resolveScope(channelId: number | undefined): CacheScope {
    return typeof channelId === 'number'
      ? { kind: 'channel', channelId }
      : { kind: 'global' };
  }

  async autocompleteTitles(
    channelId: number | undefined,
    query?: string,
    limit: number = DEFAULT_AUTOCOMPLETE_LIMIT,
  ): Promise<SongAutocompleteResponseDto> {
    const safeLimit = this.clampLimit(limit, DEFAULT_AUTOCOMPLETE_LIMIT);
    const rawQuery = typeof query === 'string' ? query.trim() : '';
    const normalizedQuery = this.normalizeKey(rawQuery);

    if (!normalizedQuery) {
      const popular = await this.getPopularSongs(channelId);
      return {
        suggestions: this.dedupeTitleItems(
          popular.map((item) => this.toAutocompleteItem(item)),
          safeLimit,
        ),
      };
    }

    const queryKey = this.buildCacheKeyFragment(normalizedQuery);
    const cacheKey = songAutocompleteCacheKeys.query(channelId, queryKey);
    const cached =
      await this.cacheTracker.get<SongAutocompleteItemDto[]>(cacheKey);
    if (cached && cached.length > 0) {
      return { suggestions: cached.slice(0, safeLimit) };
    }

    const popular = await this.getPopularSongs(channelId);
    let suggestions = this.matchFromPopular(
      popular,
      normalizedQuery,
      safeLimit,
    );

    if (suggestions.length < safeLimit && normalizedQuery.length >= 2) {
      const dbRows = await this.fetchPopularSongs(channelId, {
        query: rawQuery,
        limit: safeLimit * 3,
      });
      const dbItems = dbRows.map((row) => this.toAutocompleteItem(row));
      suggestions = this.mergeUniqueByTitle(suggestions, dbItems, safeLimit);
    }

    await this.cacheTracker.trackAndSet(
      cacheKey,
      suggestions,
      QUERY_CACHE_TTL_SEC,
      this.resolveScope(channelId),
    );

    return { suggestions };
  }

  async suggestArtists(
    channelId: number | undefined,
    title: string,
    limit: number = DEFAULT_ARTIST_LIMIT,
  ): Promise<SongArtistSuggestResponseDto> {
    const safeLimit = this.clampLimit(limit, DEFAULT_ARTIST_LIMIT);
    const rawTitle = typeof title === 'string' ? title.trim() : '';
    const normalizedTitle = this.normalizeKey(rawTitle);

    if (!normalizedTitle) {
      return { suggestions: [], canCreateNew: true };
    }

    const titleKey = this.buildCacheKeyFragment(normalizedTitle);
    const cacheKey = songAutocompleteCacheKeys.artist(channelId, titleKey);
    const cached =
      await this.cacheTracker.get<SongArtistSuggestResponseDto>(cacheKey);
    if (cached) return cached;

    let suggestions = await this.fetchArtistsByExactTitle(
      channelId,
      normalizedTitle,
      safeLimit,
    );
    suggestions = this.dedupeArtistSuggestions(suggestions, safeLimit);

    if (suggestions.length === 0 && normalizedTitle.length >= 2) {
      suggestions = await this.fetchArtistsByTitleLike(
        channelId,
        rawTitle,
        safeLimit,
      );
      suggestions = this.dedupeArtistSuggestions(suggestions, safeLimit);
    }

    const response: SongArtistSuggestResponseDto = {
      suggestions,
      canCreateNew: suggestions.length === 0,
    };

    await this.cacheTracker.trackAndSet(
      cacheKey,
      response,
      ARTIST_CACHE_TTL_SEC,
      this.resolveScope(channelId),
    );

    return response;
  }

  @Cron('10 4 * * *', {
    name: 'song-autocomplete-warm',
    timeZone: 'Asia/Seoul',
  })
  @DistributedLock('cron:song:autocomplete-warm', 20 * 60 * 1000, 2000)
  async warmPopularCache(): Promise<void> {
    const endTimer = this.metricsService.startJobTimer(
      'song_autocomplete_warm',
    );
    try {
      this.logger.log('Song autocomplete cache warm-up started.');

      const channelIds = await this.getChannelsForWarm();
      if (channelIds.length === 0) {
        this.logger.log('No channels exceed warm-up threshold.');
      } else {
        let warmed = 0;
        for (let i = 0; i < channelIds.length; i += WARM_BATCH_SIZE) {
          const batch = channelIds.slice(i, i + WARM_BATCH_SIZE);
          await Promise.all(
            batch.map((channelId) =>
              this.warmPopularSongsForChannel(channelId),
            ),
          );
          warmed += batch.length;
        }

        this.logger.log(
          `Song autocomplete cache warm-up completed. channels=${warmed}`,
        );
      }

      await this.warmPopularSongsForChannel();
      this.metricsService.recordJobRun('song_autocomplete_warm', 'success');
    } catch (error) {
      this.metricsService.recordJobRun('song_autocomplete_warm', 'error');
      throw error;
    } finally {
      endTimer();
    }
  }

  async warmPopularSongsForChannel(
    channelId?: number,
  ): Promise<PopularSongCacheItem[]> {
    const cacheKey = songAutocompleteCacheKeys.popular(channelId);
    const rows = await this.fetchPopularSongs(channelId, {
      limit: POPULAR_WARM_LIMIT,
    });
    const items = rows.map((row) => ({
      ...row,
      normalizedTitle: this.normalizeKey(row.title),
    }));

    await this.cacheTracker.trackAndSet(
      cacheKey,
      items,
      POPULAR_CACHE_TTL_SEC,
      this.resolveScope(channelId),
    );
    return items;
  }

  private async getPopularSongs(
    channelId?: number,
  ): Promise<PopularSongCacheItem[]> {
    const cacheKey = songAutocompleteCacheKeys.popular(channelId);
    const cached =
      await this.cacheTracker.get<PopularSongCacheItem[]>(cacheKey);
    if (cached && cached.length > 0) return cached;

    return this.warmPopularSongsForChannel(channelId);
  }

  private matchFromPopular(
    items: PopularSongCacheItem[],
    normalizedQuery: string,
    limit: number,
  ): SongAutocompleteItemDto[] {
    const scoreMap = new Map<
      string,
      { item: PopularSongCacheItem; score: number }
    >();

    for (const item of items) {
      if (!item.normalizedTitle.includes(normalizedQuery)) continue;
      const score = this.scoreMatch(item, normalizedQuery);
      const key = item.normalizedTitle;
      const existing = scoreMap.get(key);
      if (!existing || existing.score < score) {
        scoreMap.set(key, { item, score });
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item }) => this.toAutocompleteItem(item));
  }

  private scoreMatch(item: PopularSongCacheItem, query: string): number {
    const score = item.requestCount * 100 + item.likeCount * 10;
    if (item.normalizedTitle === query) return score + 1_000_000;
    if (item.normalizedTitle.startsWith(query)) return score + 500_000;
    return score;
  }

  private mergeUniqueByTitle(
    primary: SongAutocompleteItemDto[],
    extra: SongAutocompleteItemDto[],
    limit: number,
  ): SongAutocompleteItemDto[] {
    const seen = new Set<string>();
    const merged: SongAutocompleteItemDto[] = [];
    const push = (item: SongAutocompleteItemDto) => {
      const key = this.normalizeKey(item.title);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    };

    for (const item of primary) {
      push(item);
      if (merged.length >= limit) return merged;
    }

    for (const item of extra) {
      push(item);
      if (merged.length >= limit) return merged;
    }

    return merged;
  }

  private dedupeTitleItems(
    items: SongAutocompleteItemDto[],
    limit: number,
  ): SongAutocompleteItemDto[] {
    const seen = new Set<string>();
    const result: SongAutocompleteItemDto[] = [];
    for (const item of items) {
      const key = this.normalizeKey(item.title);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      if (result.length >= limit) break;
    }
    return result;
  }

  private dedupeArtistSuggestions(
    items: SongArtistSuggestionDto[],
    limit: number,
  ): SongArtistSuggestionDto[] {
    const map = new Map<string, SongArtistSuggestionDto>();
    for (const item of items) {
      const key = this.normalizeKey(item.artistName);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...item });
        continue;
      }
      const nextCount = (existing.matchCount ?? 0) + (item.matchCount ?? 0);
      map.set(key, {
        ...existing,
        matchCount: nextCount,
      });
    }

    return Array.from(map.values())
      .sort((a, b) => {
        const diff = (b.matchCount ?? 0) - (a.matchCount ?? 0);
        if (diff !== 0) return diff;
        return a.artistName.localeCompare(b.artistName);
      })
      .slice(0, limit);
  }

  private toAutocompleteItem(
    row: PopularSongRow | PopularSongCacheItem,
  ): SongAutocompleteItemDto {
    return {
      id: row.id,
      title: row.title,
      artistId: row.artistId,
      artistName: row.artistName,
    };
  }

  private async fetchPopularSongs(
    channelId: number | undefined,
    options: { limit: number; query?: string },
  ): Promise<PopularSongRow[]> {
    const { limit, query } = options;
    const trimmedQuery = typeof query === 'string' ? query.trim() : '';
    const lowerQuery = trimmedQuery.toLowerCase();
    const escaped = lowerQuery ? this.escapeLike(lowerQuery) : '';
    const like = escaped ? `%${escaped}%` : '';
    const prefixLike = escaped ? `${escaped}%` : '';

    const whereClause = trimmedQuery
      ? Prisma.sql`AND LOWER(s.title) LIKE ${like} ESCAPE '\\\\'`
      : Prisma.sql``;
    const orderPrefix = trimmedQuery
      ? Prisma.sql`CASE WHEN LOWER(s.title) LIKE ${prefixLike} ESCAPE '\\\\' THEN 0 ELSE 1 END,`
      : Prisma.sql``;

    const channelClause =
      typeof channelId === 'number'
        ? Prisma.sql`AND s.channel_id = ${channelId}`
        : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<PopularSongRow[]>(Prisma.sql`
      SELECT
        s.id AS id,
        s.title AS title,
        s.artist_id AS artistId,
        a.name AS artistName,
        COALESCE(req.requestCount, 0) AS requestCount,
        COALESCE(likes.likeCount, 0) AS likeCount
      FROM songs s
      INNER JOIN artists a ON a.id = s.artist_id
      LEFT JOIN (
        SELECT song_id, COUNT(*) AS requestCount
        FROM song_requests
        WHERE song_id IS NOT NULL
        GROUP BY song_id
      ) req ON req.song_id = s.id
      LEFT JOIN (
        SELECT song_id, COUNT(*) AS likeCount
        FROM user_song_likes
        GROUP BY song_id
      ) likes ON likes.song_id = s.id
      WHERE 1=1
      ${channelClause}
      ${whereClause}
      ORDER BY
        ${orderPrefix}
        requestCount DESC,
        likeCount DESC,
        s.id DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      ...row,
      requestCount: Number(row.requestCount) || 0,
      likeCount: Number(row.likeCount) || 0,
    }));
  }

  private async fetchArtistsByExactTitle(
    channelId: number | undefined,
    normalizedTitle: string,
    limit: number,
  ): Promise<SongArtistSuggestionDto[]> {
    const channelClause =
      typeof channelId === 'number'
        ? Prisma.sql`AND s.channel_id = ${channelId}`
        : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<ArtistMatchRow[]>(Prisma.sql`
      SELECT
        s.artist_id AS artistId,
        a.name AS artistName,
        COUNT(*) AS matchCount
      FROM songs s
      INNER JOIN artists a ON a.id = s.artist_id
      WHERE 1=1
        ${channelClause}
        AND REPLACE(LOWER(s.title), ' ', '') = ${normalizedTitle}
      GROUP BY s.artist_id, a.name
      ORDER BY matchCount DESC, a.name ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      artistId: row.artistId,
      artistName: row.artistName,
      isExisting: true,
      matchCount: Number(row.matchCount) || 0,
    }));
  }

  private async fetchArtistsByTitleLike(
    channelId: number | undefined,
    rawTitle: string,
    limit: number,
  ): Promise<SongArtistSuggestionDto[]> {
    const lower = rawTitle.trim().toLowerCase();
    if (!lower) return [];
    const escaped = this.escapeLike(lower);
    const like = `%${escaped}%`;
    const channelClause =
      typeof channelId === 'number'
        ? Prisma.sql`AND s.channel_id = ${channelId}`
        : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<ArtistMatchRow[]>(Prisma.sql`
      SELECT
        s.artist_id AS artistId,
        a.name AS artistName,
        COUNT(*) AS matchCount
      FROM songs s
      INNER JOIN artists a ON a.id = s.artist_id
      WHERE 1=1
        ${channelClause}
        AND LOWER(s.title) LIKE ${like} ESCAPE '\\\\'
      GROUP BY s.artist_id, a.name
      ORDER BY matchCount DESC, a.name ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      artistId: row.artistId,
      artistName: row.artistName,
      isExisting: true,
      matchCount: Number(row.matchCount) || 0,
    }));
  }

  private async getChannelsForWarm(): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<{ channelId: number }[]>(
      Prisma.sql`
        SELECT s.channel_id AS channelId
        FROM songs s
        GROUP BY s.channel_id
        HAVING COUNT(*) >= ${WARM_MIN_SONGS}
      `,
    );

    return rows.map((row) => row.channelId);
  }

  private clampLimit(limit: number, fallback: number): number {
    if (!Number.isFinite(limit)) return fallback;
    return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
  }

  private normalizeKey(value: string): string {
    return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
  }

  private buildCacheKeyFragment(value: string): string {
    if (value.length <= 64) return value;
    return createHash('sha1').update(value).digest('hex');
  }
}
