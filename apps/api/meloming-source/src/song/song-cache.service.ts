import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CHANNEL_EVENTS, ChannelDeletedEvent } from '../channel/channel-events';
import { ARTIST_EVENTS, ArtistDeletedEvent } from '../artist/artist-events';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';
import { REDIS_CLIENT, type AppRedisClient } from '../redis/redis.module';
import { Inject } from '@nestjs/common';

/**
 * Layer 1 — explicit key tracking 기반 song 캐시 무효화.
 *
 * 2026-04-27 P0 인시던트 (POST /v1/songs/channel 10초 timeout) 의 근본 해결.
 * SCAN-by-prefix 무효화 폐기 → cache_keys SET 기반 atomic 회수.
 *
 * 구현
 * - `tracker.clearChannel(channelId)`: 채널 SET 의 모든 추적 키 (songs_by_channel_*,
 *   song_ids_by_channel_*, artists_by_channel_* / artists_by_webpath_*,
 *   categories_by_channel_* / categories_by_webpath_*, song_autocomplete:*,
 *   songs_fuzzy_*) 일괄 회수. 단일 Lua atomic.
 * - `tracker.clearGlobal()`: songs_global_*, autocomplete global 키 회수.
 * - `public_stats`: NestJS CacheInterceptor 가 set 하는 단일 키. tracker 가 아닌
 *   raw client UNLINK 로 직접 삭제 (interceptor 는 trackAndSet 우회).
 *
 * 호출자: SongMutationService, SongAddRequestService,
 * 그리고 누락 9 사이트 (commit 5/7 에서 통합 예정).
 */
@Injectable()
export class SongCacheService {
  private readonly logger = new Logger(SongCacheService.name);

  constructor(
    private readonly cacheTracker: CacheKeyTrackingService,
    @Inject(REDIS_CLIENT) private readonly redis: AppRedisClient,
  ) {}

  /**
   * 채널 스코프 + 글로벌 스코프 + interceptor 키 (`public_stats`) 일괄 회수.
   * webPath 인자는 더 이상 의미 없음 (channel SET 에 webPath 키도 멤버로 등록됨)
   * — 호환성 위해 시그니처 유지.
   *
   * Best-effort: DB write 가 source of truth. invalidate 실패 시 caller 의 200
   * 응답을 500 으로 바꾸지 않음 — 일시적 cache stale 가 mutation 결과 거짓
   * 보고보다 사용자 영향 작음. 운영 추적은 commit 7/7 의 observability 메트릭
   * (PostHog event + Prometheus counter) 에서 격상 예정.
   */
  async clearChannelSongCaches(
    channelId: number,
    _webPath?: string | null,
  ): Promise<void> {
    try {
      await Promise.all([
        this.cacheTracker.clearChannel(channelId),
        this.cacheTracker.clearGlobal(),
        this.unlinkPublicStats(),
      ]);
    } catch (err) {
      this.logger.warn(
        `clearChannelSongCaches(${channelId}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * 글로벌 search/autocomplete 캐시만 회수. 채널 SET 은 건드리지 않음.
   * 운영 도구 — 글로벌 캐시 오염 시 즉시 회수.
   */
  async clearGlobalSearchCache(): Promise<void> {
    await this.cacheTracker.clearGlobal();
  }

  /**
   * `@CacheKey('public_stats')` 인터셉터가 직접 set 하는 단일 키 — trackAndSet 을
   * 우회하므로 tracker SET 에 등록되지 않음. raw UNLINK 로 직접 처리.
   */
  private async unlinkPublicStats(): Promise<void> {
    try {
      await this.redis.unlink('public_stats');
    } catch (err) {
      this.logger.warn(
        `unlink(public_stats) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * 채널 hard delete 이벤트 핸들러. 채널 row 가 사라진 뒤에도 채널 SET 의 멤버는
   * 그대로 추적되므로 동일 흐름으로 회수 가능.
   */
  @OnEvent(CHANNEL_EVENTS.CHANNEL_DELETED, { async: true })
  async onChannelDeleted(event: ChannelDeletedEvent): Promise<void> {
    try {
      await this.clearChannelSongCaches(event.channelId, event.webPath);
    } catch (err) {
      this.logger.warn(
        `onChannelDeleted(${event.channelId}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Artist hard delete 이벤트 핸들러. Song.artist cascade — 채널 SET 통째 회수.
   */
  @OnEvent(ARTIST_EVENTS.ARTIST_DELETED, { async: true })
  async onArtistDeleted(event: ArtistDeletedEvent): Promise<void> {
    try {
      await this.clearChannelSongCaches(event.channelId);
    } catch (err) {
      this.logger.warn(
        `onArtistDeleted(channelId=${event.channelId}, artistId=${event.artistId}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
