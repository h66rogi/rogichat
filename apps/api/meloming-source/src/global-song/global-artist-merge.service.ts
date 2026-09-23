import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { GlobalSongMergeService } from './global-song-merge.service';

export interface ArtistMergeInput {
  winnerId: number;
  loserIds: number[];
  reason: string;
  dryRun?: boolean;
}

export interface ArtistMergeReport {
  winnerId: number;
  loserIds: number[];
  dryRun: boolean;
  songsReassigned: number;
  conflictSongsAutoMerged: number;
  aliasesMoved: number;
  aliasesDropped: number;
  losersDeleted: number;
  redisSyncOk: boolean;
}

/**
 * Merge duplicate GlobalArtist rows into one winner.
 *
 * Core complexity: loser artists' songs must be re-pointed to winner. If a
 * (normTitle, winnerArtist) row already exists, re-pointing a loser's song
 * would violate the (normTitle, globalArtistId) unique. That song pair is
 * resolved by an inline GlobalSongMergeService.merge() BEFORE the artist FK
 * flip, so the final UPDATE never hits a collision.
 *
 * Locks: same bootstrap+merge pair used by GlobalSongMergeService so an
 * in-flight rebuild/merge cannot interleave.
 */
@Injectable()
export class GlobalArtistMergeService {
  private readonly logger = new Logger(GlobalArtistMergeService.name);

