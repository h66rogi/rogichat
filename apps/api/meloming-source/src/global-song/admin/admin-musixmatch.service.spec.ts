import { GlobalSongMatcherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MusixmatchClient,
  MusixmatchTransportError,
} from '../musixmatch/musixmatch.client';
import { MusixmatchLyricsService } from '../musixmatch/musixmatch-lyrics.service';
import { MusixmatchMatcherService } from '../musixmatch/musixmatch-matcher.service';
import { MusixmatchQuotaService } from '../musixmatch/musixmatch-quota.service';
import { MusixmatchRedisService } from '../musixmatch/musixmatch-redis.service';
import { AdminMusixmatchService } from './admin-musixmatch.service';

/**
 * Focused tests for Musixmatch admin matching behavior.
 */
describe('AdminMusixmatchService', () => {
  let prisma: {
    globalSong: { findUnique: jest.Mock; update: jest.Mock };
    globalSongLyrics: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let client: jest.Mocked<MusixmatchClient>;
  let lyricsSvc: jest.Mocked<MusixmatchLyricsService>;
  let matcher: jest.Mocked<MusixmatchMatcherService>;
  let quota: jest.Mocked<MusixmatchQuotaService>;
  let redis: jest.Mocked<MusixmatchRedisService>;
  let svc: AdminMusixmatchService;

  beforeEach(() => {
    prisma = {
      globalSong: { findUnique: jest.fn(), update: jest.fn() },
      globalSongLyrics: { deleteMany: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: typeof prisma) => unknown) =>
        fn(prisma),
      ),
    };
    client = { trackGet: jest.fn() } as unknown as jest.Mocked<MusixmatchClient>;
    lyricsSvc = {
      fetchAndStore: jest.fn().mockResolvedValue('STORED'),
    } as unknown as jest.Mocked<MusixmatchLyricsService>;
    matcher = {
      storeMatchSnapshot: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MusixmatchMatcherService>;
    quota = {} as jest.Mocked<MusixmatchQuotaService>;
    redis = {
      invalidateLyrics: jest.fn().mockResolvedValue(undefined),
      clearNegative: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MusixmatchRedisService>;
    svc = new AdminMusixmatchService(
      prisma as unknown as PrismaService,
      client,
      lyricsSvc,
      matcher,
      quota,
      redis,
    );
  });

  describe('match() idempotency', () => {
    it('returns early without calling mxm or lyrics when already MATCHED with same trackId', async () => {
      prisma.globalSong.findUnique.mockResolvedValue({
        id: 144,
        matcherStatus: 'MATCHED' as GlobalSongMatcherStatus,
        mxmTrackId: 256337456,
      });

      const result = await svc.match(144, 256337456);

      expect(client.trackGet).not.toHaveBeenCalled();
      expect(lyricsSvc.fetchAndStore).not.toHaveBeenCalled();
      expect(matcher.storeMatchSnapshot).not.toHaveBeenCalled();
      expect(result).toEqual({
        globalSongId: 144,
        matcherStatus: 'MATCHED',
      });
    });

    it.each([
      'MATCHED_NO_LYRICS',
      'MATCHED_INSTRUMENTAL',
      'MATCHED_RESTRICTED',
      'MATCHED_DUP_OF_OTHER',
    ] as const)(
      'idempotent skip also covers %s when trackId matches',
      async (status) => {
        prisma.globalSong.findUnique.mockResolvedValue({
          id: 50,
          matcherStatus: status,
          mxmTrackId: 999,
        });
        await svc.match(50, 999);
        expect(client.trackGet).not.toHaveBeenCalled();
      },
    );

    it('proceeds normally when same trackId but row is MANUAL_NEEDED (promote suggestion)', async () => {
      prisma.globalSong.findUnique.mockResolvedValue({
        id: 30,
        matcherStatus: 'MANUAL_NEEDED' as GlobalSongMatcherStatus,
        mxmTrackId: 555,
      });
      client.trackGet.mockResolvedValue({
        track: {
          track_id: 555,
          track_name: 'X',
          artist_name: 'Y',
          commontrack_id: 1,
          has_lyrics: 1,
          has_subtitles: 0,
          has_richsync: 0,
          instrumental: 0,
        },
      } as unknown as Awaited<ReturnType<MusixmatchClient['trackGet']>>);

      await svc.match(30, 555);

      expect(client.trackGet).toHaveBeenCalled();
      expect(lyricsSvc.fetchAndStore).toHaveBeenCalled();
      expect(matcher.storeMatchSnapshot).toHaveBeenCalled();
    });

    it('promotes a manual confirmation even when mxm lyrics fetch fails transiently', async () => {
      prisma.globalSong.findUnique.mockResolvedValue({
        id: 411,
        matcherStatus: 'MANUAL_NEEDED' as GlobalSongMatcherStatus,
        mxmTrackId: 256670658,
      });
      client.trackGet.mockResolvedValue({
        track: {
          track_id: 256670658,
          track_name: '첫 키스에 내 심장은 120BPM',
          artist_name: '경서',
          commontrack_id: 159394231,
          has_lyrics: 1,
          has_subtitles: 1,
          has_richsync: 0,
          instrumental: 0,
        },
      } as unknown as Awaited<ReturnType<MusixmatchClient['trackGet']>>);
      lyricsSvc.fetchAndStore.mockRejectedValue(
        new MusixmatchTransportError('track.lyrics.get', 'status 503'),
      );

      const result = await svc.match(411, 256670658);

      expect(result).toEqual({
        globalSongId: 411,
        matcherStatus: 'MATCHED',
      });
      expect(matcher.storeMatchSnapshot).toHaveBeenCalledWith(
        411,
        expect.objectContaining({ track_id: 256670658 }),
        'HIGH',
        'MATCHED',
        'MANUAL',
      );
    });

    it('proceeds when MATCHED but trackId is different (admin override to a new track)', async () => {
      prisma.globalSong.findUnique.mockResolvedValue({
        id: 7,
        matcherStatus: 'MATCHED' as GlobalSongMatcherStatus,
        mxmTrackId: 100,
      });
      client.trackGet.mockResolvedValue({
        track: {
          track_id: 200,
          track_name: 'X',
          artist_name: 'Y',
          commontrack_id: 1,
          has_lyrics: 1,
          has_subtitles: 0,
          has_richsync: 0,
          instrumental: 0,
        },
      } as unknown as Awaited<ReturnType<MusixmatchClient['trackGet']>>);

      await svc.match(7, 200);

      expect(client.trackGet).toHaveBeenCalledWith(
        { track_id: 200 },
        { mode: 'normal' },
      );
    });
  });

  describe('match() source', () => {
    const setupMatchTrack = (instrumental: 0 | 1 = 0) => {
      prisma.globalSong.findUnique.mockResolvedValue({
        id: 1,
        matcherStatus: 'UNMATCHED' as GlobalSongMatcherStatus,
        mxmTrackId: null,
      });
      client.trackGet.mockResolvedValue({
        track: {
          track_id: 999,
          track_name: 'A',
          artist_name: 'B',
          commontrack_id: 11,
          has_lyrics: instrumental === 1 ? 0 : 1,
          has_subtitles: 0,
          has_richsync: 0,
          instrumental,
        },
      } as unknown as Awaited<ReturnType<MusixmatchClient['trackGet']>>);
    };

    it('records MANUAL for admin matching', async () => {
      setupMatchTrack();
      await svc.match(1, 999);
      const lastCall = matcher.storeMatchSnapshot.mock.calls.at(-1);
      expect(lastCall?.[4]).toBe('MANUAL');
    });

    it('still records correct source on instrumental short-circuit', async () => {
      setupMatchTrack(1);
      await svc.match(1, 999);
      expect(lyricsSvc.fetchAndStore).not.toHaveBeenCalled();
      expect(matcher.storeMatchSnapshot).toHaveBeenCalledWith(
        1,
        expect.any(Object),
        'HIGH',
        'MATCHED_INSTRUMENTAL',
        'MANUAL',
      );
    });
  });
});
