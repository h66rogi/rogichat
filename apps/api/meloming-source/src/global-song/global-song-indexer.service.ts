import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';
import {
  GLOBAL_SONG_EVENTS,
  SongCreatedEvent,
  SongDeletedEvent,
  SongIndexedEvent,
  SongUpdatedEvent,
} from './dto/global-song.events';
import { normalizeArtist } from './normalizer/artist-normalizer';
import { normalizeTitle } from './normalizer/title-normalizer';

/**
 * Event-driven global-song indexer.
 *
 * CRITICAL failure isolation: every handler wraps its body in try/catch.
 * Errors are logged but NEVER propagated. Existing song create/update/
 * delete flows MUST remain 100% unaffected if the indexer fails.
 *
 * All @OnEvent handlers are async. The emitter is NOT awaited in the
 * mutation flow — see SongMutationService changes in Task 9.
 */
@Injectable()
export class GlobalSongIndexerService {
  private readonly logger = new Logger(GlobalSongIndexerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: GlobalSongRedisService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cacheTracker: CacheKeyTrackingService,
  ) {}

  @OnEvent(GLOBAL_SONG_EVENTS.SONG_CREATED, { async: true })
  async handleSongCreated(event: SongCreatedEvent): Promise<void> {
    try {
      if (!this.redis.isReady()) return;
      const result = await this.indexSong(
        event.song.id,
        event.song.title,
        event.artistName,
        event.channelId,
        event.song.albumArt,
        event.categoryNames,
      );
      if (result) {
        this.emitSongIndexed(event.song.id, result);
      }
    } catch (error) {
      this.logger.error(
        `handleSongCreated failed for songId=${event.song.id}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  @OnEvent(GLOBAL_SONG_EVENTS.SONG_UPDATED, { async: true })
  async handleSongUpdated(event: SongUpdatedEvent): Promise<void> {
    try {
      if (!this.redis.isReady()) return;
      // Remove the old indexing if title/artist actually changed
      const titleChanged = event.oldSong.title !== event.newSong.title;
      const artistChanged = event.oldArtistName !== event.newArtistName;
      if (titleChanged || artistChanged) {
        await this.deindexSong(
          event.oldSong.id,
          event.oldSong.title,
          event.oldArtistName,
          event.channelId,
          event.oldCategoryNames,
        );
      }
      const result = await this.indexSong(
        event.newSong.id,
        event.newSong.title,
        event.newArtistName,
        event.channelId,
        event.newSong.albumArt,
        event.newCategoryNames,
      );
      if (result) {
        this.emitSongIndexed(event.newSong.id, result);
      }
    } catch (error) {
      this.logger.error(
        `handleSongUpdated failed for songId=${event.newSong.id}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  @OnEvent(GLOBAL_SONG_EVENTS.SONG_DELETED, { async: true })
  async handleSongDeleted(event: SongDeletedEvent): Promise<void> {
    try {
      if (!this.redis.isReady()) return;
      await this.deindexSong(
        event.songId,
        event.title,
        event.artistName,
        event.channelId,
        event.categoryNames,
      );
    } catch (error) {
      this.logger.error(
        `handleSongDeleted failed for songId=${event.songId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /* -------------------------------------------------------------------- */
  /* Core indexing                                                         */
  /* -------------------------------------------------------------------- */

  /**
   * Index (or re-index) a song in the global-song structures. Idempotent:
   * re-indexing the same (channel, song) pair does NOT inflate channelCount
   * or alias frequency counters. This is essential because:
   *
   *   1. Bootstrap rebuild may be run multiple times against the same DB
   *   2. Event listener retries on transient failures
   *   3. Two pods may race on the same song creation
   *
   * Idempotency contract: given the same (songId, rawTitle, rawArtistName,
   * channelId) tuple, calling this method N times has the same effect as
   * calling it once.
   *
   * Exposed as a public method so the bootstrap rebuild service can reuse it.
   */
  async indexSong(
    songId: number,
    rawTitle: string,
    rawArtistName: string,
    channelId: number,
    albumArt: string | null,
    categoryNames: string[],
  ): Promise<{ globalSongId: number; isNewChannelMapping: boolean } | null> {
    // 1. Normalize inputs
    let normArtist;
    try {
      normArtist = normalizeArtist(rawArtistName);
    } catch {
      return null; // Bad input (empty artist name etc) — skip silently
    }
    let normTitleRes;
    try {
      normTitleRes = normalizeTitle(rawTitle);
    } catch {
      return null;
    }

    // 2. Resolve GlobalArtist — check Redis aliases first, then fall back to normKey.
    //    This ensures that different name formats for the same artist (e.g. "아이유"
    //    vs "아이유(IU)") converge to the same GlobalArtist, because they share at
    //    least one alias (e.g. "아이유").
    let globalArtist: Awaited<
      ReturnType<typeof this.prisma.globalArtist.findUnique>
    > | null = null;

    for (const alias of normArtist.aliases) {
      const existingIds = await this.redis.lookupArtistAlias(alias);
      if (existingIds.length === 0) continue;

      if (existingIds.length === 1) {
        globalArtist = await this.prisma.globalArtist.findUnique({
          where: { id: existingIds[0] },
        });
      } else {
        // Multiple GlobalArtists share this alias — pick the one used by
        // the most channels (proxy for "canonical" artist).
        const candidates = await this.prisma.globalArtist.findMany({
          where: { id: { in: existingIds } },
          orderBy: { songs: { _count: 'desc' } },
          take: 1,
        });
        globalArtist = candidates[0] ?? null;
      }
      if (globalArtist) break;
    }

    // Fall back to normKey upsert if no alias matched (creates new or finds exact)
    if (!globalArtist) {
      globalArtist = await this.prisma.globalArtist.upsert({
        where: { normKey: normArtist.normKey },
        create: {
          canonicalName: normArtist.canonicalName,
          normKey: normArtist.normKey,
        },
        update: {},
      });
    }

    // 3. Upsert GlobalSong WITHOUT touching channelCount — we'll adjust it
    //    conditionally below based on whether this channel mapping is new.
    const globalSong = await this.prisma.globalSong.upsert({
      where: {
        normTitle_globalArtistId: {
          normTitle: normTitleRes.normTitle,
          globalArtistId: globalArtist.id,
        },
      },
      create: {
        title: normTitleRes.displayTitle,
        normTitle: normTitleRes.normTitle,
        globalArtistId: globalArtist.id,
        albumArt,
        channelCount: 0, // bumped to 1 below when we write the channel mapping
      },
      update: {
        albumArt: albumArt ?? undefined,
      },
    });

    // 4. Check if this (globalSong, channel) pair was already mapped.
    //    Only increment channelCount + alias frequencies if NEW.
    const existingMapping = await this.redis.getChannelSongMapping(
      globalSong.id,
      channelId,
    );
    const isNewChannelMapping = existingMapping === null;
    // song 테이블의 unique([channelId, globalSongId]) 제약상 한 채널이 같은
    // GlobalSong 에 매핑할 수 있는 Song 은 1개뿐. 이미 다른 songId 가 이
    // (globalSong, channel) 을 차지했다면 이 songId 로 덮어쓰면 안 된다.
    const hasConflictingMapping =
      existingMapping !== null && existingMapping !== songId;

    if (isNewChannelMapping) {
      // Bump the DB counter
      const bumped = await this.prisma.globalSong.update({
        where: { id: globalSong.id },
        data: { channelCount: { increment: 1 } },
        select: { channelCount: true },
      });
      globalSong.channelCount = bumped.channelCount;

      // Increment alias frequencies (same-channel only once)
      for (const alias of normArtist.aliases) {
        await this.prisma.globalArtistAlias.upsert({
          where: {
            globalArtistId_normAlias: {
              globalArtistId: globalArtist.id,
              normAlias: alias,
            },
          },
          create: {
            globalArtistId: globalArtist.id,
            alias,
            normAlias: alias,
            frequency: 1,
          },
          update: { frequency: { increment: 1 } },
        });
      }
    }

    // 5. Artist aliases in Redis (Set — idempotent by definition, sAdd is a no-op on duplicates)
    for (const alias of normArtist.aliases) {
      await this.redis.addArtistAlias(alias, globalArtist.id);
    }

    // 6. Title aliases — upsert (no counter) then register in Redis Set
    for (const aliasTitle of normTitleRes.aliases) {
      await this.prisma.globalSongAlias.upsert({
        where: {
          globalSongId_normAliasTitle: {
            globalSongId: globalSong.id,
            normAliasTitle: aliasTitle,
          },
        },
        create: {
          globalSongId: globalSong.id,
          aliasTitle,
          normAliasTitle: aliasTitle,
        },
        update: {},
      });
      await this.redis.addTitleAlias(aliasTitle, globalSong.id);
    }

    // 7. Redis string + hash + set updates (all idempotent by nature)
    await this.redis.setSongLookup(
      normTitleRes.normTitle,
      globalArtist.id,
      globalSong.id,
    );
    // 충돌 매핑(다른 song 이 이미 차지)이면 Redis 를 덮어쓰지 않는다 — 덮어쓰면
    // dual-write 는 unique 제약(P2002)으로 실패하는데 Redis 만 새 songId 를 가리켜
    // Redis/DB 가 갈라진다. 엑셀 일괄 등록에서 표기 변형 중복곡(예: "아이유 좋은날"
    // vs "IU 좋은날")이 같은 배치에 들어올 때 현실적으로 발생. 기존 매핑을 유지하고
    // 이 song 은 unmapped 로 남긴다(같은 채널·같은 곡은 1개만 매핑 가능한 도메인 제약).
    if (!hasConflictingMapping) {
      await this.redis.setChannelSongMapping(globalSong.id, channelId, songId);
    }
    await this.redis.addToChannelSongSet(channelId, globalSong.id);

    // 7b. Dual-write: persist globalSongId FK on the Song row.
    //     P2025 (record not found — 동시 song delete) 는 expected — best-effort,
    //     백필이 잡음. 다른 error (connection / 제약 위반) 는 logger.error 로 격상
    //     운영 추적. event 흐름 보호 위해 throw 안 함 (listener 흐름 유지).
    let dualWriteSucceeded = false;
    if (hasConflictingMapping) {
      // unique([channelId, globalSongId]) 위반이 확정이라 dual-write 자체를 skip.
      this.logger.warn(
        `channel ${channelId} already maps globalSong ${globalSong.id} to song ${existingMapping}; ` +
          `skipping dual-write for song ${songId} (unique_songs_channel_globalsong guard)`,
      );
    } else {
      try {
        await this.prisma.song.update({
          where: { id: songId },
          data: { globalSongId: globalSong.id },
        });
        dualWriteSucceeded = true;
      } catch (error) {
        const isP2025 =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025';
        const detail = error instanceof Error ? error.message : String(error);
        if (isP2025) {
          this.logger.warn(
            `dual-write skipped (song ${songId} disappeared, P2025): ${detail}`,
          );
        } else {
          // 비-P2025 = 진짜 운영 이슈. event listener 흐름 막지 않기 위해 throw 안 함.
          this.logger.error(
            `dual-write failed (non-P2025) gs:${globalSong.id} → song:${songId}: ${detail}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    }

    // dual-write 가 song.globalSongId 를 변경했으면 song list 응답의 globalSongId
    // 가 stale 가능 — 채널 SET 회수. dual-write 실패 시 row 변화 없으므로 skip.
    // SongMutationService 의 invalidate 가 이 시점 이전에 이미 호출됐지만,
    // 그 invalidate 는 globalSongId 가 아직 NULL 인 응답을 캐시했을 수 있음 — 다시 회수.
    if (dualWriteSucceeded) {
      await this.cacheTracker.clearChannelSafe(channelId, 'indexer:dual-write');
    }

    // 8. Prefix index — zAdd with score = current channelCount; safe to overwrite
    const prefix = normTitleRes.normTitle.slice(0, 2);
    if (prefix.length > 0) {
      await this.redis.addToPrefixIndex(
        prefix,
        globalSong.id,
        globalSong.channelCount,
      );
    }

    // 9. Category frequency — only when this is a NEW channel mapping. Category
    //    names come from the caller (indexSong does not query song_categories)
    //    so the delete path can still pass the captured names after the row
    //    is gone.
    if (isNewChannelMapping && categoryNames.length > 0) {
      for (const name of categoryNames) {
        await this.redis.incrementCategoryFrequency(globalSong.id, name, 1);
      }
    }

    return { globalSongId: globalSong.id, isNewChannelMapping };
  }

  /**
   * Emit SONG_INDEXED for downstream consumers (e.g. Musixmatch matcher).
   * Only fires from real-time event handlers — rebuild/bootstrap calls
   * indexSong() directly and bypasses this emit by design.
   */
  private emitSongIndexed(
    songId: number,
    result: { globalSongId: number; isNewChannelMapping: boolean },
  ): void {
    const payload: SongIndexedEvent = {
      songId,
      globalSongId: result.globalSongId,
      isNewChannelMapping: result.isNewChannelMapping,
    };
    // Fire-and-forget. Listeners must isolate failures themselves.
    this.eventEmitter.emit(GLOBAL_SONG_EVENTS.SONG_INDEXED, payload);
  }

  /**
   * Remove a song from the global-song structures. Decrements counters and
   * cleans up per-channel state.
   *
   * IMPORTANT: `categoryNames` MUST be captured BEFORE the underlying song
   * row is deleted. song_categories cascade-delete with the song row, so
   * the indexer cannot look them up after the fact. The SongMutationService
   * snapshots them before calling prisma.song.delete() and passes them via
   * the SONG_DELETED event.
   *
   * Idempotent: deindexing a (channel, song) pair that is no longer mapped
   * is a no-op. This matches the indexSong contract so retries are safe.
   */
  async deindexSong(
    songId: number,
    rawTitle: string,
    rawArtistName: string,
    channelId: number,
    categoryNames: string[],
  ): Promise<void> {
    let normArtist;
    try {
      normArtist = normalizeArtist(rawArtistName);
    } catch {
      return;
    }
    let normTitleRes;
    try {
      normTitleRes = normalizeTitle(rawTitle);
    } catch {
      return;
    }

    // Find the global artist (match any alias, not just the first)
    const candidateArtists: number[] = [];
    for (const alias of normArtist.aliases) {
      const ids = await this.redis.lookupArtistAlias(alias);
      for (const id of ids) {
        if (!candidateArtists.includes(id)) candidateArtists.push(id);
      }
    }
    if (candidateArtists.length === 0) return;

    for (const globalArtistId of candidateArtists) {
      const globalSongId = await this.redis.lookupSong(
        normTitleRes.normTitle,
        globalArtistId,
      );
      if (globalSongId === null) continue;

      // Verify the mapping belongs to the song being deleted, not a
      // newer replacement. Late delete events must not remove a re-added
      // song's mapping.
      const existingMapping = await this.redis.getChannelSongMapping(
        globalSongId,
        channelId,
      );
      if (existingMapping === null) continue;
      if (existingMapping !== songId) continue;

      // Remove per-channel mapping
      await this.redis.removeChannelSongMapping(globalSongId, channelId);
      await this.redis.removeFromChannelSongSet(channelId, globalSongId);

      // Decrement channel count on DB row
      const updated = await this.prisma.globalSong
        .update({
          where: { id: globalSongId },
          data: { channelCount: { decrement: 1 } },
        })
        .catch(() => null);

      // Prefix index score reflects channelCount (the popularity proxy used
      // for ranking search candidates). Always sync it to the new count so
      // a 5 → 4 decrement doesn't leave the zset score stuck at 5 — that
      // would drift fuzzy-match candidate ordering. When the count drops to
      // zero, drop the entry from the index entirely (DB row kept for
      // history per indexSong contract).
      const prefix = normTitleRes.normTitle.slice(0, 2);
      if (prefix.length > 0 && updated) {
        if (updated.channelCount <= 0) {
          await this.redis.removeFromPrefixIndex(prefix, globalSongId);
        } else {
          await this.redis.addToPrefixIndex(
            prefix,
            globalSongId,
            updated.channelCount,
          );
        }
      }

      // Decrement category frequencies using the caller-provided names
      for (const name of categoryNames) {
        await this.redis.incrementCategoryFrequency(globalSongId, name, -1);
      }
    }
  }
}
