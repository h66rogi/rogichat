import { Test } from '@nestjs/testing';
import { SongCacheService } from '../song-cache.service';
import { CacheKeyTrackingService } from '../../redis/cache-key-tracking.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { CHANNEL_EVENTS } from '../../channel/channel-events';
import { ARTIST_EVENTS } from '../../artist/artist-events';

/**
 * Layer 1 — explicit key tracking 기반 SongCacheService 회귀 테스트.
 *
 * 검증
 * - clearChannelSongCaches: tracker.clearChannel + tracker.clearGlobal + redis.unlink('public_stats')
 * - clearGlobalSearchCache: tracker.clearGlobal 만
 * - OnEvent 핸들러: 실패 시 swallow + warn (이벤트 흐름 막지 않음)
 */
async function buildService(opts: {
  tracker?: Partial<CacheKeyTrackingService>;
  unlink?: jest.Mock;
}): Promise<{
  service: SongCacheService;
  tracker: jest.Mocked<CacheKeyTrackingService>;
  unlink: jest.Mock;
}> {
  const tracker = {
    clearChannel: jest.fn().mockResolvedValue(0),
    clearGlobal: jest.fn().mockResolvedValue(0),
    clearChannelsBatch: jest.fn().mockResolvedValue(0),
    trackAndSet: jest.fn(),
    get: jest.fn(),
    ...opts.tracker,
  };
  const unlink = opts.unlink ?? jest.fn().mockResolvedValue(1);
  const redisClient = { unlink };

  const moduleRef = await Test.createTestingModule({
    providers: [
      SongCacheService,
      { provide: CacheKeyTrackingService, useValue: tracker },
      { provide: REDIS_CLIENT, useValue: redisClient },
    ],
  }).compile();

  return {
    service: moduleRef.get(SongCacheService),
    tracker: tracker as unknown as jest.Mocked<CacheKeyTrackingService>,
    unlink,
  };
}

describe('SongCacheService', () => {
  describe('clearChannelSongCaches', () => {
    it('invokes tracker.clearChannel + tracker.clearGlobal + redis.unlink("public_stats") in parallel', async () => {
      const { service, tracker, unlink } = await buildService({});

      await service.clearChannelSongCaches(42);

      expect(tracker.clearChannel).toHaveBeenCalledWith(42);
      expect(tracker.clearGlobal).toHaveBeenCalledTimes(1);
      expect(unlink).toHaveBeenCalledWith('public_stats');
    });

    it('ignores webPath argument (channel SET registered with channelId, not webPath)', async () => {
      const { service, tracker } = await buildService({});

      await service.clearChannelSongCaches(7, 'somepath');

      expect(tracker.clearChannel).toHaveBeenCalledWith(7);
      expect(tracker.clearGlobal).toHaveBeenCalledTimes(1);
    });

    it('does not throw when public_stats unlink fails (logs warn, channel/global still cleared)', async () => {
      const unlink = jest.fn().mockRejectedValue(new Error('connection lost'));
      const { service, tracker } = await buildService({ unlink });

      // Promise.all 가 모두 끝까지 진행되도록 Promise.allSettled 수준이 아니라
      // 한쪽 fail 이 나머지를 abort 하지 않는지 검증 — 현재 구현은 Promise.all 이라
      // unlink 가 throw 하면 전체가 reject. 그러나 unlinkPublicStats 내부에서
      // try/catch + warn 으로 swallow — 외부에는 reject 안 됨.
      await expect(service.clearChannelSongCaches(1)).resolves.toBeUndefined();

      expect(tracker.clearChannel).toHaveBeenCalledWith(1);
      expect(tracker.clearGlobal).toHaveBeenCalledTimes(1);
      expect(unlink).toHaveBeenCalledWith('public_stats');
    });

    it('best-effort: tracker.clearChannel reject 도 caller 에 throw 하지 않음 (DB write 200 보호)', async () => {
      const { service } = await buildService({
        tracker: {
          clearChannel: jest.fn().mockRejectedValue(new Error('boom')),
        },
      });

      // mutation 호출 흐름에서 invalidate 실패가 caller 의 200 을 500 으로
      // 변경하지 않도록 swallow + warn. 운영 추적은 7/7 메트릭 격상.
      await expect(service.clearChannelSongCaches(1)).resolves.toBeUndefined();
    });

    it('best-effort: tracker.clearGlobal reject 도 caller 에 throw 하지 않음', async () => {
      const { service } = await buildService({
        tracker: {
          clearGlobal: jest.fn().mockRejectedValue(new Error('global-boom')),
        },
      });

      await expect(service.clearChannelSongCaches(1)).resolves.toBeUndefined();
    });

    it('best-effort: 두 tracker 호출 모두 reject 해도 caller 에 throw 하지 않음', async () => {
      const { service, tracker } = await buildService({
        tracker: {
          clearChannel: jest.fn().mockRejectedValue(new Error('ch-fail')),
          clearGlobal: jest.fn().mockRejectedValue(new Error('gl-fail')),
        },
      });

      await expect(service.clearChannelSongCaches(1)).resolves.toBeUndefined();
      // 두 호출 모두 시작은 됐어야 함 — Promise.all 은 동시 실행
      expect(tracker.clearChannel).toHaveBeenCalled();
      expect(tracker.clearGlobal).toHaveBeenCalled();
    });
  });

  describe('clearGlobalSearchCache', () => {
    it('invokes only tracker.clearGlobal', async () => {
      const { service, tracker } = await buildService({});

      await service.clearGlobalSearchCache();

      expect(tracker.clearGlobal).toHaveBeenCalledTimes(1);
      expect(tracker.clearChannel).not.toHaveBeenCalled();
    });
  });

  describe('OnEvent handlers — swallow + warn', () => {
    it('CHANNEL_DELETED handler clears caches and swallows downstream errors', async () => {
      const { service, tracker } = await buildService({
        tracker: {
          clearChannel: jest.fn().mockRejectedValue(new Error('boom')),
        },
      });

      // 핸들러 자체는 throw 하지 않아야 — emitter 흐름 보호.
      await expect(
        service.onChannelDeleted({
          channelId: 99,
          webPath: 'wp',
        } as any),
      ).resolves.toBeUndefined();
      expect(tracker.clearChannel).toHaveBeenCalledWith(99);
    });

    it('ARTIST_DELETED handler clears caches and swallows downstream errors', async () => {
      const { service, tracker } = await buildService({
        tracker: {
          clearChannel: jest.fn().mockRejectedValue(new Error('boom')),
        },
      });

      await expect(
        service.onArtistDeleted({ channelId: 7, artistId: 11 } as any),
      ).resolves.toBeUndefined();
      expect(tracker.clearChannel).toHaveBeenCalledWith(7);
    });
  });

  describe('event constants — sanity', () => {
    it('CHANNEL_DELETED + ARTIST_DELETED constants are defined (catch typo regressions)', () => {
      expect(CHANNEL_EVENTS.CHANNEL_DELETED).toBeDefined();
      expect(ARTIST_EVENTS.ARTIST_DELETED).toBeDefined();
    });
  });
});
