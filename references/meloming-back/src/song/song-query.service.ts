import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';
import type { SongsListResponse } from './dto/song.dto';
import { sortSongCategories } from './utils/sort-song-categories';
import { normalizeForSearch, escapeForLike } from './utils/search-normalize';
import { mapSongForViewer } from './song-mappers';

@Injectable()
export class SongQueryService {
  private readonly logger = new Logger(SongQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheTracker: CacheKeyTrackingService,
  ) {}

  async getSongsByChannelId(
    channelId: number,
    query: any = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    const { userId } = viewer;
    const role = viewer.isManager ? 'manager' : 'viewer';
    const {
      page = 1,
      limit = 20,
      search,
      categoryId,
      difficulty,
      proficiency,
      artistId,
      sortBy = 'newest',
    } = query;

    const cacheKey = `songs_by_channel_${channelId}_${page}_${limit}_${search || ''}_${categoryId || ''}_${difficulty || ''}_${proficiency || ''}_${artistId || ''}_${sortBy || ''}_role_${role}`;
    const cached = await this.cacheTracker.get<SongsListResponse>(cacheKey);
    if (cached) {
      if (userId) return await this.overlayFavorites(cached, userId);
      return cached;
    }

    const offset = (page - 1) * limit;
    const where: Prisma.SongWhereInput = { channelId };
    if (search) {
      const searchKey = normalizeForSearch(search);
      if (searchKey) {
        const escaped = escapeForLike(searchKey);
        where.OR = [
          { titleSearchable: { contains: escaped } },
          { artist: { nameSearchable: { contains: escaped } } },
        ];
      } else {
        // 입력이 whitespace/invisible 문자로만 구성되면 normalize 결과가 빈 문자열.
        // OR 절을 만들지 않은 채 진행하면 channel scope 만 남아 전체 곡이 반환되어
        // 사용자가 "검색을 하긴 했는데 전체 곡이 나온" 혼동 상황 발생. 명시적으로
        // 빈 결과를 돌려주고 로그로 가시화.
        this.logger.warn(
          `Song search normalized to empty (V1): channelId=${channelId} raw=${JSON.stringify(search).slice(0, 50)}`,
        );
        return { songs: [], total: 0, page, limit };
      }
    }
    if (categoryId) where.songCategories = { some: { categoryId } };
    if (difficulty) where.difficulty = difficulty;
    if (proficiency) where.proficiency = proficiency;
    if (artistId) where.artistId = artistId;

    const total = await this.prisma.song.count({ where });

    const kindSortBy = typeof sortBy === 'string' ? sortBy : undefined;
    const orderBy = this.buildSongOrderBy(kindSortBy);

    const songs = await this.prisma.song.findMany({
      where,
      include: {
        artist: true,
        songCategories: { include: { category: true } },
        channel: {
          select: {
            id: true,
            name: true,
            webPath: true,
            themeColor: true,
            profileImageUrl: true,
            user: { select: { id: true, nickname: true } },
          },
        },
        _count: { select: { userLikes: true } },
      },
      orderBy,
      skip: offset,
      take: limit,
    });

    const result: SongsListResponse = {
      songs: songs.map((s) => {
        const mapped = mapSongForViewer(s, viewer);
        return {
          ...mapped,
          totalFavorites: (s as any)._count?.userLikes ?? 0,
          categories: sortSongCategories(s.songCategories),
          isFavorite: false,
        };
      }),
      total,
      page,
      limit,
    };

    await this.cacheTracker.trackAndSet(cacheKey, result, 60, {
      kind: 'channel',
      channelId,
    });
    if (userId) return await this.overlayFavorites(result, userId);
    return result;
  }

