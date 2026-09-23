import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSongRedisService } from './global-song-redis.service';

export interface RecommendationItem {
  globalSongId: number;
  title: string;
  artist: string;
  albumArt: string | null;
  score: number;
  reason: string;
  channelCount: number;
  topCategories: string[];
}

export interface RecommendationsResponseDto {
  recommendations: RecommendationItem[];
  metadata: {
    basedOnSongCount: number;
    lastCalculated: string | null;
  };
}

/**
 * Serves pre-computed recommendations from Redis cache.
 * Enriches with live song metadata (title, artist, albumArt, topCategories).
 */
@Injectable()
export class GlobalSongRecommendationService {
  private readonly logger = new Logger(GlobalSongRecommendationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
  ) {}

  async getRecommendations(
    channelId: number,
    limit = 20,
    offset = 0,
  ): Promise<RecommendationsResponseDto> {
    const cached = await this.redis.getChannelRecommendations(channelId);
    if (!cached || cached.length === 0) {
      return {
        recommendations: [],
        metadata: { basedOnSongCount: 0, lastCalculated: null },
      };
    }

    const paged = cached.slice(offset, offset + limit);
    const songIds = paged.map((r) => r.globalSongId);

    // Enrich with live metadata
    const songs = await this.prisma.globalSong.findMany({
      where: { id: { in: songIds } },
      include: { globalArtist: { select: { canonicalName: true } } },
    });
    const songById = new Map(songs.map((s) => [s.id, s]));

    // Parallel category lookups for all paged results
    const categoriesArr = await Promise.all(
      paged.map((rec) => this.redis.getTopCategories(rec.globalSongId, 5)),
    );

    const recommendations: RecommendationItem[] = [];
    for (let i = 0; i < paged.length; i++) {
      const rec = paged[i];
      const song = songById.get(rec.globalSongId);
      if (!song) continue;

      recommendations.push({
        globalSongId: rec.globalSongId,
        title: song.title,
        artist: song.globalArtist.canonicalName,
        albumArt: song.albumArt,
        score: rec.score,
        reason: rec.reason,
        channelCount: song.channelCount,
        topCategories: categoriesArr[i],
      });
    }

    // SCARD instead of SMEMBERS — only need the count
    const channelSongCount = await this.redis.getChannelSongSetCount(channelId);

    return {
      recommendations,
      metadata: {
        basedOnSongCount: channelSongCount,
        lastCalculated: new Date().toISOString(),
      },
    };
  }

  /**
   * Get a few post-add recommendations for the quick-add response.
   */
  async getPostAddRecommendations(
    channelId: number,
    limit = 5,
  ): Promise<RecommendationItem[]> {
    const result = await this.getRecommendations(channelId, limit);
    return result.recommendations;
  }
}
