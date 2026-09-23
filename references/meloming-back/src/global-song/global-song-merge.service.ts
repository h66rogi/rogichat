import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GlobalSongMatcherStatus,
  MatcherConfidence,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { MusixmatchRedisService } from './musixmatch/musixmatch-redis.service';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';

export interface MergeInput {
  winnerId: number;
  loserIds: number[];
  reason: string;
  dryRun?: boolean;
}

export interface MergeReport {
  winnerId: number;
  loserIds: number[];
  dryRun: boolean;
  aliasesMoved: number;
  aliasesDropped: number;
  songsReassigned: number;
  conflictSongsAutoMerged: number;
  chainsFlattened: number;
  winnerChannelCountBefore: number;
  winnerChannelCountAfter: number;
  losersDeleted: number;
  redisSyncOk: boolean;
}

export interface LocalSongAbsorbInput {
  keepSongId: number;
  dropSongId: number;
  reason?: string;
}

export interface LocalSongAbsorbReport {
  keepSongId: number;
  dropSongId: number;
  channelId: number;
  keepGlobalSongId: number | null;
  dropGlobalSongIdBefore: number | null;
  categoriesMoved: number;
  deletedSong: boolean;
}

/**
 * 중복 GlobalSong row 병합 서비스.
 *
 * overlap=0 으로 검증된 safe 컴포넌트를 winner 하나로 모은다. DB 트랜잭션과
 * Redis 이관으로 나뉘며, `global_song_merges` 리다이렉트 테이블에 기록을 남긴다.
 */
@Injectable()
export class GlobalSongMergeService {
  private readonly logger = new Logger(GlobalSongMergeService.name);

