import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const FAN_BROADCAST_REDIS_CLIENT = Symbol('FAN_BROADCAST_REDIS_CLIENT');

export const FAN_BROADCAST_DAILY_QUOTA_FREE = 1;
export const FAN_BROADCAST_DAILY_QUOTA_PRO = 5;

const KST_TZ = 'Asia/Seoul';
const REDIS_KEY_PREFIX = 'streamer-fan-broadcast:daily';
// KST 자정 롤오버 시 keys overlap을 안전하게 커버 (UTC offset + safety margin)
const KEY_TTL_SECONDS = 36 * 3600;

/**
 * 스트리머 팬 알림 발송 쿼터 관리.
 *
 * 키: `streamer-fan-broadcast:daily:{userId}:{yyyyMMdd in KST}`
 * atomic `INCR` + 첫 증가 시 `EXPIRE` 로 race-free 카운트.
 * 쿼터 초과로 거부된 경우 호출자는 `rollback()` 으로 카운트 복구.
 */
@Injectable()
export class FanBroadcastQuotaService {
  private readonly logger = new Logger(FanBroadcastQuotaService.name);

  constructor(
    @Inject(FAN_BROADCAST_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  getLimit(isPro: boolean): number {
    return isPro
      ? FAN_BROADCAST_DAILY_QUOTA_PRO
      : FAN_BROADCAST_DAILY_QUOTA_FREE;
  }

  private buildKey(userId: number, now: Date): string {
    const dateKey = formatInTimeZone(now, KST_TZ, 'yyyyMMdd');
    return `${REDIS_KEY_PREFIX}:${userId}:${dateKey}`;
  }

  async incrementAndGetCount(
    userId: number,
    now: Date = new Date(),
  ): Promise<number> {
    const key = this.buildKey(userId, now);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, KEY_TTL_SECONDS);
    }
    return count;
  }

  async rollback(userId: number, now: Date = new Date()): Promise<void> {
    const key = this.buildKey(userId, now);
    try {
      await this.redis.decr(key);
    } catch (err) {
      this.logger.warn(
        `Fan broadcast quota rollback failed for userId=${userId}: ${(err as Error).message}`,
      );
    }
  }

  async getUsed(userId: number, now: Date = new Date()): Promise<number> {
    const key = this.buildKey(userId, now);
    const value = await this.redis.get(key);
    if (value === null) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  /** KST 기준 다음 자정 (UTC Date). */
  getResetAt(now: Date = new Date()): Date {
    const todayKst = formatInTimeZone(now, KST_TZ, 'yyyy-MM-dd');
    const todayStartUtc = fromZonedTime(`${todayKst} 00:00:00`, KST_TZ);
    return new Date(todayStartUtc.getTime() + 24 * 60 * 60 * 1000);
  }
}