  async getSongsByChannelIdV2(
    channelId: number,
    query: any = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    const { userId } = viewer;
    const role = viewer.isManager ? 'manager' : 'viewer';
    const {
      page = 1,
      limit = 20,
      search,
      categoryIds = [],
      difficulties = [],
      proficiencies = [],
      artistIds = [],
      sortBy = 'newest',
    } = query;

    const cacheKey = `songs_by_channel_v2_${channelId}_${page}_${limit}_${search || ''}_${categoryIds.join(',') || ''}_${difficulties.join(',') || ''}_${proficiencies.join(',') || ''}_${artistIds.join(',') || ''}_${sortBy || ''}_role_${role}`;
    const cached = await this.cacheTracker.get<SongsListResponse>(cacheKey);
    if (cached) {
      if (userId) return await this.overlayFavorites(cached, userId);
      return cached;
    }

    const offset = (page - 1) * limit;
    const where: Prisma.SongWhereInput = { channelId };
    if (search) {
      const searchKey = normalizeForSearch(search);
      if (searchKey) {
        const escaped = escapeForLike(searchKey);
        where.OR = [
          { titleSearchable: { contains: escaped } },
          { artist: { nameSearchable: { contains: escaped } } },
        ];
      } else {
        // V1 과 동일 정책 — invisible/whitespace-only 입력은 명시적으로 빈 결과 반환.
        this.logger.warn(
          `Song search normalized to empty (V2): channelId=${channelId} raw=${JSON.stringify(search).slice(0, 50)}`,
        );
        return { songs: [], total: 0, page, limit };
      }
    }
    if (categoryIds?.length)
      where.songCategories = { some: { categoryId: { in: categoryIds } } };
    if (difficulties?.length) where.difficulty = { in: difficulties } as any;
    if (proficiencies?.length) where.proficiency = { in: proficiencies } as any;
    if (artistIds?.length) where.artistId = { in: artistIds } as any;

    const total = await this.prisma.song.count({ where });

    const kindSortBy = typeof sortBy === 'string' ? sortBy : undefined;
    const orderBy = this.buildSongOrderBy(kindSortBy);

    const songs = await this.prisma.song.findMany({
      where,
      include: {
        artist: true,
        songCategories: { include: { category: true } },
        channel: {
          select: {
            id: true,
            name: true,
            webPath: true,
            themeColor: true,
            profileImageUrl: true,
            user: { select: { id: true, nickname: true } },
          },
        },
        _count: { select: { userLikes: true } },
      },
      orderBy,
      skip: offset,
      take: limit,
    });

    const result: SongsListResponse = {
      songs: songs.map((s) => {
        const mapped = mapSongForViewer(s, viewer);
        return {
          ...mapped,
          totalFavorites: (s as any)._count?.userLikes ?? 0,
          categories: sortSongCategories(s.songCategories),
          isFavorite: false,
        };
      }),
      total,
      page,
      limit,
    };

    await this.cacheTracker.trackAndSet(cacheKey, result, 60, {
      kind: 'channel',
      channelId,
    });
    if (userId) return await this.overlayFavorites(result, userId);
    return result;
  }

  async searchSongs(
    query: any = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    const { userId } = viewer;
    const role = viewer.isManager ? 'manager' : 'viewer';
    const {
      page = 1,
      limit = 20,
      search,
      categoryId,
      difficulty,
      proficiency,
      artistId,
      sortBy = 'newest',
    } = query;

    const normalizedSearch =
      typeof search === 'string' ? search.trim() : undefined;
    const cacheKey = `songs_global_${page}_${limit}_${normalizedSearch || ''}_${categoryId || ''}_${difficulty || ''}_${proficiency || ''}_${artistId || ''}_${sortBy || ''}_role_${role}`;
    const cached = await this.cacheTracker.get<SongsListResponse>(cacheKey);
    if (cached) {
      if (userId) return await this.overlayFavorites(cached, userId);
      return cached;
    }

    const offset = (page - 1) * limit;
    const where: Prisma.SongWhereInput = {};

    if (normalizedSearch) {
      // 노래책 핵심 컬럼 (title / artist) 은 NFKC + lowercase + 공백 제거된 키로
      // 매칭. 정규화 컬럼이 없는 Channel.name / webPath 는 NFKC 미적용 입력 그대로
      // 매칭 (webPath 는 슬러그라 공백 없고, channel name 도 단어 단위라 무공백
      // 매칭 needs 거의 없음). 양쪽 분기 모두 LIKE wildcard escape 통과.
      const titleKey = normalizeForSearch(normalizedSearch);
      const channelInput = escapeForLike(normalizedSearch);
      const orConditions: Prisma.SongWhereInput[] = [
        { channel: { name: { contains: channelInput } } },
        { channel: { webPath: { contains: channelInput } } },
      ];
      if (titleKey) {
        const titleEscaped = escapeForLike(titleKey);
        orConditions.push(
          { titleSearchable: { contains: titleEscaped } },
          { artist: { nameSearchable: { contains: titleEscaped } } },
        );
      } else {
        // title/artist 매칭이 빠진 채 channel 만 매칭으로 변질됐음을 가시화.
        this.logger.warn(
          `Global search title/artist branch dropped — invisible-only key: raw=${JSON.stringify(normalizedSearch).slice(0, 50)}`,
        );
      }
      where.OR = orConditions;
    }
    if (categoryId) where.songCategories = { some: { categoryId } };
    if (difficulty) where.difficulty = difficulty;
    if (proficiency) where.proficiency = proficiency;
    if (artistId) where.artistId = artistId;

    const total = await this.prisma.song.count({ where });

    const kindSortBy = typeof sortBy === 'string' ? sortBy : undefined;
    const orderBy = this.buildSongOrderBy(kindSortBy);

    const songs = await this.prisma.song.findMany({
      where,
      include: {
        artist: true,
        songCategories: { include: { category: true } },
        channel: {
          select: {
            id: true,
            name: true,
            webPath: true,
            themeColor: true,
            profileImageUrl: true,
            user: { select: { id: true, nickname: true } },
          },
        },
        _count: { select: { userLikes: true } },
      },
      orderBy,
      skip: offset,
      take: limit,
    });

    const result: SongsListResponse = {
      songs: songs.map((s) => {
        const mapped = mapSongForViewer(s, viewer);
        return {
          ...mapped,
          totalFavorites: (s as any)._count?.userLikes ?? 0,
          categories: sortSongCategories(s.songCategories),
          isFavorite: false,
        };
      }),
      total,
      page,
      limit,
    };

    await this.cacheTracker.trackAndSet(cacheKey, result, 60, {
      kind: 'global',
    });
    if (userId) return await this.overlayFavorites(result, userId);
    return result;
  }