  private static readonly BOOTSTRAP_LOCK = 'global-song:bootstrap-lock';
  private static readonly MERGE_LOCK = 'global-song:merge-lock';
  private static readonly LOCK_TTL_MS = 10 * 60 * 1000;
  private static readonly MERGE_REDIRECT_TTL_SECONDS = 30 * 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
    private readonly redis: GlobalSongRedisService,
    private readonly songMergeService: GlobalSongMergeService,
  ) {}

  async merge(input: ArtistMergeInput): Promise<ArtistMergeReport> {
    this.validate(input);
    const { winnerId, loserIds, reason, dryRun = false } = input;

    if (dryRun) return this.dryRun(winnerId, loserIds);

    return this.withLocks(async () => this.execute(winnerId, loserIds, reason));
  }

  async resolveMerged(
    id: number,
  ): Promise<{ canonicalId: number; mergedFrom: number | null }> {
    const row = await this.prisma.globalArtistMerge.findUnique({
      where: { loserId: id },
      select: { winnerId: true },
    });
    if (!row) return { canonicalId: id, mergedFrom: null };
    return { canonicalId: row.winnerId, mergedFrom: id };
  }

  private validate({ winnerId, loserIds, reason }: ArtistMergeInput): void {
    if (!Number.isInteger(winnerId) || winnerId <= 0) {
      throw new BadRequestException('winnerId must be a positive integer');
    }
    if (!Array.isArray(loserIds) || loserIds.length === 0) {
      throw new BadRequestException('loserIds must be a non-empty array');
    }
    if (loserIds.length > 20) {
      throw new BadRequestException('loserIds batch size must be <= 20');
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

  private async dryRun(
    winnerId: number,
    loserIds: number[],
  ): Promise<ArtistMergeReport> {
    const winner = await this.prisma.globalArtist.findUnique({
      where: { id: winnerId },
      select: { id: true },
    });
    if (!winner) throw new NotFoundException(`winner ${winnerId} not found`);

    const losers = await this.prisma.globalArtist.findMany({
      where: { id: { in: loserIds } },
      select: { id: true },
    });
    if (losers.length !== loserIds.length) {
      const missing = loserIds.filter((l) => !losers.some((x) => x.id === l));
      throw new NotFoundException(`losers not found: ${missing.join(',')}`);
    }

    const [songsOnLosers, aliasesOnLosers, conflicts] = await Promise.all([
      this.prisma.globalSong.count({
        where: { globalArtistId: { in: loserIds } },
      }),
      this.prisma.globalArtistAlias.count({
        where: { globalArtistId: { in: loserIds } },
      }),
      this.findConflicts(winnerId, loserIds),
    ]);

    return {
      winnerId,
      loserIds,
      dryRun: true,
      songsReassigned: songsOnLosers - conflicts.length,
      conflictSongsAutoMerged: conflicts.length,
      aliasesMoved: aliasesOnLosers,
      aliasesDropped: 0,
      losersDeleted: loserIds.length,
      redisSyncOk: false,
    };
  }

  private async withLocks<T>(fn: () => Promise<T>): Promise<T> {
    const bootstrap = await this.lockService.acquireLock(
      GlobalArtistMergeService.BOOTSTRAP_LOCK,
      GlobalArtistMergeService.LOCK_TTL_MS,
    );
    if (!bootstrap) {
      throw new BadRequestException(
        'Global song rebuild is in progress — retry shortly',
      );
    }
    try {
      const merge = await this.lockService.acquireLock(
        GlobalArtistMergeService.MERGE_LOCK,
        GlobalArtistMergeService.LOCK_TTL_MS,
      );
      if (!merge) {
        throw new BadRequestException('Another merge is running');
      }
      try {
        return await fn();
      } finally {
        await this.lockService.releaseLock(GlobalArtistMergeService.MERGE_LOCK);
      }
    } finally {
      await this.lockService.releaseLock(
        GlobalArtistMergeService.BOOTSTRAP_LOCK,
      );
    }
  }

  /**
   * Songs on a loser artist whose normTitle already exists under the winner.
   * These must be song-merged first to avoid the FK flip triggering a
   * (norm_title, global_artist_id) unique violation.
   */
  private async findConflicts(
    winnerId: number,
    loserIds: number[],
  ): Promise<Array<{ loserSongId: number; winnerSongId: number }>> {
    if (loserIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{ loser_song_id: number; winner_song_id: number }>
    >`
      SELECT gs_l.id AS loser_song_id, gs_w.id AS winner_song_id
      FROM global_songs gs_l
      JOIN global_songs gs_w
        ON gs_l.norm_title = gs_w.norm_title
       AND gs_w.global_artist_id = ${winnerId}
      WHERE gs_l.global_artist_id IN (${Prisma.join(loserIds)})
    `;
    return rows.map((r) => ({
      loserSongId: r.loser_song_id,
      winnerSongId: r.winner_song_id,
    }));
  }

  private async execute(
    winnerId: number,
    loserIds: number[],
    reason: string,
  ): Promise<ArtistMergeReport> {
    // Guard: winner must exist
    const winner = await this.prisma.globalArtist.findUnique({
      where: { id: winnerId },
      select: { id: true },
    });
    if (!winner) throw new NotFoundException(`winner ${winnerId} not found`);

    // Snapshot loser aliases BEFORE deletion — Redis sync needs them.
    const loserRows = await this.prisma.globalArtist.findMany({
      where: { id: { in: loserIds } },
      select: {
        id: true,
        aliases: { select: { normAlias: true } },
      },
    });
    if (loserRows.length !== loserIds.length) {
      const missing = loserIds.filter(
        (l) => !loserRows.some((x) => x.id === l),
      );
      throw new NotFoundException(`losers not found: ${missing.join(',')}`);
    }

    // Step 1: Resolve song conflicts FIRST (outside the big transaction) via
    // the existing GlobalSongMergeService. Each call is its own transaction
    // and handles its own Redis sync. We're already inside withLocks() holding
    // both BOOTSTRAP_LOCK and MERGE_LOCK — call `mergeUnlocked` so the inner
    // service doesn't try to re-acquire the same locks (which would always
    // fail with "rebuild in progress" since we hold them).
    const conflicts = await this.findConflicts(winnerId, loserIds);
    let conflictsMerged = 0;
    for (const { winnerSongId, loserSongId } of conflicts) {
      await this.songMergeService.mergeUnlocked({
        winnerId: winnerSongId,
        loserIds: [loserSongId],
        reason: `artist-merge auxiliary: winnerArtist=${winnerId} loserArtist in ${loserIds.join(',')}`,
        dryRun: false,
      });
      conflictsMerged += 1;
    }

    // Step 2: Flip FK + move aliases + delete losers in one transaction.
    const txReport = await this.prisma.$transaction(
      async (tx) => {
        // Move songs to winner artist (conflicts already resolved, so no
        // unique violation possible).
        const songFlip = await tx.globalSong.updateMany({
          where: { globalArtistId: { in: loserIds } },
          data: { globalArtistId: winnerId },
        });

        // Move aliases: UPDATE IGNORE keeps winner's existing (globalArtistId,
        // normAlias) pairs untouched on collision; remaining loser rows get
        // cleaned up.
        const aliasesMoved = await tx.$executeRaw`
          UPDATE IGNORE global_artist_aliases
          SET global_artist_id = ${winnerId}
          WHERE global_artist_id IN (${Prisma.join(loserIds)})
        `;
        const aliasesDropped = await tx.$executeRaw`
          DELETE FROM global_artist_aliases
          WHERE global_artist_id IN (${Prisma.join(loserIds)})
        `;

        // Flatten any prior artist-merge chain that pointed to a loser.
        await tx.globalArtistMerge.updateMany({
          where: { winnerId: { in: loserIds } },
          data: { winnerId },
        });

        // Redirect records.
        await tx.globalArtistMerge.createMany({
          data: loserIds.map((id) => ({ loserId: id, winnerId, reason })),
          skipDuplicates: true,
        });

        // Delete loser artists.
        const deleted = await tx.globalArtist.deleteMany({
          where: { id: { in: loserIds } },
        });

        return {
          songsReassigned: songFlip.count,
          aliasesMoved: Number(aliasesMoved),
          aliasesDropped: Number(aliasesDropped),
          losersDeleted: deleted.count,
        };
      },
      { timeout: 30_000 },
    );

    // Step 3: Redis sync — ga:alias:{normAlias} sets: remove every loser id,
    // add winner id for each alias the losers carried.
    let redisSyncOk = false;
    try {
      await this.syncRedisAfterArtistMerge({
        winnerId,
        losers: loserRows.map((l) => ({
          id: l.id,
          aliases: l.aliases.map((a) => a.normAlias),
        })),
      });
      redisSyncOk = true;
    } catch (error) {
      this.logger.error(
        `Redis sync failed after artist merge winnerId=${winnerId} losers=${loserIds.join(',')}. ` +
          `DB is consistent; schedule a bootstrap to heal Redis.`,
        error instanceof Error ? error.stack : error,
      );
    }

    return {
      winnerId,
      loserIds,
      dryRun: false,
      songsReassigned: txReport.songsReassigned,
      conflictSongsAutoMerged: conflictsMerged,
      aliasesMoved: txReport.aliasesMoved,
      aliasesDropped: txReport.aliasesDropped,
      losersDeleted: txReport.losersDeleted,
      redisSyncOk,
    };
  }

  /**
   * Remove loser artist ids from ga:alias:{normAlias} sets and add the winner.
   * Redis is always authoritative-after-rebuild; this is a best-effort update
   * so matcher reads don't surface dangling ids before the next bootstrap.
   */
  private async syncRedisAfterArtistMerge(args: {
    winnerId: number;
    losers: Array<{ id: number; aliases: string[] }>;
  }): Promise<void> {
    if (!this.redis.isReady()) {
      this.logger.warn(
        `artist-merge Redis sync skipped (not ready) — winner=${args.winnerId}. ` +
          `Bootstrap rebuild will heal.`,
      );
      return;
    }
    for (const loser of args.losers) {
      for (const alias of loser.aliases) {
        await this.redis.removeArtistAlias(alias, loser.id);
        await this.redis.addArtistAlias(alias, args.winnerId);
      }
    }
  }
}
