import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Cache } from 'cache-manager';
import { createHash } from 'crypto';
import { ALBUM_ART_BLOCKED_URL_PREFIXES } from '../common/constants/album-art-blacklist';
import {
  InternalServerException,
  InvalidInputException,
} from '../common/exceptions/custom.exception';
import { SpotifySearchDto } from '../spotify/dto/spotify.request.dto';
import {
  SerperImageItemDto,
  SerperResponseDto,
} from './dto/serper.response.dto';

interface SearxngImageResult {
  title?: unknown;
  url?: unknown;
  img_src?: unknown;
  thumbnail_src?: unknown;
  thumbnail?: unknown;
  source?: unknown;
  resolution?: unknown;
  engine?: unknown;
  engines?: unknown;
}

interface SearxngImageResponse {
  results?: SearxngImageResult[];
}

@Injectable()
export class SearxngImageSearchService {
  private readonly logger = new Logger(SearxngImageSearchService.name);
  private readonly blockedUrlPrefixes = ALBUM_ART_BLOCKED_URL_PREFIXES;
  private readonly cacheTtlMs = 14 * 24 * 60 * 60 * 1000;
  private readonly emptyCacheTtlMs = 5 * 60 * 1000;
  private readonly resultLimit = 100;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  async searchImages(dto: SpotifySearchDto): Promise<SerperResponseDto> {
    const title = dto.title?.trim();
    const artist = dto.artist?.trim();
    if (!title || !artist) {
      throw new InvalidInputException('노래 제목과 가수명이 필요합니다.');
    }

    const provider = this.getProvider();
    const query = `${title} ${artist}`;
    const cacheKey = this.makeCacheKey(query, provider);
    const requestImages =
      provider === 'serper'
        ? (searchQuery: string) => this.requestSerperImages(searchQuery)
        : (searchQuery: string) =>
            this.requestSearxngImages(this.getBaseUrl(), searchQuery);

    try {
      const cached = await this.cacheManager.get<SerperResponseDto>(cacheKey);
      if (cached) {
        return cached;
      }

      const primaryResult = await requestImages(query);
      if (primaryResult.images.length > 0) {
        await this.cacheManager.set(cacheKey, primaryResult, this.cacheTtlMs);
        return primaryResult;
      }

      const fallbackQuery = `${title} - ${artist}`;
      const fallbackCacheKey = this.makeCacheKey(fallbackQuery, provider);
      const cachedFallback =
        await this.cacheManager.get<SerperResponseDto>(fallbackCacheKey);
      if (cachedFallback && cachedFallback.images.length > 0) {
        await this.cacheManager.set(cacheKey, cachedFallback, this.cacheTtlMs);
        return cachedFallback;
      }

      const fallbackResult = await requestImages(fallbackQuery);
      const fallbackTtl =
        fallbackResult.images.length > 0
          ? this.cacheTtlMs
          : this.emptyCacheTtlMs;
      await this.cacheManager.set(
        fallbackCacheKey,
        fallbackResult,
        fallbackTtl,
      );
      await this.cacheManager.set(cacheKey, fallbackResult, fallbackTtl);
      return fallbackResult;
    } catch (error) {
      this.logger.error(
        `${provider} 이미지 검색 실패 (query="${query}")`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerException(
        '이미지 검색 중 오류가 발생했습니다.',
      );
    }
  }

  private async requestSearxngImages(
    baseUrl: string,
    query: string,
  ): Promise<SerperResponseDto> {
    const response = await axios.get<SearxngImageResponse>(
      `${baseUrl}/search`,
      {
        params: {
          q: `!ddi ${query}`,
          categories: 'images',
          engines: 'duckduckgo images',
          format: 'json',
          language: 'ko-KR',
          safesearch: 1,
          pageno: 1,
        },
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MelomingImageSearch/1.0',
        },
        timeout: this.getTimeoutMs(),
        maxContentLength: 5 * 1024 * 1024,
      },
    );

    const images = this.mapResults(response.data.results ?? []);
    return {
      searchParameters: {
        q: query,
        gl: 'kr',
        hl: 'ko',
        type: 'images',
        engine: 'duckduckgo images',
        num: images.length,
      },
      images,
    };
  }