  // Rebuild/merge 상호 배제. rebuild 는 global-song:bootstrap-lock 을 사용하므로
  // merge 는 두 락을 모두 획득해야 rebuild 와 충돌하지 않는다. 순서는 항상 동일
  // (bootstrap → merge) 로 유지해 데드락을 막는다.
  private static readonly BOOTSTRAP_LOCK = 'global-song:bootstrap-lock';
  private static readonly MERGE_LOCK = 'global-song:merge-lock';
  private static readonly LOCK_TTL_MS = 10 * 60 * 1000;
  private static readonly TRANSACTION_TIMEOUT_MS = 120_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
    private readonly redis: GlobalSongRedisService,
    private readonly mxmRedis: MusixmatchRedisService,
    private readonly cacheTracker: CacheKeyTrackingService,
  ) {}

  /**
   * Resolve a possibly-merged globalSongId to its canonical winner.
   *
   * Hot path: Redis `gs:merged:{id}` (30-day TTL, set at merge time).
   * Cold path: DB `global_song_merges.loser_id = id`.
   * If neither exists the id is returned as-is with `mergedFrom = null`.
   *
   * Used by every public GET endpoint that accepts a client-supplied
   * globalSongId (detail, clips, quick-add etc.) so stale ids transparently
   * reroute to the winner row without clients breaking.
   */
  async resolveMerged(
    id: number,
  ): Promise<{ canonicalId: number; mergedFrom: number | null }> {
    if (this.redis.isReady()) {
      try {
        const cached = await this.redis.getMergeRedirect(id);
        if (cached && cached !== id) {
          return { canonicalId: cached, mergedFrom: id };
        }
      } catch (error) {
        this.logger.warn(
          `getMergeRedirect failed, falling back to DB: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }
    const row = await this.prisma.globalSongMerge.findUnique({
      where: { loserId: id },
      select: { winnerId: true },
    });
    if (!row) return { canonicalId: id, mergedFrom: null };
    return { canonicalId: row.winnerId, mergedFrom: id };
  }

  async merge(input: MergeInput): Promise<MergeReport> {
    this.validateInput(input);
    const { winnerId, loserIds, reason, dryRun = false } = input;

    if (dryRun) {
      return this.computeDryRun(winnerId, loserIds);
    }

    return this.executeMerge(winnerId, loserIds, reason);
  }

  /**
   * Merge variant for callers that **already hold** both BOOTSTRAP_LOCK and
   * MERGE_LOCK. Skips the locking layer to avoid self-deadlock when invoked
   * from inside another locked merge flow (e.g. GlobalArtistMergeService's
   * inline conflict resolution before flipping song FKs).
   *
   * Do NOT expose via any controller or call from un-locked code paths.
   */
  async mergeUnlocked(input: MergeInput): Promise<MergeReport> {
    this.validateInput(input);
    const { winnerId, loserIds, reason, dryRun = false } = input;

    if (dryRun) {
      return this.computeDryRun(winnerId, loserIds);
    }

    return this.executeMerge(winnerId, loserIds, reason);
  }

  async absorbLocalDuplicateSongs(
    input: LocalSongAbsorbInput,
  ): Promise<LocalSongAbsorbReport> {
    const { keepSongId, dropSongId } = input;
    if (!Number.isInteger(keepSongId) || keepSongId <= 0) {
      throw new BadRequestException('keepSongId must be a positive integer');
    }
    if (!Number.isInteger(dropSongId) || dropSongId <= 0) {
      throw new BadRequestException('dropSongId must be a positive integer');
    }
    if (keepSongId === dropSongId) {
      throw new BadRequestException('keepSongId and dropSongId must differ');
    }

    const result = await this.withLocks(() =>
      this.prisma.$transaction(
        async (tx) => {
          const [keepSong, dropSong] = await Promise.all([
            tx.song.findUnique({
              where: { id: keepSongId },
              select: { id: true, channelId: true, globalSongId: true },
            }),
            tx.song.findUnique({
              where: { id: dropSongId },
              select: { id: true, channelId: true, globalSongId: true },
            }),
          ]);

          if (!keepSong) {
            throw new NotFoundException(`keep song ${keepSongId} not found`);
          }
          if (!dropSong) {
            throw new NotFoundException(`drop song ${dropSongId} not found`);
          }
          if (keepSong.channelId !== dropSong.channelId) {
            throw new BadRequestException(
              'keepSongId and dropSongId must belong to the same channel',
            );
          }

          const absorb = await this.absorbSongRow(tx, keepSongId, dropSongId);

          if (keepSong.globalSongId) {
            const recount = await tx.$queryRaw<{ c: bigint }[]>`
              SELECT COUNT(DISTINCT channel_id) AS c
              FROM songs
              WHERE global_song_id = ${keepSong.globalSongId}
            `;
            await tx.globalSong.update({
              where: { id: keepSong.globalSongId },
              data: { channelCount: Number(recount[0]?.c ?? 0) },
            });
          }

          return {
            keepSongId,
            dropSongId,
            channelId: keepSong.channelId,
            keepGlobalSongId: keepSong.globalSongId,
            dropGlobalSongIdBefore: dropSong.globalSongId,
            categoriesMoved: absorb.categoriesMoved,
            deletedSong: true,
          };
        },
        { timeout: GlobalSongMergeService.TRANSACTION_TIMEOUT_MS },
      ),
    );

    await this.cacheTracker.clearChannelsBatchSafe([result.channelId], 'merge');
    this.logger.log(
      `Absorbed local duplicate Song keepSongId=${keepSongId} dropSongId=${dropSongId} reason=${input.reason ?? ''}`,
    );

    return result;
  }

  private validateInput({ winnerId, loserIds, reason }: MergeInput): void {
    if (!Number.isInteger(winnerId) || winnerId <= 0) {
      throw new BadRequestException('winnerId must be a positive integer');
    }
    if (!Array.isArray(loserIds) || loserIds.length === 0) {
      throw new BadRequestException('loserIds must be a non-empty array');
    }
    if (loserIds.length > 50) {
      throw new BadRequestException('loserIds batch size must be <= 50');
    }
    const unique = new Set(loserIds);
    if (unique.size !== loserIds.length) {
      throw new BadRequestException('loserIds must not contain duplicates');
    }
    if (unique.has(winnerId)) {
      throw new BadRequestException('winnerId must not appear in loserIds');
    }
    if (!reason || reason.length > 500) {
      throw new BadRequestException('reason is required and <= 500 chars');
    }
  }

  private async computeDryRun(
    winnerId: number,
    loserIds: number[],
  ): Promise<MergeReport> {
    const winner = await this.prisma.globalSong.findUnique({
      where: { id: winnerId },
      select: { id: true, channelCount: true },
    });
    if (!winner) throw new NotFoundException(`winner ${winnerId} not found`);

    const losers = await this.prisma.globalSong.findMany({
      where: { id: { in: loserIds } },
      select: { id: true },
    });
    if (losers.length !== loserIds.length) {
      const missing = loserIds.filter((l) => !losers.some((x) => x.id === l));
      throw new NotFoundException(`losers not found: ${missing.join(',')}`);
    }

    const [aliasCount, songsCount, conflictSongRows, chainCount, recount] =
      await Promise.all([
        this.prisma.globalSongAlias.count({
          where: { globalSongId: { in: loserIds } },
        }),
        this.prisma.song.count({
          where: { globalSongId: { in: loserIds } },
        }),
        this.countSongRowsToAbsorb([winnerId, ...loserIds]),
        this.prisma.globalSongMerge.count({
          where: { winnerId: { in: loserIds } },
        }),
        this.countDistinctChannels([winnerId, ...loserIds]),
      ]);

    return {
      winnerId,
      loserIds,
      dryRun: true,
      aliasesMoved: aliasCount,
      aliasesDropped: 0,
      songsReassigned: Math.max(0, songsCount - conflictSongRows),
      conflictSongsAutoMerged: conflictSongRows,
      chainsFlattened: chainCount,
      winnerChannelCountBefore: winner.channelCount,
      winnerChannelCountAfter: recount,
      losersDeleted: loserIds.length,
      redisSyncOk: false,
    };
  }

  private async withLocks<T>(fn: () => Promise<T>): Promise<T> {
    const bootstrapHeld = await this.lockService.acquireLock(
      GlobalSongMergeService.BOOTSTRAP_LOCK,
      GlobalSongMergeService.LOCK_TTL_MS,
    );
    if (!bootstrapHeld) {
      throw new BadRequestException(
        'Global song rebuild is in progress — retry after it completes',
      );
    }
    try {
      const mergeHeld = await this.lockService.acquireLock(
        GlobalSongMergeService.MERGE_LOCK,
        GlobalSongMergeService.LOCK_TTL_MS,
      );
      if (!mergeHeld) {
        throw new BadRequestException('Another merge is running');
      }
      try {
        return await fn();
      } finally {
        await this.lockService.releaseLock(GlobalSongMergeService.MERGE_LOCK);
      }
    } finally {
      await this.lockService.releaseLock(GlobalSongMergeService.BOOTSTRAP_LOCK);
    }
  }

  private async executeMerge(
    winnerId: number,
    loserIds: number[],
    reason: string,
  ): Promise<MergeReport> {
    // Merge is the source of truth: all loser rows and prior redirects must
    // collapse into the chosen winner. Musixmatch locks are intentionally not
    // acquired here; blocking a canonical merge on lyrics/matcher contention
    // leaves duplicates alive and hurts downstream coverage more than a
    // transient MXM metadata race.
    return this.executeMergeBody(winnerId, loserIds, reason);
  }

  private async executeMergeBody(
    winnerId: number,
    loserIds: number[],
    reason: string,
  ): Promise<MergeReport> {
    const winnerBefore = await this.prisma.globalSong.findUnique({
      where: { id: winnerId },
      select: {
        id: true,
        channelCount: true,
        normTitle: true,
        globalArtistId: true,
      },
    });
    if (!winnerBefore) {
      throw new NotFoundException(`winner ${winnerId} not found`);
    }

    // Snapshot loser metadata BEFORE deletion — required by Redis sync.
    const loserRows = await this.prisma.globalSong.findMany({
      where: { id: { in: loserIds } },
      select: {
        id: true,
        normTitle: true,
        globalArtistId: true,
        aliases: { select: { normAliasTitle: true } },
        // Musixmatch match fields — needed for transfer logic
        mxmCommontrackId: true,
        mxmTrackId: true,
        mxmHasLyrics: true,
        mxmHasSubtitles: true,
        mxmHasRichsync: true,
        mxmInstrumental: true,
        mxmShareUrl: true,
        primaryIsrc: true,
        iswc: true,
        spotifyTrackId: true,
        matcherStatus: true,
        matcherConfidence: true,
      },
    });
    if (loserRows.length !== loserIds.length) {
      const missing = loserIds.filter(
        (l) => !loserRows.some((x) => x.id === l),
      );
      throw new NotFoundException(`losers not found: ${missing.join(',')}`);
    }

    // Musixmatch commontrack is recording/track metadata, while GlobalSong is
    // the product-level canonical song. Cross-artist manual merges can be
    // correct even when covers or translated versions carry different MXM
    // commontrack ids, so keep this as an audit warning instead of a hard
    // blocker.
    const winnerFull = await this.prisma.globalSong.findUnique({
      where: { id: winnerId },
      select: {
        mxmCommontrackId: true,
        matcherStatus: true,
        matcherConfidence: true,
      },
    });
    if (winnerFull?.mxmCommontrackId) {
      const conflicts = loserRows.filter(
        (l) =>
          l.mxmCommontrackId &&
          l.mxmCommontrackId !== winnerFull.mxmCommontrackId,
      );
      if (conflicts.length > 0) {
        this.logger.warn(
          `Proceeding with manual GlobalSong merge despite MXM commontrack mismatch: ` +
            `winner ${winnerId} commontrack=${winnerFull.mxmCommontrackId}; ` +
            `losers=${conflicts
              .map((l) => `${l.id}:${l.mxmCommontrackId}`)
              .join(',')}`,
        );
      }
    }

    // Decide if any loser has a "better" matcher state we should preserve on
    // the winner. Spec Section 12.2: loser matcherStatus better than winner →
    // transfer match fields + lyrics row.
    const bestLoser = this.pickBestLoserForMxmTransfer(winnerFull, loserRows);

    this.logger.log(
      `Starting GlobalSong merge winnerId=${winnerId} losers=${loserIds.join(',')}`,
    );

    // Transaction: DB mutations only. Redis is post-commit.
    const txReport = await this.prisma
      .$transaction(
        async (tx) => {
          // 1. Move aliases (UPDATE IGNORE skips rows that would collide with
          //    winner's existing (globalSongId, normAliasTitle) unique key).
          const moved = await tx.$executeRaw`
          UPDATE IGNORE global_song_aliases
          SET global_song_id = ${winnerId}
          WHERE global_song_id IN (${Prisma.join(loserIds)})
        `;

          // 2. Remaining loser aliases collided with winner — drop them.
          const dropped = await tx.$executeRaw`
          DELETE FROM global_song_aliases
          WHERE global_song_id IN (${Prisma.join(loserIds)})
        `;

          // 3a. updateMany 직전 affected channel 수집 — globalSongId 변경은 song list
          //     응답에 노출되므로 트랜잭션 종료 후 채널 SET batch 회수 필요.
          const affectedSongs = await tx.song.findMany({
            where: { globalSongId: { in: loserIds } },
            select: { channelId: true },
            distinct: ['channelId'],
          });
          const affectedChannelIds = affectedSongs.map((s) => s.channelId);

          // 3b. If the same channel already has multiple Song rows in the merge
          //     set, a blind globalSongId update would violate
          //     (channel_id, global_song_id). Absorb channel-local duplicate
          //     Song rows into the keeper before flipping remaining FKs.
          const songConflictReport = await this.absorbConflictingSongRows(
            tx,
            winnerId,
            loserIds,
          );
          for (const channelId of songConflictReport.affectedChannelIds) {
            affectedChannelIds.push(channelId);
          }

          // 3. Reassign songs FK.
          const reassigned = await tx.song.updateMany({
            where: { globalSongId: { in: loserIds } },
            data: { globalSongId: winnerId },
          });

          // 4. Flatten merge chain: prior merges that pointed to any loser
          //    as their winner are redirected to the new winner.
          const flattened = await tx.globalSongMerge.updateMany({
            where: { winnerId: { in: loserIds } },
            data: { winnerId },
          });

          // 5. Insert redirect records.
          await tx.globalSongMerge.createMany({
            data: loserIds.map((id) => ({ loserId: id, winnerId, reason })),
            skipDuplicates: true,
          });

          // 5b. Preserve stronger Musixmatch scalar metadata when a loser has
          //     a better matcher state. Canonical merge must never depend on
          //     the lyrics relation: loser lyrics cascade on delete and the
          //     matcher/backfill path can reconcile lyrics for the winner.
          if (bestLoser) {
            await tx.globalSong.update({
              where: { id: winnerId },
              data: {
                mxmCommontrackId: bestLoser.mxmCommontrackId,
                mxmTrackId: bestLoser.mxmTrackId,
                mxmHasLyrics: bestLoser.mxmHasLyrics,
                mxmHasSubtitles: bestLoser.mxmHasSubtitles,
                mxmHasRichsync: bestLoser.mxmHasRichsync,
                mxmInstrumental: bestLoser.mxmInstrumental,
                mxmShareUrl: bestLoser.mxmShareUrl,
                primaryIsrc: bestLoser.primaryIsrc,
                iswc: bestLoser.iswc,
                spotifyTrackId: bestLoser.spotifyTrackId,
                matcherStatus: bestLoser.matcherStatus,
                matcherConfidence: bestLoser.matcherConfidence,
                matcherLastAt: new Date(),
              },
            });
          }

          // 6. Delete losers. FK on songs is SET NULL but we already updated
          //    above; alias FK is RESTRICT and we already cleared it.
          //    Lyrics rows on remaining losers cascade-delete here.
          const deleted = await tx.globalSong.deleteMany({
            where: { id: { in: loserIds } },
          });

          // 7. Recount winner.channelCount from truth (DISTINCT channels on songs).
          const recount = await tx.$queryRaw<{ c: bigint }[]>`
          SELECT COUNT(DISTINCT channel_id) AS c
          FROM songs
          WHERE global_song_id = ${winnerId}
        `;
          const newCount = Number(recount[0]?.c ?? 0);
          await tx.globalSong.update({
            where: { id: winnerId },
            data: { channelCount: newCount },
          });

          return {
            aliasesMoved: Number(moved),
            aliasesDropped: Number(dropped),
            songsReassigned: reassigned.count,
            conflictSongsAutoMerged: songConflictReport.absorbed,
            chainsFlattened: flattened.count,
            losersDeleted: deleted.count,
            newChannelCount: newCount,
            affectedChannelIds: [...new Set(affectedChannelIds)],
          };
        },
        { timeout: GlobalSongMergeService.TRANSACTION_TIMEOUT_MS },
      )
      .catch((error) => {
        this.logger.error(
          `GlobalSong merge transaction failed winnerId=${winnerId} losers=${loserIds.join(',')}: ${
            error instanceof Error ? error.message : error
          }`,
          error instanceof Error ? error.stack : undefined,
        );
        throw error;
      });

    // 트랜잭션 commit 후 multi-channel batch invalidate.
    // song.globalSongId 변경 → song list 응답의 globalSongId 영향.
    if (txReport.affectedChannelIds.length > 0) {
      await this.cacheTracker.clearChannelsBatchSafe(
        txReport.affectedChannelIds,
        'merge',
      );
    }

    // Redis sync is post-commit. On failure we log but do not roll back DB —
    // recovery path is GlobalSongRebuildService.bootstrap() which fully re-derives
    // Redis from DB, or a targeted retry via the tracked merges table.
    let redisSyncOk = false;
    try {
      await this.syncRedisAfterMerge({
        winnerId,
        losers: loserRows,
        newChannelCount: txReport.newChannelCount,
        winnerNormTitle: winnerBefore.normTitle,
      });
      redisSyncOk = true;
    } catch (error) {
      this.logger.error(
        `Redis sync failed after merge winnerId=${winnerId} — ` +
          `losers=${loserIds.join(',')}. DB is consistent; run bootstrap to heal Redis.`,
        error instanceof Error ? error.stack : error,
      );
    }

    // Invalidate Musixmatch hot cache for winner + all losers (spec Section 7.3).
    // Best-effort: cache TTL will heal stale entries within 24h regardless.
    try {
      await this.mxmRedis.invalidateLyrics(winnerId);
      for (const loserId of loserIds) {
        await this.mxmRedis.invalidateLyrics(loserId);
      }
    } catch (error) {
      this.logger.warn(
        `mxm cache invalidate failed after merge winnerId=${winnerId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    return {
      winnerId,
      loserIds,
      dryRun: false,
      aliasesMoved: txReport.aliasesMoved,
      aliasesDropped: txReport.aliasesDropped,
      songsReassigned: txReport.songsReassigned,
      conflictSongsAutoMerged: txReport.conflictSongsAutoMerged,
      chainsFlattened: txReport.chainsFlattened,
      winnerChannelCountBefore: winnerBefore.channelCount,
      winnerChannelCountAfter: txReport.newChannelCount,
      losersDeleted: txReport.losersDeleted,
      redisSyncOk,
    };
  }

  private static readonly MERGE_REDIRECT_TTL_SECONDS = 30 * 24 * 60 * 60;

  private async syncRedisAfterMerge(args: {
    winnerId: number;
    losers: Array<{
      id: number;
      normTitle: string;
      globalArtistId: number;
      aliases: { normAliasTitle: string }[];
    }>;
    newChannelCount: number;
    winnerNormTitle: string;
  }): Promise<void> {
    await this.redis.applyMergeSync({
      winnerId: args.winnerId,
      winnerNormTitle: args.winnerNormTitle,
      newChannelCount: args.newChannelCount,
      losers: args.losers.map((l) => ({
        id: l.id,
        normTitle: l.normTitle,
        globalArtistId: l.globalArtistId,
        aliasTitles: l.aliases.map((a) => a.normAliasTitle),
      })),
      mergeRedirectTtlSeconds:
        GlobalSongMergeService.MERGE_REDIRECT_TTL_SECONDS,
    });
  }

  private async countDistinctChannels(gsIds: number[]): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(DISTINCT channel_id) AS c
      FROM songs
      WHERE global_song_id IN (${Prisma.join(gsIds)})
    `;
    return Number(rows[0]?.c ?? 0);
  }

  private async countSongRowsToAbsorb(gsIds: number[]): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ c: bigint | null }[]>`
      SELECT COALESCE(SUM(row_count - 1), 0) AS c
      FROM (
        SELECT channel_id, COUNT(*) AS row_count
        FROM songs
        WHERE global_song_id IN (${Prisma.join(gsIds)})
        GROUP BY channel_id
        HAVING COUNT(*) > 1
      ) x
    `;
    return Number(rows[0]?.c ?? 0);
  }

  private async absorbConflictingSongRows(
    tx: Prisma.TransactionClient,
    winnerId: number,
    loserIds: number[],
  ): Promise<{ absorbed: number; affectedChannelIds: number[] }> {
    const allGlobalSongIds = [winnerId, ...loserIds];
    const rows = await tx.$queryRaw<
      Array<{
        song_id: number;
        keep_song_id: number;
        channel_id: number;
      }>
    >`
      SELECT drop_s.id AS song_id,
             COALESCE(winner_s.id, min_s.id) AS keep_song_id,
             drop_s.channel_id
      FROM songs drop_s
      JOIN (
        SELECT channel_id, MIN(id) AS min_song_id, COUNT(*) AS row_count
        FROM songs
        WHERE global_song_id IN (${Prisma.join(allGlobalSongIds)})
        GROUP BY channel_id
        HAVING COUNT(*) > 1
      ) grouped ON grouped.channel_id = drop_s.channel_id
      JOIN songs min_s ON min_s.id = grouped.min_song_id
      LEFT JOIN songs winner_s
        ON winner_s.channel_id = drop_s.channel_id
       AND winner_s.global_song_id = ${winnerId}
      WHERE drop_s.global_song_id IN (${Prisma.join(allGlobalSongIds)})
        AND drop_s.id <> COALESCE(winner_s.id, min_s.id)
      ORDER BY drop_s.channel_id ASC, drop_s.id ASC
    `;

    for (const row of rows) {
      await this.absorbSongRow(
        tx,
        Number(row.keep_song_id),
        Number(row.song_id),
      );
    }

    return {
      absorbed: rows.length,
      affectedChannelIds: [...new Set(rows.map((r) => Number(r.channel_id)))],
    };
  }

  private async absorbSongRow(
    tx: Prisma.TransactionClient,
    keepSongId: number,
    dropSongId: number,
  ): Promise<{ categoriesMoved: number }> {
    if (keepSongId === dropSongId) return { categoriesMoved: 0 };

    const [keepSong, dropSong] = await Promise.all([
      tx.song.findUnique({
        where: { id: keepSongId },
        select: {
          id: true,
          channelId: true,
          albumArt: true,
          karaokeUrl: true,
          r2CacheKey: true,
          coverUrl: true,
          originalUrl: true,
          difficulty: true,
          proficiency: true,
          songKey: true,
          bpm: true,
          preferredPitchSemitones: true,
          preferredLyricsOffsetMs: true,
          lyricsLink: true,
          lyricsText: true,
          description: true,
          price: true,
          currencyPrices: true,
          createdAt: true,
        },
      }),
      tx.song.findUnique({
        where: { id: dropSongId },
        select: {
          id: true,
          channelId: true,
          albumArt: true,
          karaokeUrl: true,
          r2CacheKey: true,
          coverUrl: true,
          originalUrl: true,
          difficulty: true,
          proficiency: true,
          songKey: true,
          bpm: true,
          preferredPitchSemitones: true,
          preferredLyricsOffsetMs: true,
          lyricsLink: true,
          lyricsText: true,
          description: true,
          price: true,
          currencyPrices: true,
          createdAt: true,
        },
      }),
    ]);

    if (!keepSong) {
      throw new NotFoundException(`keep song ${keepSongId} not found`);
    }
    if (!dropSong) {
      throw new NotFoundException(`drop song ${dropSongId} not found`);
    }
    if (keepSong.channelId !== dropSong.channelId) {
      throw new BadRequestException(
        'keepSongId and dropSongId must belong to the same channel',
      );
    }

    const currencyPrices =
      keepSong.currencyPrices === null
        ? dropSong.currencyPrices
        : keepSong.currencyPrices;
    await tx.song.update({
      where: { id: keepSongId },
      data: {
        albumArt: keepSong.albumArt ?? dropSong.albumArt,
        karaokeUrl: keepSong.karaokeUrl ?? dropSong.karaokeUrl,
        r2CacheKey: keepSong.r2CacheKey ?? dropSong.r2CacheKey,
        coverUrl: keepSong.coverUrl ?? dropSong.coverUrl,
        originalUrl: keepSong.originalUrl ?? dropSong.originalUrl,
        difficulty: keepSong.difficulty ?? dropSong.difficulty,
        proficiency: keepSong.proficiency ?? dropSong.proficiency,
        songKey: keepSong.songKey ?? dropSong.songKey,
        bpm: keepSong.bpm ?? dropSong.bpm,
        preferredPitchSemitones:
          keepSong.preferredPitchSemitones ?? dropSong.preferredPitchSemitones,
        preferredLyricsOffsetMs:
          keepSong.preferredLyricsOffsetMs ?? dropSong.preferredLyricsOffsetMs,
        lyricsLink: keepSong.lyricsLink ?? dropSong.lyricsLink,
        lyricsText: keepSong.lyricsText ?? dropSong.lyricsText,
        description: keepSong.description ?? dropSong.description,
        price: keepSong.price ?? dropSong.price,
        currencyPrices:
          currencyPrices === null
            ? Prisma.DbNull
            : (currencyPrices as Prisma.InputJsonValue),
        createdAt:
          keepSong.createdAt && dropSong.createdAt
            ? keepSong.createdAt <= dropSong.createdAt
              ? keepSong.createdAt
              : dropSong.createdAt
            : (keepSong.createdAt ?? dropSong.createdAt),
      },
    });

    const [keepCategories, dropCategories] = await Promise.all([
      tx.songCategory.findMany({
        where: { songId: keepSongId },
        select: { categoryId: true },
      }),
      tx.songCategory.findMany({
        where: { songId: dropSongId },
        select: { categoryId: true },
      }),
    ]);
    const keepCategoryIds = new Set(keepCategories.map((c) => c.categoryId));
    const missingCategoryIds = [
      ...new Set(dropCategories.map((c) => c.categoryId)),
    ].filter((categoryId) => !keepCategoryIds.has(categoryId));
    if (missingCategoryIds.length > 0) {
      await tx.songCategory.createMany({
        data: missingCategoryIds.map((categoryId) => ({
          songId: keepSongId,
          categoryId,
        })),
      });
    }
    await tx.songCategory.deleteMany({ where: { songId: dropSongId } });

    await tx.$executeRaw`
      UPDATE IGNORE song_video_preferences
      SET song_id = ${keepSongId}
      WHERE song_id = ${dropSongId}
    `;
    await tx.songVideoPreference.deleteMany({ where: { songId: dropSongId } });

    await tx.$executeRaw`
      UPDATE IGNORE user_song_likes
      SET song_id = ${keepSongId}
      WHERE song_id = ${dropSongId}
    `;
    await tx.userSongLike.deleteMany({ where: { songId: dropSongId } });

    await Promise.all([
      tx.songRequest.updateMany({
        where: { songId: dropSongId },
        data: { songId: keepSongId },
      }),
      tx.clipChannel.updateMany({
        where: { songId: dropSongId },
        data: { songId: keepSongId },
      }),
      tx.clipRequest.updateMany({
        where: { songId: dropSongId },
        data: { songId: keepSongId },
      }),
    ]);

    await tx.$executeRaw`
      UPDATE IGNORE song_add_requests
      SET approved_song_id = ${keepSongId}
      WHERE approved_song_id = ${dropSongId}
    `;
    await tx.songAddRequest.updateMany({
      where: { approvedSongId: dropSongId },
      data: { approvedSongId: null },
    });

    await tx.song.delete({ where: { id: dropSongId } });

    return { categoriesMoved: missingCategoryIds.length };
  }

  /**
   * Choose the loser whose Musixmatch match should be transferred to the
   * winner. Returns null if no loser has a strictly better match than
   * the winner (so transfer is unnecessary).
   *
   * Ranking (highest first):
   *   - matcherStatus rank: MATCHED > MATCHED_DUP_OF_OTHER > MATCHED_NO_LYRICS
   *     > MATCHED_INSTRUMENTAL > MATCHED_RESTRICTED > MANUAL_NEEDED
   *     > UNMATCHED > ERROR > IGNORED > PENDING
   *   - confidence rank: HIGH > MEDIUM > LOW > null
   *
   * Spec Section 12.2.
   */
  private pickBestLoserForMxmTransfer(
    winnerSnapshot: {
      matcherStatus?: GlobalSongMatcherStatus;
      matcherConfidence?: MatcherConfidence | null;
    } | null,
    losers: Array<{
      id: number;
      matcherStatus: GlobalSongMatcherStatus;
      matcherConfidence: MatcherConfidence | null;
      mxmCommontrackId: number | null;
      mxmTrackId: number | null;
      mxmHasLyrics: boolean;
      mxmHasSubtitles: boolean;
      mxmHasRichsync: boolean;
      mxmInstrumental: boolean;
      mxmShareUrl: string | null;
      primaryIsrc: string | null;
      iswc: string | null;
      spotifyTrackId: string | null;
    }>,
  ): (typeof losers)[number] | null {
    const statusRank: Record<GlobalSongMatcherStatus, number> = {
      MATCHED: 100,
      MATCHED_DUP_OF_OTHER: 90,
      MATCHED_NO_LYRICS: 80,
      MATCHED_INSTRUMENTAL: 75,
      MATCHED_RESTRICTED: 70,
      MANUAL_NEEDED: 50,
      UNMATCHED: 30,
      ERROR: 20,
      IGNORED: 10,
      PENDING: 0,
    };
    const confRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

    const winnerStatusScore = winnerSnapshot
      ? statusRank[winnerSnapshot.matcherStatus ?? 'PENDING']
      : 0;
    const winnerConfScore = winnerSnapshot?.matcherConfidence
      ? (confRank[winnerSnapshot.matcherConfidence] ?? 0)
      : 0;

    const losersBetter = losers
      .map((l) => ({
        loser: l,
        score:
          statusRank[l.matcherStatus] * 10 +
          (l.matcherConfidence ? (confRank[l.matcherConfidence] ?? 0) : 0),
      }))
      .filter((x) => x.score > winnerStatusScore * 10 + winnerConfScore)
      .sort((a, b) => b.score - a.score);

    return losersBetter[0]?.loser ?? null;
  }
}
