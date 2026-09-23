import { BadRequestException } from '@nestjs/common';
import { GlobalSongMergeService } from './global-song-merge.service';
import { DistributedLockService } from '../common/distributed-lock/distributed-lock.service';
import { GlobalSongRedisService } from './global-song-redis.service';
import { MusixmatchRedisService } from './musixmatch/musixmatch-redis.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * GlobalSongMergeService unit tests focused on the new Section 12.2 transfer
 * logic: commontrack conflict, mxm metadata transfer when loser is better,
 * lyrics row rekey, mxm cache invalidate, and lock acquisition.
 *
 * Existing merge primitives (alias move, songs FK, channelCount recount) are
 * exercised by integration tests; this file targets only the new code paths.
 */
describe('GlobalSongMergeService — A1b transfer logic', () => {
  type Prismish = {
    globalSong: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  let prisma: Prismish;
  let lockService: jest.Mocked<DistributedLockService>;
  let redis: jest.Mocked<GlobalSongRedisService>;
  let mxmRedis: jest.Mocked<MusixmatchRedisService>;
  let svc: GlobalSongMergeService;

  beforeEach(() => {
    prisma = {
      globalSong: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    lockService = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DistributedLockService>;
    redis = {
      isReady: jest.fn().mockReturnValue(true),
      flushGlobalSongKeys: jest.fn().mockResolvedValue(undefined),
      removeChannelSongMapping: jest.fn(),
      removeFromChannelSongSet: jest.fn(),
      setMergeRedirect: jest.fn(),
      removeFromPrefixIndex: jest.fn(),
      addToPrefixIndex: jest.fn(),
    } as unknown as jest.Mocked<GlobalSongRedisService>;
    mxmRedis = {
      isReady: jest.fn().mockReturnValue(true),
      acquireLock: jest.fn().mockResolvedValue('token'),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      songLockKey: jest.fn((id) => `mxm:lock:${id}`),
      invalidateLyrics: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MusixmatchRedisService>;
    svc = new GlobalSongMergeService(
      prisma as unknown as PrismaService,
      lockService,
      redis,
      mxmRedis,
    );
  });

  describe('commontrack conflict detection', () => {
    it('throws BadRequestException when winner and loser have different non-null commontrack ids', async () => {
      // Single mock returns a record covering both selects (winnerBefore + winnerFull).
      // Prisma's `select` doesn't strip extra fields from a mock return.
      prisma.globalSong.findUnique.mockResolvedValue({
        id: 1,
        channelCount: 5,
        normTitle: 'foo',
        globalArtistId: 10,
        mxmCommontrackId: 100,
        matcherStatus: 'MATCHED',
        matcherConfidence: 'HIGH',
        lyrics: null,
      });
      prisma.globalSong.findMany.mockResolvedValue([
        {
          id: 2,
          normTitle: 'foo',
          globalArtistId: 10,
          aliases: [],
          mxmCommontrackId: 200, // CONFLICT
          mxmTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          matcherStatus: 'MATCHED',
          matcherConfidence: 'HIGH',
          lyrics: null,
        },
      ]);

      await expect(
        svc.mergeUnlocked({
          winnerId: 1,
          loserIds: [2],
          reason: 'test',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does NOT throw when one side has null commontrack', async () => {
      // Winner has commontrack=100, loser has null → not a conflict
      prisma.globalSong.findUnique.mockImplementation(({ where }) => {
        if (typeof where.id === 'number' && where.id === 1) {
          return Promise.resolve({
            id: 1,
            channelCount: 5,
            normTitle: 'foo',
            globalArtistId: 10,
            mxmCommontrackId: 100,
            matcherStatus: 'MATCHED',
            matcherConfidence: 'HIGH',
            lyrics: null,
          });
        }
        return Promise.resolve(null);
      });
      prisma.globalSong.findMany.mockResolvedValue([
        {
          id: 2,
          normTitle: 'foo',
          globalArtistId: 10,
          aliases: [],
          mxmCommontrackId: null,
          mxmTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          matcherStatus: 'PENDING',
          matcherConfidence: null,
          lyrics: null,
        },
      ]);
      // Bypass the heavy transaction; success path
      prisma.$transaction.mockResolvedValue({
        aliasesMoved: 0,
        aliasesDropped: 0,
        songsReassigned: 0,
        chainsFlattened: 0,
        losersDeleted: 1,
        newChannelCount: 5,
      });

      // Don't await on Redis sync side effects in this assertion — focus on
      // not throwing the conflict.
      await expect(
        svc.mergeUnlocked({
          winnerId: 1,
          loserIds: [2],
          reason: 'test',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('mxm lock policy', () => {
    function setupHappyPath(winnerId: number, loserId: number) {
      prisma.globalSong.findUnique.mockImplementation(({ where }) => {
        if (where.id === winnerId) {
          return Promise.resolve({
            id: winnerId,
            channelCount: 5,
            normTitle: 'foo',
            globalArtistId: 10,
            mxmCommontrackId: null,
            matcherStatus: 'PENDING',
            matcherConfidence: null,
            lyrics: null,
          });
        }
        return Promise.resolve(null);
      });
      prisma.globalSong.findMany.mockResolvedValue([
        {
          id: loserId,
          normTitle: 'foo',
          globalArtistId: 10,
          aliases: [],
          mxmCommontrackId: null,
          mxmTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          matcherStatus: 'PENDING',
          matcherConfidence: null,
          lyrics: null,
        },
      ]);
      prisma.$transaction.mockResolvedValue({
        aliasesMoved: 0,
        aliasesDropped: 0,
        songsReassigned: 0,
        chainsFlattened: 0,
        losersDeleted: 1,
        newChannelCount: 5,
      });
    }

    it('does not acquire mxm locks during canonical merge', async () => {
      setupHappyPath(5, 1);

      await svc.mergeUnlocked({
        winnerId: 5,
        loserIds: [1],
        reason: 'test',
      });

      expect(mxmRedis.acquireLock).not.toHaveBeenCalled();
    });

    it('does not release mxm locks during canonical merge', async () => {
      prisma.globalSong.findUnique.mockResolvedValue({
        id: 1,
        channelCount: 0,
        normTitle: 'foo',
        globalArtistId: 10,
      });
      prisma.globalSong.findMany.mockResolvedValue([
        {
          id: 2,
          normTitle: 'foo',
          globalArtistId: 10,
          aliases: [],
          mxmCommontrackId: null,
          mxmTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          matcherStatus: 'PENDING',
          matcherConfidence: null,
          lyrics: null,
        },
      ]);
      prisma.$transaction.mockResolvedValue({
        aliasesMoved: 0,
        aliasesDropped: 0,
        songsReassigned: 0,
        chainsFlattened: 0,
        losersDeleted: 1,
        newChannelCount: 0,
      });

      await svc.mergeUnlocked({
        winnerId: 1,
        loserIds: [2],
        reason: 'test',
      });

      expect(mxmRedis.releaseLock).not.toHaveBeenCalled();
    });
  });

  describe('mxm cache invalidation post-commit', () => {
    it('invalidates mxm:lyrics for winner and all losers', async () => {
      prisma.globalSong.findUnique.mockResolvedValue({
        id: 1,
        channelCount: 0,
        normTitle: 'foo',
        globalArtistId: 10,
      });
      prisma.globalSong.findMany.mockResolvedValue([
        {
          id: 2,
          normTitle: 'foo',
          globalArtistId: 10,
          aliases: [],
          mxmCommontrackId: null,
          mxmTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          matcherStatus: 'PENDING',
          matcherConfidence: null,
          lyrics: null,
        },
        {
          id: 3,
          normTitle: 'foo',
          globalArtistId: 10,
          aliases: [],
          mxmCommontrackId: null,
          mxmTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          matcherStatus: 'PENDING',
          matcherConfidence: null,
          lyrics: null,
        },
      ]);
      prisma.$transaction.mockResolvedValue({
        aliasesMoved: 0,
        aliasesDropped: 0,
        songsReassigned: 0,
        chainsFlattened: 0,
        losersDeleted: 2,
        newChannelCount: 0,
      });

      await svc.mergeUnlocked({
        winnerId: 1,
        loserIds: [2, 3],
        reason: 'test',
      });

      expect(mxmRedis.invalidateLyrics).toHaveBeenCalledWith(1);
      expect(mxmRedis.invalidateLyrics).toHaveBeenCalledWith(2);
      expect(mxmRedis.invalidateLyrics).toHaveBeenCalledWith(3);
    });
  });

  describe('pickBestLoserForMxmTransfer ranking', () => {
    // Access the private method through bracket notation for unit testing.
    // Acceptable here since the ranking logic is pure and deterministic.
    function pick(svc: GlobalSongMergeService, winner: any, losers: any[]) {
      return (
        svc as unknown as {
          pickBestLoserForMxmTransfer: (winner: any, losers: any[]) => unknown;
        }
      ).pickBestLoserForMxmTransfer(winner, losers);
    }

    it('returns null when no loser has better state than winner', () => {
      const winner = { matcherStatus: 'MATCHED', matcherConfidence: 'HIGH' };
      const losers = [
        {
          id: 2,
          matcherStatus: 'PENDING',
          matcherConfidence: null,
          mxmCommontrackId: null,
          mxmTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          lyrics: null,
        },
      ];
      expect(pick(svc, winner, losers)).toBeNull();
    });

    it('picks loser with MATCHED over winner with PENDING', () => {
      const winner = { matcherStatus: 'PENDING', matcherConfidence: null };
      const losers = [
        {
          id: 5,
          matcherStatus: 'MATCHED',
          matcherConfidence: 'HIGH',
          mxmCommontrackId: 100,
          mxmTrackId: 200,
          mxmHasLyrics: true,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          lyrics: null,
        },
      ];
      const picked = pick(svc, winner, losers) as { id: number };
      expect(picked.id).toBe(5);
    });

    it('prefers MATCHED over MATCHED_NO_LYRICS even at same confidence', () => {
      const winner = { matcherStatus: 'PENDING', matcherConfidence: null };
      const losers = [
        {
          id: 5,
          matcherStatus: 'MATCHED_NO_LYRICS',
          matcherConfidence: 'HIGH',
          mxmCommontrackId: null,
          mxmTrackId: null,
          mxmHasLyrics: false,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          lyrics: null,
        },
        {
          id: 7,
          matcherStatus: 'MATCHED',
          matcherConfidence: 'HIGH',
          mxmCommontrackId: 100,
          mxmTrackId: 200,
          mxmHasLyrics: true,
          mxmHasSubtitles: false,
          mxmHasRichsync: false,
          mxmInstrumental: false,
          mxmShareUrl: null,
          primaryIsrc: null,
          iswc: null,
          spotifyTrackId: null,
          lyrics: null,
        },
      ];
      const picked = pick(svc, winner, losers) as { id: number };
      expect(picked.id).toBe(7);
    });
  });
});