  async getRandomSongsByChannelId(
    channelId: number,
    count: number,
    categoryIds: number[] = [],
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    const { userId } = viewer;
    const role = viewer.isManager ? 'manager' : 'viewer';
    // Cache song IDs per channel (+ optional category filter) for 1 hour,
    // then uniformly sample IDs and fetch details.
    const normalizedCategoryIds = [...new Set(categoryIds)]
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);

    const where: Prisma.SongWhereInput = { channelId };
    if (normalizedCategoryIds.length > 0) {
      where.songCategories = {
        some: { categoryId: { in: normalizedCategoryIds } },
      };
    }

    const totalInPool = await this.prisma.song.count({ where });
    if (totalInPool === 0) {
      const empty: SongsListResponse = {
        songs: [],
        total: 0,
        page: 1,
        limit: count,
      };
      if (userId) return await this.overlayFavorites(empty, userId);
      return empty;
    }

    const take = Math.min(count, totalInPool);
    const cacheKeyBase = `song_ids_by_channel_${channelId}`;
    const cacheKey =
      normalizedCategoryIds.length > 0
        ? `${cacheKeyBase}_categories_${normalizedCategoryIds.join(',')}_role_${role}`
        : `${cacheKeyBase}_role_${role}`;
    const ttlSec = 60 * 60; // 1 hour

    let idList = (await this.cacheTracker.get<number[]>(cacheKey)) || null;
    if (!idList || idList.length === 0) {
      const ids = await this.prisma.song.findMany({
        where,
        select: { id: true },
      });
      idList = ids.map((r) => r.id);
      await this.cacheTracker.trackAndSet(cacheKey, idList, ttlSec, {
        kind: 'channel',
        channelId,
      });
    }

    const sampleIds = (sourceIds: number[], k: number): number[] => {
      if (k >= sourceIds.length) return [...sourceIds];
      const arr = [...sourceIds];
      for (let i = arr.length - 1; i > arr.length - 1 - k; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.slice(arr.length - k);
    };

    const pickAndLoad = async (idsPool: number[], size: number) => {
      const picked = sampleIds(idsPool, size);
      if (picked.length === 0) return { songs: [], pickedIds: picked };
      const songs = await this.prisma.song.findMany({
        where: { id: { in: picked }, channelId },
        include: {
          artist: true,
          songCategories: { include: { category: true } },
          channel: {
            select: {
              id: true,
              name: true,
              webPath: true,
              themeColor: true,
              profileImageUrl: true,
              user: { select: { id: true, nickname: true } },
            },
          },
          _count: { select: { userLikes: true } },
        },
      });
      // Preserve random order according to picked IDs
      const order = new Map<number, number>();
      picked.forEach((id, idx) => order.set(id, idx));
      songs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      return { songs, pickedIds: picked };
    };

    // First try with cached IDs
    let { songs, pickedIds } = await pickAndLoad(idList, take);

    // If fetched fewer than requested (stale IDs), rebuild once and retry
    if (songs.length < take) {
      const freshIds = await this.prisma.song.findMany({
        where,
        select: { id: true },
      });
      idList = freshIds.map((r) => r.id);
      await this.cacheTracker.trackAndSet(cacheKey, idList, ttlSec, {
        kind: 'channel',
        channelId,
      });
      const retried = await pickAndLoad(idList, take);
      songs = retried.songs;
      pickedIds = retried.pickedIds;
    }

    const result: SongsListResponse = {
      songs: songs.map((s) => {
        const mapped = mapSongForViewer(s, viewer);
        return {
          ...mapped,
          totalFavorites: (s as any)._count?.userLikes ?? 0,
          categories: sortSongCategories(s.songCategories),
          isFavorite: false,
        };
      }),
      total: take,
      page: 1,
      limit: take,
    };

    if (userId) return await this.overlayFavorites(result, userId);
    return result;
  }

