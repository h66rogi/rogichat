import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'node:crypto';
import { SearchCache } from './search-cache.js';
import { SearxngImageSearchService } from './searxng-image-search.service.js';
import type { SerperResponseDto } from './serper.response.dto.js';
import type { SerperVideoItemDto, SerperVideoResponseDto } from './serper-video.response.dto.js';
import type { SerperWebResponseDto } from './serper-web.response.dto.js';

type SpotifySearchDto={title:string;artist:string};
type SerperVideoRequestDto={query:string;num?:number};
type SerperWebRequestDto={query:string;num?:number};

@Injectable()
export class SerperService {
  private readonly logger = new Logger(SerperService.name);

  constructor(
    private readonly cacheManager: SearchCache,
    private readonly searxngImageSearchService: SearxngImageSearchService,
  ) {}

  async searchImages(dto: SpotifySearchDto): Promise<SerperResponseDto> {
    return this.searxngImageSearchService.searchImages(dto);
  }

  async searchVideos(
    dto: SerperVideoRequestDto,
  ): Promise<SerperVideoResponseDto> {
    const rawQuery = dto.query?.trim();
    if (!rawQuery) {
      throw new BadRequestException('검색어가 필요합니다.');
    }

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Serper API 키가 설정되지 않았습니다. 관리자에게 문의하세요.',
      );
    }

    const num = Math.min(Math.max(dto.num ?? 20, 1), 50);
    const normalized = rawQuery
      .normalize('NFC')
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const hash = createHash('md5').update(normalized, 'utf8').digest('hex');
    const cacheKey = `serper:videos:${hash}:${num}`;
    const ttlMs = 14 * 24 * 60 * 60 * 1000; // 14일

    try {
      const cached =
        await this.cacheManager.get<SerperVideoResponseDto>(cacheKey);
      if (cached && (cached.videos?.length ?? 0) > 0) {
        return cached;
      }

      const response = await axios.post(
        'https://google.serper.dev/videos',
        { q: rawQuery, gl: 'kr', hl: 'ko', num },
        {
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
          },
          maxBodyLength: Infinity,
          timeout: 10000,
          maxContentLength: 5 * 1024 * 1024,
        },
      );

      const data = response.data as SerperVideoResponseDto;
      const filtered = (data.videos || []).filter((v: SerperVideoItemDto) =>
        this.isYoutubeLink(v?.link),
      );

      const result: SerperVideoResponseDto = { ...data, videos: filtered };
      // 캐시 히트 조건이 videos.length > 0 이므로, 빈 결과는 저장해도 사실상 재사용되지 않음.
      // 재호출 반복을 피하려면 저장하지 말고 다음 호출에서 다시 시도하도록 둔다.
      if (filtered.length > 0) {
        await this.cacheManager.set(cacheKey, result, ttlMs);
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Serper 비디오 검색 실패 (query="${rawQuery}")`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        'Serper 비디오 검색 중 오류가 발생했습니다.',
      );
    }
  }

  private isYoutubeLink(link?: string): boolean {
    if (!link) return false;
    try {
      const host = new URL(link).hostname.toLowerCase();
      return (
        host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'music.youtube.com' ||
        host === 'youtu.be'
      );
    } catch {
      return false;
    }
  }

  async searchWeb(dto: SerperWebRequestDto): Promise<SerperWebResponseDto> {
    const rawQuery = dto.query?.trim();
    if (!rawQuery) {
      throw new BadRequestException('검색어가 필요합니다.');
    }

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Serper API 키가 설정되지 않았습니다. 관리자에게 문의하세요.',
      );
    }

    const num = Math.min(Math.max(dto.num ?? 20, 1), 50);
    const normalized = rawQuery
      .normalize('NFC')
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const hash = createHash('md5').update(normalized, 'utf8').digest('hex');
    const cacheKey = `serper:web:${hash}:${num}`;
    const ttlMs = 14 * 24 * 60 * 60 * 1000; // 14일

    try {
      const cached =
        await this.cacheManager.get<SerperWebResponseDto>(cacheKey);
      if (cached && (cached.organic?.length ?? 0) > 0) {
        return cached;
      }

      const response = await axios.post(
        'https://google.serper.dev/search',
        { q: rawQuery, gl: 'kr', hl: 'ko', num },
        {
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
          },
          maxBodyLength: Infinity,
          timeout: 10000,
          maxContentLength: 5 * 1024 * 1024,
        },
      );

      const data = response.data as SerperWebResponseDto & {
        organic?: SerperWebResponseDto['organic'];
      };
      const result: SerperWebResponseDto = {
        ...data,
        organic: data.organic ?? [],
      };
      // 빈 결과는 캐시 히트 조건(organic.length > 0)을 통과 못 해 무용이므로 저장하지 않음
      if (result.organic.length > 0) {
        await this.cacheManager.set(cacheKey, result, ttlMs);
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Serper 웹 검색 실패 (query="${rawQuery}")`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        'Serper 웹 검색 중 오류가 발생했습니다.',
      );
    }
  }
}
