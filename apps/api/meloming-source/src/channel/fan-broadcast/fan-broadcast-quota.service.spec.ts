import type Redis from 'ioredis';
import {
  FAN_BROADCAST_DAILY_QUOTA_FREE,
  FAN_BROADCAST_DAILY_QUOTA_PRO,
  FanBroadcastQuotaService,
} from './fan-broadcast-quota.service';

describe('FanBroadcastQuotaService', () => {
  let service: FanBroadcastQuotaService;
  let redis: jest.Mocked<Pick<Redis, 'incr' | 'expire' | 'decr' | 'get'>>;

  beforeEach(() => {
    redis = {
      incr: jest.fn(),
      expire: jest.fn(),
      decr: jest.fn(),
      get: jest.fn(),
    };
    service = new FanBroadcastQuotaService(redis as unknown as Redis);
  });

  describe('getLimit', () => {
    it('returns free-tier quota for non-PRO users', () => {
      expect(service.getLimit(false)).toBe(FAN_BROADCAST_DAILY_QUOTA_FREE);
    });

    it('returns PRO-tier quota for PRO users', () => {
      expect(service.getLimit(true)).toBe(FAN_BROADCAST_DAILY_QUOTA_PRO);
    });
  });

  describe('incrementAndGetCount', () => {
    it('sets TTL only on first increment', async () => {
      redis.incr.mockResolvedValueOnce(1 as never);
      redis.expire.mockResolvedValueOnce(1 as never);

      const count = await service.incrementAndGetCount(42);

      expect(count).toBe(1);
      expect(redis.incr).toHaveBeenCalledTimes(1);
      expect(redis.expire).toHaveBeenCalledTimes(1);
      const [key, ttl] = redis.expire.mock.calls[0];
      expect(String(key)).toMatch(/^streamer-fan-broadcast:daily:42:\d{8}$/);
      expect(ttl).toBeGreaterThan(24 * 3600);
    });

    it('does not reset TTL on subsequent increments', async () => {
      redis.incr.mockResolvedValueOnce(3 as never);

      const count = await service.incrementAndGetCount(42);

      expect(count).toBe(3);
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('includes KST date in the key', async () => {
      redis.incr.mockResolvedValueOnce(1 as never);
      redis.expire.mockResolvedValueOnce(1 as never);
      // 2026-04-23 UTC 18:00 = 2026-04-24 KST 03:00
      const utcNight = new Date(Date.UTC(2026, 3, 23, 18, 0, 0));

      await service.incrementAndGetCount(100, utcNight);

      const [key] = redis.incr.mock.calls[0];
      expect(key).toBe('streamer-fan-broadcast:daily:100:20260424');
    });
  });

  describe('rollback', () => {
    it('decrements on rollback', async () => {
      redis.decr.mockResolvedValueOnce(0 as never);

      await service.rollback(7);

      expect(redis.decr).toHaveBeenCalledTimes(1);
      const [key] = redis.decr.mock.calls[0];
      expect(String(key)).toMatch(/^streamer-fan-broadcast:daily:7:\d{8}$/);
    });

    it('swallows redis errors so callers can always rollback safely', async () => {
      redis.decr.mockRejectedValueOnce(new Error('redis down'));
      await expect(service.rollback(9)).resolves.toBeUndefined();
    });
  });

  describe('getUsed', () => {
    it('returns 0 when key missing', async () => {
      redis.get.mockResolvedValueOnce(null as never);
      await expect(service.getUsed(1)).resolves.toBe(0);
    });

    it('returns stored count as number', async () => {
      redis.get.mockResolvedValueOnce('4' as never);
      await expect(service.getUsed(1)).resolves.toBe(4);
    });

    it('returns 0 for non-numeric values', async () => {
      redis.get.mockResolvedValueOnce('garbage' as never);
      await expect(service.getUsed(1)).resolves.toBe(0);
    });
  });

  describe('getResetAt', () => {
    it('returns next KST midnight in UTC', () => {
      // 2026-04-23 10:00 UTC = 2026-04-23 19:00 KST → reset at 2026-04-24 00:00 KST = 2026-04-23 15:00 UTC
      const now = new Date(Date.UTC(2026, 3, 23, 10, 0, 0));
      const reset = service.getResetAt(now);
      expect(reset.toISOString()).toBe('2026-04-23T15:00:00.000Z');
    });

    it('advances to the following day even close to KST midnight', () => {
      // 2026-04-23 14:59 UTC = 2026-04-23 23:59 KST → reset at 2026-04-24 00:00 KST = 2026-04-23 15:00 UTC
      const now = new Date(Date.UTC(2026, 3, 23, 14, 59, 59));
      const reset = service.getResetAt(now);
      expect(reset.toISOString()).toBe('2026-04-23T15:00:00.000Z');
    });

    it('rolls to the day-after when called after KST midnight', () => {
      // 2026-04-23 15:01 UTC = 2026-04-24 00:01 KST → reset at 2026-04-25 00:00 KST = 2026-04-24 15:00 UTC
      const now = new Date(Date.UTC(2026, 3, 23, 15, 1, 0));
      const reset = service.getResetAt(now);
      expect(reset.toISOString()).toBe('2026-04-24T15:00:00.000Z');
    });
  });
});
