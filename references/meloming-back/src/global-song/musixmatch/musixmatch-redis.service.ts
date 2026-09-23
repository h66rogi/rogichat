import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';
import { EnvironmentVariables } from '../../config/env.config';

/**
 * Hot cache + circuit breaker state + per-globalsong locks for Musixmatch.
 *
 * Owns its own node-redis v5 connection (separate namespace from
 * `GlobalSongRedisService`) so a Redis outage isolated to one service
 * cannot accidentally bring down the other.
 *
 * Key families (spec Section 7):
 *
 *   mxm:lyrics:{globalSongId}            STRING (JSON)   TTL 24h
 *   mxm:track:{globalSongId}             STRING (JSON)   TTL 1d
 *   mxm:negative:{globalSongId}          STRING ('1')    TTL 30d   UNMATCHED hint
 *   mxm:lock:{globalSongId}              STRING (token)  TTL 30s   per-song matching lock
 *   mxm:ctlock:{commontrackId}           STRING (token)  TTL 30s   per-commontrack dedup lock
 *   mxm:breaker:opened-until             STRING (iso)    TTL 30m   circuit breaker
 *   mxm:breaker:consecutive-errors       STRING (int)    TTL 30m
 *
 * If Redis is down, every method becomes a no-op (or returns null/false) so
 * the matching flow degrades gracefully rather than blocking.
 */
@Injectable()
export class MusixmatchRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MusixmatchRedisService.name);
  private client?: RedisClientType;
  private _ready = false;
  private readonly redisUrl: string;

  static readonly LYRICS_TTL_SEC = 60 * 60 * 24; // 24h
  static readonly TRACK_TTL_SEC = 60 * 60 * 24;
  static readonly NEGATIVE_TTL_SEC = 60 * 60 * 24 * 30; // 30d
  static readonly LOCK_TTL_SEC = 30;
  static readonly BREAKER_TTL_SEC = 60 * 30; // 30m

  constructor(configService: ConfigService<EnvironmentVariables>) {
    const host = configService.get('REDIS_HOST');
    const port = configService.get('REDIS_PORT');
    const password = configService.get('REDIS_PASSWORD');
    this.redisUrl = password
      ? `redis://:${encodeURIComponent(password)}@${host}:${port}`
      : `redis://${host}:${port}`;
  }

  async onModuleInit(): Promise<void> {
    try {
      this.client = createClient({ url: this.redisUrl });
      this.client.on('error', (error) => {
        this._ready = false;
        this.logger.error(
          `Musixmatch Redis error: ${error instanceof Error ? error.message : error}`,
        );
      });
      this.client.on('ready', () => {
        this._ready = true;
      });
      await this.client.connect();
    } catch (error) {
      this._ready = false;
      this.logger.error(
        `Musixmatch Redis connect failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client?.quit();
    } catch {
      /* ignore */
    }
  }

  isReady(): boolean {
    return this._ready;
  }

  // ---------------- locks ----------------

  /**
   * Acquire a transient lock. Returns the token on success, null on
   * contention. Use {@link releaseLock} with the same token to release.
   */
  async acquireLock(
    key: string,
    ttlSec = MusixmatchRedisService.LOCK_TTL_SEC,
  ): Promise<string | null> {
    if (!this._ready || !this.client) return null;
    const token = `${process.pid}-${Date.now()}-${Math.random()}`;
    const ok = await this.client.set(key, token, {
      NX: true,
      EX: ttlSec,
    });
    return ok === 'OK' ? token : null;
  }

  /**
   * Release a lock only if we still hold it. Compare-and-delete: GET then
   * DEL only when token matches. Race window between GET and DEL is narrow
   * (sub-millisecond) and would only matter if our lock expired AND another
   * holder's lock was acquired in that window — extremely unlikely with a
   * 30s TTL and typical 1-3s matching work. Lock will expire on TTL anyway,
   * so worst case is brief over-hold (no correctness loss).
   */
  async releaseLock(key: string, token: string): Promise<void> {
    if (!this._ready || !this.client) return;
    try {
      const current = (await this.client.get(key)) as string | null;
      if (current === token) {
        await this.client.del(key);
      }
    } catch (error) {
      // Best-effort: lock expires on TTL regardless.
      this.logger.warn(
        `releaseLock failed for ${key}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  songLockKey(globalSongId: number): string {
    return `mxm:lock:${globalSongId}`;
  }

  commontrackLockKey(commontrackId: number): string {
    return `mxm:ctlock:${commontrackId}`;
  }

  // ---------------- caches ----------------

  async getLyricsCache<T>(globalSongId: number): Promise<T | null> {
    if (!this._ready || !this.client) return null;
    const raw = (await this.client.get(`mxm:lyrics:${globalSongId}`)) as
      | string
      | null;
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setLyricsCache<T>(globalSongId: number, value: T): Promise<void> {
    if (!this._ready || !this.client) return;
    await this.client.set(`mxm:lyrics:${globalSongId}`, JSON.stringify(value), {
      EX: MusixmatchRedisService.LYRICS_TTL_SEC,
    });
  }

  async invalidateLyrics(globalSongId: number): Promise<void> {
    if (!this._ready || !this.client) return;
    await this.client.del(`mxm:lyrics:${globalSongId}`);
  }

  async setNegative(globalSongId: number): Promise<void> {
    if (!this._ready || !this.client) return;
    await this.client.set(`mxm:negative:${globalSongId}`, '1', {
      EX: MusixmatchRedisService.NEGATIVE_TTL_SEC,
    });
  }

  async clearNegative(globalSongId: number): Promise<void> {
    if (!this._ready || !this.client) return;
    await this.client.del(`mxm:negative:${globalSongId}`);
  }

  async hasNegative(globalSongId: number): Promise<boolean> {
    if (!this._ready || !this.client) return false;
    return (await this.client.exists(`mxm:negative:${globalSongId}`)) > 0;
  }

  // ---------------- circuit breaker ----------------

  async getBreakerOpenedUntil(): Promise<Date | null> {
    if (!this._ready || !this.client) return null;
    const raw = (await this.client.get('mxm:breaker:opened-until')) as
      | string
      | null;
    if (!raw) return null;
    const dt = new Date(raw);
    return isNaN(dt.getTime()) ? null : dt;
  }

  async openBreaker(durationSec: number): Promise<void> {
    if (!this._ready || !this.client) return;
    const until = new Date(Date.now() + durationSec * 1000).toISOString();
    await this.client.set('mxm:breaker:opened-until', until, {
      EX: durationSec,
    });
  }

  async resetBreakerCounter(): Promise<void> {
    if (!this._ready || !this.client) return;
    await this.client.del('mxm:breaker:consecutive-errors');
  }

  async incrementBreakerCounter(): Promise<number> {
    if (!this._ready || !this.client) return 0;
    const next = await this.client.incr('mxm:breaker:consecutive-errors');
    // Fresh key gets a TTL so the counter doesn't live forever.
    if (next === 1) {
      await this.client.expire(
        'mxm:breaker:consecutive-errors',
        MusixmatchRedisService.BREAKER_TTL_SEC,
      );
    }
    return Number(next);
  }
}
