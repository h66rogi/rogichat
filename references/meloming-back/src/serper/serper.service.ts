import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';
import { createHash } from 'crypto';
import { SpotifySearchDto } from '../spotify/dto/spotify.request.dto';
import {
  InvalidInputException,
  InternalServerException,
} from '../common/exceptions/custom.exception';
import {
  SerperResponseDto,
} from './dto/serper.response.dto';
import { SerperVideoRequestDto } from './dto/serper-video.request.dto';
import {
  SerperVideoItemDto,
  SerperVideoResponseDto,
} from './dto/serper-video.response.dto';
import { SerperWebRequestDto } from './dto/serper-web.request.dto';
import { SerperWebResponseDto } from './dto/serper-web.response.dto';
import { SearxngImageSearchService } from './searxng-image-search.service';

@Injectable()
export class SerperService {
  private readonly logger = new Logger(SerperService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
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
      throw new InvalidInputException('검색어가 필요합니다.');
    }

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      throw new InternalServerException(
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
      throw new InternalServerException(
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
      throw new InvalidInputException('검색어가 필요합니다.');
    }

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) {
      throw new InternalServerException(
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
      throw new InternalServerException(
        'Serper 웹 검색 중 오류가 발생했습니다.',
      );
    }
  }
}