  private async requestSerperImages(query: string): Promise<SerperResponseDto> {
    const apiKey = this.configService.get<string>('SERPER_API_KEY')?.trim();
    if (!apiKey) {
      throw new InternalServerException(
        '이미지 검색 서비스가 설정되지 않았습니다. 관리자에게 문의하세요.',
      );
    }

    const response = await axios.post<SerperResponseDto>(
      'https://google.serper.dev/images',
      { q: query, gl: 'kr', hl: 'ko', num: this.resultLimit },
      {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: this.getTimeoutMs(),
        maxContentLength: 5 * 1024 * 1024,
      },
    );

    const seen = new Set<string>();
    const images = (response.data.images ?? [])
      .flatMap((item) => {
        const imageUrl = this.toHttpUrl(item.imageUrl);
        if (!imageUrl || this.isBlocked(imageUrl) || seen.has(imageUrl)) {
          return [];
        }
        seen.add(imageUrl);
        return [{ ...item, imageUrl, position: seen.size }];
      })
      .slice(0, this.resultLimit);

    return {
      ...response.data,
      searchParameters: {
        ...response.data.searchParameters,
        q: query,
        gl: 'kr',
        hl: 'ko',
        type: 'images',
        engine: 'google',
        num: images.length,
      },
      images,
    };
  }

  private mapResults(results: SearxngImageResult[]): SerperImageItemDto[] {
    const seen = new Set<string>();
    const images: SerperImageItemDto[] = [];

    for (const item of results) {
      if (!this.getEngines(item).includes('duckduckgo images')) continue;

      const imageUrl = this.toHttpUrl(item.img_src);
      if (!imageUrl || this.isBlocked(imageUrl) || seen.has(imageUrl)) continue;

      const pageUrl = this.toHttpUrl(item.url);
      const thumbnailUrl = this.toHttpUrl(
        item.thumbnail_src ?? item.thumbnail,
      );
      const size = this.parseResolution(item.resolution);
      const domain = pageUrl ? new URL(pageUrl).hostname : undefined;
      const source = this.toText(item.source) ?? domain;

      seen.add(imageUrl);
      images.push({
        title: this.toText(item.title) ?? '(untitled)',
        imageUrl,
        imageWidth: size?.width,
        imageHeight: size?.height,
        thumbnailUrl,
        source,
        domain,
        link: pageUrl,
        position: images.length + 1,
      });

      if (images.length >= this.resultLimit) break;
    }

    return images;
  }

  private getBaseUrl(): string {
    const configured = this.configService
      .get<string>('SEARXNG_BASE_URL')
      ?.trim()
      .replace(/\/$/, '');
    if (!configured || !this.toHttpUrl(configured)) {
      throw new InternalServerException(
        '이미지 검색 서비스가 설정되지 않았습니다. 관리자에게 문의하세요.',
      );
    }
    return configured;
  }

  private getTimeoutMs(): number {
    const configured = Number(
      this.configService.get<string | number>('SEARXNG_REQUEST_TIMEOUT_MS'),
    );
    if (
      !Number.isFinite(configured) ||
      configured < 1000 ||
      configured > 30000
    ) {
      return 10000;
    }
    return Math.trunc(configured);
  }

  private makeCacheKey(query: string, provider: 'searxng' | 'serper'): string {
    const normalized = query
      .normalize('NFC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    const hash = createHash('md5').update(normalized, 'utf8').digest('hex');
    return `${provider}:images:v1:${hash}`;
  }

  private getProvider(): 'searxng' | 'serper' {
    return this.configService.get<string>('IMAGE_SEARCH_PROVIDER') === 'serper'
      ? 'serper'
      : 'searxng';
  }

  private getEngines(item: SearxngImageResult): string[] {
    const values = Array.isArray(item.engines) ? item.engines : [item.engine];
    return values
      .map((value) => this.toText(value)?.toLowerCase())
      .filter((value): value is string => Boolean(value));
  }

  private parseResolution(
    value: unknown,
  ): { width: number; height: number } | undefined {
    const match = this.toText(value)?.match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (!match) return undefined;
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  private isBlocked(url: string): boolean {
    return this.blockedUrlPrefixes.some((prefix) => url.startsWith(prefix));
  }

  private toText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized || undefined;
  }

  private toHttpUrl(value: unknown): string | undefined {
    const text = this.toText(value);
    if (!text) return undefined;
    try {
      const url = new URL(text);
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  }
}
