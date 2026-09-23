import { ConfigService } from '@nestjs/config';
import { GlobalSongMatcherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MusixmatchAlternateSearchService } from './musixmatch-alternate-search.service';
import { MusixmatchClient, MusixmatchNotFoundError } from './musixmatch.client';
import { MusixmatchLyricsService } from './musixmatch-lyrics.service';
import { MusixmatchMatcherService } from './musixmatch-matcher.service';
import { MusixmatchRedisService } from './musixmatch-redis.service';

/**
 * MusixmatchMatcherService unit tests.
 *
 * Spec Section 4 (matching algorithm) + 4.4 (commontrack auto-dedup).
 */
describe('MusixmatchMatcherService', () => {
  let prisma: jest.Mocked<{
    globalSong: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    globalArtistAlias: { findFirst: jest.Mock };
  }>;
  let client: jest.Mocked<MusixmatchClient>;
  let redis: jest.Mocked<MusixmatchRedisService>;
  let lyrics: jest.Mocked<MusixmatchLyricsService>;
  let svc: MusixmatchMatcherService;

  const baseGlobalSong = {
    id: 100,
    title: 'Through the Night',
    normTitle: 'throughthenight',
    globalArtistId: 50,
    primaryIsrc: null,
    matcherStatus: 'PENDING' as GlobalSongMatcherStatus,
    globalArtist: {
      id: 50,
      canonicalName: 'IU',
      normKey: 'iu',
    },
  };

  const matchedTrack = {
    track_id: 128797629,
    track_name: 'Through the Night',
    artist_name: 'IU',
    commontrack_id: 70840807,
    track_isrc: 'KRA381700868',
    track_spotify_id: '3P3UA61WRQqwCXaoFOTENd',
    has_lyrics: 1 as const,
    has_subtitles: 1 as const,
    has_richsync: 1 as const,
    instrumental: 0 as const,
    track_share_url: 'https://www.musixmatch.com/...',
  };

  beforeEach(() => {
    prisma = {
      globalSong: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      globalArtistAlias: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    client = {
      trackGet: jest.fn(),
      matcherTrackGet: jest.fn(),
    } as unknown as jest.Mocked<MusixmatchClient>;
    redis = {
      hasNegative: jest.fn().mockResolvedValue(false),
      acquireLock: jest.fn().mockResolvedValue('token'),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      songLockKey: jest.fn((id) => `mxm:lock:${id}`),
      commontrackLockKey: jest.fn((id) => `mxm:ctlock:${id}`),
      setNegative: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MusixmatchRedisService>;
    lyrics = {
      fetchAndStore: jest.fn().mockResolvedValue('STORED'),
    } as unknown as jest.Mocked<MusixmatchLyricsService>;
    const alternateSearch = {
      isEnabled: jest.fn().mockReturnValue(false),
      shouldAttempt: jest.fn().mockReturnValue(false),
      findAlternate: jest
        .fn()
        .mockResolvedValue({ track: null, attempts: 0, hintForAdmin: null }),
    } as unknown as jest.Mocked<MusixmatchAlternateSearchService>;

    const config = {
      get: jest.fn().mockReturnValue(false),
    } as unknown as ConfigService;

    svc = new MusixmatchMatcherService(
      prisma as unknown as PrismaService,
      client,
      redis,
      lyrics,
      alternateSearch,
      config,
    );
  });

  describe('terminal status guard', () => {
    it.each<GlobalSongMatcherStatus>([
      'MATCHED',
      'MATCHED_NO_LYRICS',
      'MATCHED_INSTRUMENTAL',
      'MATCHED_RESTRICTED',
      'MATCHED_DUP_OF_OTHER',
      'UNMATCHED',
      'IGNORED',
    ])('skips when status is %s', async (status) => {
      prisma.globalSong.findUnique.mockResolvedValue({
        ...baseGlobalSong,
        matcherStatus: status,
      });

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('SKIPPED');
      expect(client.matcherTrackGet).not.toHaveBeenCalled();
    });

    it('proceeds when status is PENDING', async () => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      client.matcherTrackGet.mockResolvedValue({ track: matchedTrack });

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('MATCHED');
      expect(client.matcherTrackGet).toHaveBeenCalled();
    });
  });

  describe('lock contention', () => {
    it('skips when another worker holds the lock', async () => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      redis.acquireLock.mockResolvedValueOnce(null);

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('SKIPPED');
      expect(client.matcherTrackGet).not.toHaveBeenCalled();
    });

    it('releases the lock after match completes', async () => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      client.matcherTrackGet.mockResolvedValue({ track: matchedTrack });

      await svc.maybeMatch(100, 'normal');

      expect(redis.releaseLock).toHaveBeenCalledWith(
        'mxm:lock:100',
        'token',
      );
    });
  });

  describe('ISRC fast path', () => {
    it('uses track.get when primaryIsrc is set (HIGH confidence)', async () => {
      prisma.globalSong.findUnique.mockResolvedValue({
        ...baseGlobalSong,
        primaryIsrc: 'KRA381700868',
      });
      client.trackGet = jest
        .fn()
        .mockResolvedValue({ track: matchedTrack });
      client.matcherTrackGet = jest.fn();

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('MATCHED');
      expect(client.trackGet).toHaveBeenCalledWith(
        { track_isrc: 'KRA381700868' },
        { mode: 'normal' },
      );
      expect(client.matcherTrackGet).not.toHaveBeenCalled();
      expect(prisma.globalSong.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 100 },
          data: expect.objectContaining({ matcherConfidence: 'HIGH' }),
        }),
      );
    });

    it('falls back to matcher.track.get when ISRC lookup returns 404', async () => {
      prisma.globalSong.findUnique.mockResolvedValue({
        ...baseGlobalSong,
        primaryIsrc: 'XX0000000000',
      });
      client.trackGet = jest
        .fn()
        .mockRejectedValue(
          new MusixmatchNotFoundError('track.get', 'status 404'),
        );
      client.matcherTrackGet.mockResolvedValue({ track: matchedTrack });

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('MATCHED');
      expect(client.matcherTrackGet).toHaveBeenCalled();
    });
  });

  describe('artist confidence validation', () => {
    it('marks MANUAL_NEEDED when artist is mismatched (no alias)', async () => {
      // 잔나비 vs 해음 case from spec Section 5.2 / 4.4
      prisma.globalSong.findUnique.mockResolvedValue({
        ...baseGlobalSong,
        title: '주저하는 연인들을 위해',
        globalArtist: {
          id: 50,
          canonicalName: '잔나비',
          normKey: '잔나비',
        },
      });
      client.matcherTrackGet.mockResolvedValue({
        track: { ...matchedTrack, artist_name: '해음' },
      });
      prisma.globalArtistAlias.findFirst.mockResolvedValue(null);

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('MANUAL_NEEDED');
    });

    it('accepts when artist matches via alias', async () => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      client.matcherTrackGet.mockResolvedValue({
        track: { ...matchedTrack, artist_name: '아이유' },
      });
      // alias 'iu' ↔ '아이유' already known
      prisma.globalArtistAlias.findFirst.mockResolvedValue({
        id: 1,
        globalArtistId: 50,
        normAlias: '아이유',
      });

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('MATCHED');
    });
  });

  describe('outcome → status mapping', () => {
    beforeEach(() => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      client.matcherTrackGet.mockResolvedValue({ track: matchedTrack });
    });

    it('MATCHED when lyrics stored', async () => {
      lyrics.fetchAndStore.mockResolvedValue('STORED');
      expect(await svc.maybeMatch(100, 'normal')).toBe('MATCHED');
    });

    it('MATCHED_NO_LYRICS when lyrics missing', async () => {
      lyrics.fetchAndStore.mockResolvedValue('NO_LYRICS');
      expect(await svc.maybeMatch(100, 'normal')).toBe('MATCHED_NO_LYRICS');
    });

    it('MATCHED_RESTRICTED when KR-restricted', async () => {
      lyrics.fetchAndStore.mockResolvedValue('RESTRICTED_KR');
      expect(await svc.maybeMatch(100, 'normal')).toBe('MATCHED_RESTRICTED');
    });

    it('MATCHED_INSTRUMENTAL when track flag set (skips lyrics fetch)', async () => {
      client.matcherTrackGet.mockResolvedValue({
        track: { ...matchedTrack, instrumental: 1 },
      });

      expect(await svc.maybeMatch(100, 'normal')).toBe(
        'MATCHED_INSTRUMENTAL',
      );
      expect(lyrics.fetchAndStore).not.toHaveBeenCalled();
    });
  });

  describe('UNMATCHED', () => {
    it('marks UNMATCHED + sets negative cache when matcher returns null', async () => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      client.matcherTrackGet.mockResolvedValue({ track: null as unknown as never });

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('UNMATCHED');
      expect(redis.setNegative).toHaveBeenCalledWith(100);
    });

    it('marks UNMATCHED on 404 from matcher.track.get', async () => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      client.matcherTrackGet.mockRejectedValue(
        new MusixmatchNotFoundError('matcher.track.get', 'status 404'),
      );

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('UNMATCHED');
    });
  });

  describe('commontrack auto-dedup detection (spec 4.4)', () => {
    it('marks MATCHED_DUP_OF_OTHER when sibling exists with same commontrack', async () => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      client.matcherTrackGet.mockResolvedValue({ track: matchedTrack });
      prisma.globalSong.findFirst.mockResolvedValue({
        id: 99,
        mxmCommontrackId: 70840807,
        matcherStatus: 'MATCHED',
        matcherConfidence: 'HIGH',
        channelCount: 50,
        createdAt: new Date('2024-01-01'),
      });

      const result = await svc.maybeMatch(100, 'normal');

      // After fix: SINGLE final update with MATCHED_DUP_OF_OTHER as the
      // persisted status (no overwrite). Verify return value is the same.
      expect(result).toBe('MATCHED_DUP_OF_OTHER');
      // The final update call should set MATCHED_DUP_OF_OTHER
      const finalUpdate = prisma.globalSong.update.mock.calls.find((call) => {
        const data = (call[0] as { data: { matcherStatus?: string } }).data;
        return data.matcherStatus === 'MATCHED_DUP_OF_OTHER';
      });
      expect(finalUpdate).toBeDefined();
      // No call should have set status to plain MATCHED first
      const plainMatched = prisma.globalSong.update.mock.calls.find((call) => {
        const data = (call[0] as { data: { matcherStatus?: string } }).data;
        return data.matcherStatus === 'MATCHED';
      });
      expect(plainMatched).toBeUndefined();
    });

    it('skips dedup when commontrack lock contended', async () => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      client.matcherTrackGet.mockResolvedValue({ track: matchedTrack });
      // First lock acquire (song-level) succeeds, second (commontrack) fails
      redis.acquireLock
        .mockResolvedValueOnce('songtoken')
        .mockResolvedValueOnce(null);

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('MATCHED');
      // findFirst should not have been called for sibling search
      expect(prisma.globalSong.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('failure isolation', () => {
    it('returns SKIPPED on unexpected error (does NOT throw)', async () => {
      prisma.globalSong.findUnique.mockRejectedValue(new Error('DB down'));

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('SKIPPED');
    });

    it('returns SKIPPED when negative cache hit', async () => {
      prisma.globalSong.findUnique.mockResolvedValue(baseGlobalSong);
      redis.hasNegative.mockResolvedValue(true);

      const result = await svc.maybeMatch(100, 'normal');

      expect(result).toBe('SKIPPED');
      expect(client.matcherTrackGet).not.toHaveBeenCalled();
    });
  });

});