  async getMyFavoriteSongsByChannel(
    userId: number,
    channelId: number,
    query: { page?: number; limit?: number } = {},
    viewer: { userId?: number; isManager: boolean } = { isManager: false },
  ): Promise<SongsListResponse> {
    const { page = 1, limit = 20 } = query;
    const offset = (page - 1) * limit;

    // 해당 채널의 노래 중 내가 즐겨찾기한 노래만 조회
    const where: Prisma.SongWhereInput = {
      channelId,
      userLikes: {
        some: {
          userId,
        },
      },
    };

    const [total, songs] = await Promise.all([
      this.prisma.song.count({ where }),
      this.prisma.song.findMany({
        where,
        include: {
          artist: true,
          songCategories: { include: { category: true } },
          channel: {
            select: {
              id: true,
              name: true,
              webPath: true,
              themeColor: true,
              profileImageUrl: true,
              user: { select: { id: true, nickname: true } },
            },
          },
          userLikes: {
            where: { userId },
            select: { createdAt: true },
            take: 1,
          },
          _count: { select: { userLikes: true } },
        },
        orderBy: {
          userLikes: {
            _count: 'desc',
          },
        },
        skip: offset,
        take: limit,
      }),
    ]);

    const result: SongsListResponse = {
      songs: songs.map((s) => {
        const mapped = mapSongForViewer(s, viewer);
        return {
          ...mapped,
          totalFavorites: (s as any)._count?.userLikes ?? 0,
          categories: sortSongCategories(s.songCategories),
          isFavorite: true, // 즐겨찾기한 노래만 조회하므로 항상 true
        };
      }),
      total,
      page,
      limit,
    };

    return result;
  }

  /**
   * Compose a deterministic orderBy clause so pagination never reuses rows.
   */
  private buildSongOrderBy(
    sortBy?: string,
  ): Prisma.SongOrderByWithRelationInput[] {
    const fallbackDesc: Prisma.SongOrderByWithRelationInput = { id: 'desc' };
    const fallbackAsc: Prisma.SongOrderByWithRelationInput = { id: 'asc' };

    switch (sortBy) {
      case 'oldest':
        return [{ createdAt: 'asc' }, fallbackAsc];
      case 'title':
        return [{ title: 'asc' }, fallbackAsc];
      case 'artist':
        return [{ artist: { name: 'asc' } }, fallbackAsc];
      case 'favorites_desc':
      case 'likes_desc':
        return [{ userLikes: { _count: 'desc' } }, fallbackDesc];
      case 'favorites_asc':
      case 'likes_asc':
        return [{ userLikes: { _count: 'asc' } }, fallbackAsc];
      default:
        return [{ createdAt: 'desc' }, fallbackDesc];
    }
  }

  private async overlayFavorites(
    result: SongsListResponse,
    userId: number,
  ): Promise<SongsListResponse> {
    const songIds: number[] = (result.songs || []).map((s: any) => s.id);
    if (songIds.length === 0) return result;
    const likes = await this.prisma.userSongLike.findMany({
      where: { userId, songId: { in: songIds } },
      select: { songId: true },
    });
    const likedSet = new Set(likes.map((l) => l.songId));
    return {
      ...result,
      songs: result.songs.map((s: any) => ({
        ...(s as Record<string, unknown>),
        isFavorite: likedSet.has(s.id),
      })),
    };
  }
}
