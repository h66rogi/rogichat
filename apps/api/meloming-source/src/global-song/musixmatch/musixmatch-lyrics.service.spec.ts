import { PrismaService } from '../../prisma/prisma.service';
import { KoreanPronunciationService } from './korean-pronunciation.service';
import { MusixmatchClient, MusixmatchNotFoundError } from './musixmatch.client';
import { MusixmatchLyricsService } from './musixmatch-lyrics.service';
import { MusixmatchRedisService } from './musixmatch-redis.service';

describe('MusixmatchLyricsService', () => {
  let prisma: jest.Mocked<{
    globalSong: {
      findUnique: jest.Mock;
    };
    globalSongLyrics: {
      upsert: jest.Mock;
    };
  }>;
  let client: jest.Mocked<MusixmatchClient>;
  let redis: jest.Mocked<MusixmatchRedisService>;
  let svc: MusixmatchLyricsService;

  const baseLyrics = {
    lyrics_id: 26664821,
    lyrics_body: '이 밤 그날의 반딧불을 당신의\n창 가까이 보낼게요',
    lyrics_language: 'ko',
    lyrics_copyright: 'Lyrics powered by www.musixmatch.com',
    script_tracking_url: 'https://tracking.musixmatch.com/...',
    pixel_tracking_url: 'https://tracking.musixmatch.com/...img...',
    backlink_url: 'https://www.musixmatch.com/lyrics/IU/...',
    instrumental: 0,
    restricted: null,
  };

  const baseSubtitle = {
    subtitle_id: 34836842,
    subtitle_body: '[00:00.25] 이 밤 그날의 반딧불을\n[00:13.25] 창 가까이 보낼게요',
    subtitle_length: 253,
    subtitle_language: 'ko',
    restricted: null,
  };

  beforeEach(() => {
    prisma = {
      globalSong: {
        findUnique: jest.fn().mockResolvedValue({ title: '밤편지' }),
      },
      globalSongLyrics: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    client = {
      trackLyricsGet: jest.fn(),
      trackLyricsTranslationGet: jest.fn(),
      trackSubtitleGet: jest.fn(),
    } as unknown as jest.Mocked<MusixmatchClient>;
    redis = {
      invalidateLyrics: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MusixmatchRedisService>;
    const koPron = {
      isSupportedLanguage: jest.fn().mockReturnValue(false),
      transliterate: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<KoreanPronunciationService>;
    svc = new MusixmatchLyricsService(
      prisma as unknown as PrismaService,
      client,
      redis,
      koPron,
    );
  });

  describe('STORED outcomes', () => {
    it('stores lyrics body + LRC subtitle when both present', async () => {
      client.trackLyricsGet.mockResolvedValue({ lyrics: baseLyrics });
      client.trackSubtitleGet.mockResolvedValue({ subtitle: baseSubtitle });

      const outcome = await svc.fetchAndStore(100, 128797629, true, 'normal');

      expect(outcome).toBe('STORED');
      expect(prisma.globalSongLyrics.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { globalSongId: 100 },
          create: expect.objectContaining({
            globalSongId: 100,
            body: baseLyrics.lyrics_body,
            language: 'ko',
            hasSubtitle: true,
            subtitleBody: baseSubtitle.subtitle_body,
            copyrightLine: baseLyrics.lyrics_copyright,
            restrictedKr: false,
          }),
        }),
      );
      expect(redis.invalidateLyrics).toHaveBeenCalledWith(100);
    });

    it('stores body only when has_subtitles=false (skips subtitle call)', async () => {
      client.trackLyricsGet.mockResolvedValue({ lyrics: baseLyrics });

      const outcome = await svc.fetchAndStore(100, 128797629, false, 'normal');

      expect(outcome).toBe('STORED');
      expect(client.trackSubtitleGet).not.toHaveBeenCalled();
    });

    it('stores Korean translation for non-Korean lyrics', async () => {
      client.trackLyricsGet.mockResolvedValue({
        lyrics: {
          ...baseLyrics,
          lyrics_body: 'hello\nworld',
          lyrics_language: 'en',
        },
      });
      client.trackLyricsTranslationGet.mockResolvedValue({
        lyrics_translation: {
          translation_list: [
            { translation: { matched_line: 'hello', description: '안녕' } },
            { translation: { matched_line: 'world', description: '세상' } },
          ],
        },
      });

      const outcome = await svc.fetchAndStore(100, 128797629, false, 'normal');

      expect(outcome).toBe('STORED');
      expect(client.trackLyricsTranslationGet).toHaveBeenCalledWith(
        { track_id: 128797629, selected_language: 'ko' },
        { mode: 'normal' },
      );
      expect(prisma.globalSongLyrics.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            language: 'en',
            bodyTranslation: '안녕\n세상',
            bodyTranslationLanguage: 'ko',
            bodyTranslationAt: expect.any(Date),
          }),
        }),
      );
    });

    it('stores Korean translation from mxm translated lyrics response shape', async () => {
      client.trackLyricsGet.mockResolvedValue({
        lyrics: {
          ...baseLyrics,
          lyrics_body: 'hello\nworld',
          lyrics_language: 'en',
        },
      });
      client.trackLyricsTranslationGet.mockResolvedValue({
        lyrics: {
          ...baseLyrics,
          lyrics_translated: {
            lyrics_body: '안녕\n세상',
            selected_language: 'ko',
            restricted: 0,
            locked: 0,
          },
        },
      });

      const outcome = await svc.fetchAndStore(100, 128797629, false, 'normal');

      expect(outcome).toBe('STORED');
      expect(prisma.globalSongLyrics.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            language: 'en',
            bodyTranslation: '안녕\n세상',
            bodyTranslationLanguage: 'ko',
            bodyTranslationAt: expect.any(Date),
          }),
        }),
      );
    });

    it('skips translation fetch for Korean lyrics', async () => {
      client.trackLyricsGet.mockResolvedValue({ lyrics: baseLyrics });

      const outcome = await svc.fetchAndStore(100, 128797629, false, 'normal');

      expect(outcome).toBe('STORED');
      expect(client.trackLyricsTranslationGet).not.toHaveBeenCalled();
    });

    it('stores body without subtitle when subtitle.get returns 404', async () => {
      client.trackLyricsGet.mockResolvedValue({ lyrics: baseLyrics });
      client.trackSubtitleGet.mockRejectedValue(
        new MusixmatchNotFoundError('track.subtitle.get', 'status 404'),
      );

      const outcome = await svc.fetchAndStore(100, 128797629, true, 'normal');

      expect(outcome).toBe('STORED');
      expect(prisma.globalSongLyrics.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ hasSubtitle: false }),
        }),
      );
    });
  });

  describe('NO_LYRICS', () => {
    it('returns NO_LYRICS when lyrics.get returns 404', async () => {
      client.trackLyricsGet.mockRejectedValue(
        new MusixmatchNotFoundError('track.lyrics.get', 'status 404'),
      );

      const outcome = await svc.fetchAndStore(100, 128797629, false, 'normal');

      expect(outcome).toBe('NO_LYRICS');
      expect(prisma.globalSongLyrics.upsert).not.toHaveBeenCalled();
    });

    it('returns NO_LYRICS when body is empty', async () => {
      client.trackLyricsGet.mockResolvedValue({
        lyrics: { ...baseLyrics, lyrics_body: '' },
      });

      const outcome = await svc.fetchAndStore(100, 128797629, false, 'normal');

      expect(outcome).toBe('NO_LYRICS');
    });
  });

  describe('INSTRUMENTAL', () => {
    it('returns INSTRUMENTAL when lyrics flag set', async () => {
      client.trackLyricsGet.mockResolvedValue({
        lyrics: { ...baseLyrics, instrumental: 1 },
      });

      const outcome = await svc.fetchAndStore(100, 128797629, false, 'normal');

      expect(outcome).toBe('INSTRUMENTAL');
      expect(prisma.globalSongLyrics.upsert).not.toHaveBeenCalled();
    });
  });

  describe('RESTRICTED_KR', () => {
    it('returns RESTRICTED_KR + stores restriction marker (no body)', async () => {
      client.trackLyricsGet.mockResolvedValue({
        lyrics: { ...baseLyrics, restricted: 1 },
      });

      const outcome = await svc.fetchAndStore(100, 128797629, true, 'normal');

      expect(outcome).toBe('RESTRICTED_KR');
      expect(prisma.globalSongLyrics.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            restrictedKr: true,
            body: '',
          }),
        }),
      );
    });

    it('does NOT include lyrics body when restricted', async () => {
      client.trackLyricsGet.mockResolvedValue({
        lyrics: { ...baseLyrics, restricted: 1 },
      });

      await svc.fetchAndStore(100, 128797629, false, 'normal');

      const call = prisma.globalSongLyrics.upsert.mock.calls[0][0];
      expect(call.create.body).toBe('');
      expect(call.create.body).not.toContain('이 밤');
    });
  });

  describe('defensive handling of malformed mxm responses', () => {
    it('returns NO_LYRICS when body is present but lyrics_id is missing', async () => {
      client.trackLyricsGet.mockResolvedValue({
        lyrics: {
          ...baseLyrics,
          lyrics_id: undefined as unknown as number,
          lyrics_body: '실제 가사',
        },
      });

      const outcome = await svc.fetchAndStore(100, 128797629, false, 'normal');

      expect(outcome).toBe('NO_LYRICS');
      expect(prisma.globalSongLyrics.upsert).not.toHaveBeenCalled();
    });
  });

  describe('RESTRICTED_KR clears stale subtitle/richsync data on update', () => {
    it('UPDATE branch nullifies all body-bearing fields', async () => {
      client.trackLyricsGet.mockResolvedValue({
        lyrics: { ...baseLyrics, restricted: 1 },
      });

      await svc.fetchAndStore(100, 128797629, true, 'normal');

      const call = prisma.globalSongLyrics.upsert.mock.calls[0][0];
      expect(call.update).toEqual(
        expect.objectContaining({
          body: '',
          externalId: null,
          hasSubtitle: false,
          subtitleId: null,
          subtitleBody: null,
          subtitleLength: null,
          hasRichsync: false,
          richsyncId: null,
          richsyncBody: null,
          restrictedKr: true,
        }),
      );
    });
  });

  describe('subtitle restricted', () => {
    it('drops subtitle body when subtitle.restricted=1', async () => {
      client.trackLyricsGet.mockResolvedValue({ lyrics: baseLyrics });
      client.trackSubtitleGet.mockResolvedValue({
        subtitle: { ...baseSubtitle, restricted: 1 },
      });

      const outcome = await svc.fetchAndStore(100, 128797629, true, 'normal');

      expect(outcome).toBe('STORED');
      expect(prisma.globalSongLyrics.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ hasSubtitle: false }),
        }),
      );
    });
  });
});
