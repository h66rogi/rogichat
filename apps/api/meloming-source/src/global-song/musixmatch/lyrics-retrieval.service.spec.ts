import { NotFoundException } from '@nestjs/common';
import { LyricsRetrievalService } from './lyrics-retrieval.service';

describe('LyricsRetrievalService', () => {
  let prisma: any;
  let service: LyricsRetrievalService;

  const baseSong = {
    id: 100,
    title: 'song-title',
    channelId: 7,
    karaokeUrl: null,
    artist: { name: 'channel-artist-name' },
    globalSong: null as any,
  };

  function makeGlobalSong(overrides: Partial<any> = {}) {
    return {
      id: 200,
      title: 'gs-title',
      albumArt: 'http://art',
      mxmAlbumName: 'album',
      mxmTrackLengthSec: 235,
      primaryIsrc: 'KR-XXXX',
      mxmInstrumental: false,
      mxmGenresJson: [{ id: 1, name: 'J-Pop' }],
      matcherStatus: 'MATCHED',
      matcherLastAt: new Date('2026-04-29T00:30:00Z'),
      updatedAt: new Date('2026-04-29T00:45:00Z'),
      globalArtist: { canonicalName: 'gs-artist' },
      lyrics: null as any,
      ...overrides,
    };
  }

  function makeLyrics(overrides: Partial<any> = {}) {
    return {
      body: 'line1\nline2',
      bodyKoPron: null,
      bodyTranslation: null,
      bodyTranslationLanguage: null,
      language: 'en',
      hasSubtitle: false,
      subtitleBody: null,
      hasRichsync: false,
      richsyncBody: null,
      copyrightLine: '©',
      shareUrl: null,
      trackingScript: null,
      trackingPixel: null,
      restrictedKr: false,
      fetchedAt: new Date('2026-04-29T00:00:00Z'),
      updatedAt: new Date('2026-04-29T01:00:00Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      song: { findFirst: jest.fn() },
    };
    service = new LyricsRetrievalService(prisma);
  });

  it('throws NotFound when song not found (id missing or different channel — same response)', async () => {
    prisma.song.findFirst.mockResolvedValue(null);
    await expect(service.getForSongId(1, 7)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getForSongId(1, 7)).rejects.toThrow('Song not found');
  });

  it('uses where: { id, channelId } for permission-first DB filter (no enumeration)', async () => {
    prisma.song.findFirst.mockResolvedValue(null);
    await expect(service.getForSongId(100, 7)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.song.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 100, channelId: 7 } }),
    );
  });

  it('returns UNLINKED when globalSong is null', async () => {
    prisma.song.findFirst.mockResolvedValue({ ...baseSong, globalSong: null });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('UNLINKED');
    expect(r.song).toMatchObject({ id: 100, title: 'song-title', artist: 'channel-artist-name' });
    expect(r.globalSong).toBeUndefined();
    expect(r.lyrics).toBeUndefined();
  });

  it.each(['PENDING', 'UNMATCHED', 'MANUAL_NEEDED', 'IGNORED', 'MATCHED_DUP_OF_OTHER'])(
    'returns UNMATCHED when matcherStatus = %s',
    async (status) => {
      prisma.song.findFirst.mockResolvedValue({
        ...baseSong,
        globalSong: makeGlobalSong({ matcherStatus: status }),
      });
      const r = await service.getForSongId(100, 7);
      expect(r.status).toBe('UNMATCHED');
      expect(r.globalSong).toBeDefined();
      expect(r.lyrics).toBeUndefined();
    },
  );

  it('returns NO_LYRICS (terminal) when matcherStatus = MATCHED_NO_LYRICS', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({ matcherStatus: 'MATCHED_NO_LYRICS' }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('NO_LYRICS');
    expect(r.lyrics).toBeUndefined();
  });

  it('returns INSTRUMENTAL when matcherStatus = MATCHED_INSTRUMENTAL (lyrics row 무관)', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        matcherStatus: 'MATCHED_INSTRUMENTAL',
        mxmInstrumental: false, // matcherStatus 가 authoritative
        lyrics: makeLyrics(),
      }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('INSTRUMENTAL');
    expect(r.lyrics).toBeUndefined();
  });

  it('returns RESTRICTED when matcherStatus = MATCHED_RESTRICTED (lyrics body 비노출, 컬럼 무관)', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        matcherStatus: 'MATCHED_RESTRICTED',
        lyrics: makeLyrics({ restrictedKr: false, body: 'should-not-leak' }),
      }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('RESTRICTED');
    expect(r.lyrics).toBeUndefined();
    expect(r.etagSource).toBeTruthy();
  });

  it('priority: ERROR over lyrics row presence', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        matcherStatus: 'ERROR',
        lyrics: makeLyrics({ restrictedKr: true }),
      }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('ERROR');
  });

  it('priority: matcherStatus MATCHED_RESTRICTED over column restrictedKr=false', async () => {
    // Codex C2 회귀 가드 — matcherStatus 가 authoritative.
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        matcherStatus: 'MATCHED_RESTRICTED',
        lyrics: makeLyrics({ restrictedKr: false }),
      }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('RESTRICTED');
  });

  it('returns ERROR when matcherStatus = ERROR', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({ matcherStatus: 'ERROR' }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('ERROR');
  });

  it('returns INSTRUMENTAL when mxmInstrumental = true', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({ mxmInstrumental: true, lyrics: makeLyrics() }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('INSTRUMENTAL');
    expect(r.lyrics).toBeUndefined();
  });

  it('returns PENDING_LYRICS when MATCHED but lyrics row missing', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({ matcherStatus: 'MATCHED', lyrics: null }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('PENDING_LYRICS');
    expect(r.lyrics).toBeUndefined();
  });

  it('returns RESTRICTED when restrictedKr=true (no body emit)', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        lyrics: makeLyrics({ restrictedKr: true, body: 'should-not-leak' }),
      }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('RESTRICTED');
    expect(r.lyrics).toBeUndefined();
    expect(r.etagSource).toBeTruthy();
  });

  it('returns OK with body + ko_pron + lrc lines when subtitle present', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        lyrics: makeLyrics({
          body: 'verse1\nverse2',
          bodyKoPron: '발음1\n발음2',
          language: 'ja',
          hasSubtitle: true,
          subtitleBody: '[00:01.00]verse1\n[00:05.50]verse2',
        }),
      }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.status).toBe('OK');
    expect(r.lyrics?.body).toBe('verse1\nverse2');
    expect(r.lyrics?.bodyKoPron).toBe('발음1\n발음2');
    expect(r.lyrics?.synced.format).toBe('lrc');
    expect(r.lyrics?.synced.lines).toEqual([
      { startMs: 1_000, text: 'verse1', koPron: '발음1', translation: null },
      { startMs: 5_500, text: 'verse2', koPron: '발음2', translation: null },
    ]);
    // composite etag — globalSong.updatedAt + matcherLastAt + lyrics.updatedAt epoch ms (base36).
    expect(r.etagSource).toBeTruthy();
    expect(r.etagSource).toContain(new Date('2026-04-29T01:00:00Z').getTime().toString(36));
    expect(r.etagSource).toContain(new Date('2026-04-29T00:45:00Z').getTime().toString(36));
    expect(r.etagSource).toContain(new Date('2026-04-29T00:30:00Z').getTime().toString(36));
  });

  it('returns OK with aligned Korean translation lines', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        lyrics: makeLyrics({
          body: 'hello\nworld',
          bodyTranslation: '안녕\n세상',
          bodyTranslationLanguage: 'ko',
          language: 'en',
          hasSubtitle: true,
          subtitleBody: '[00:01.00]hello\n[00:05.50]world',
        }),
      }),
    });

    const r = await service.getForSongId(100, 7);

    expect(r.status).toBe('OK');
    expect(r.lyrics?.bodyTranslation).toBe('안녕\n세상');
    expect(r.lyrics?.bodyTranslationLanguage).toBe('ko');
    expect(r.lyrics?.synced.lines).toEqual([
      { startMs: 1_000, text: 'hello', koPron: null, translation: '안녕' },
      { startMs: 5_500, text: 'world', koPron: null, translation: '세상' },
    ]);
  });

  it('aligns pronunciation and translation when LRC omits blank body lines', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        lyrics: makeLyrics({
          body: 'verse1\n\nverse2\nverse3',
          bodyKoPron: '발음1\n\n발음2\n발음3',
          bodyTranslation: '번역1\n\n번역2\n번역3',
          bodyTranslationLanguage: 'ko',
          language: 'ja',
          hasSubtitle: true,
          subtitleBody: '[00:01.00]verse1\n[00:03.00]\n[00:05.50]verse2\n[00:08.00]verse3',
        }),
      }),
    });

    const r = await service.getForSongId(100, 7);

    expect(r.status).toBe('OK');
    expect(r.lyrics?.synced.lines).toEqual([
      { startMs: 1_000, text: 'verse1', koPron: '발음1', translation: '번역1' },
      { startMs: 3_000, text: '', koPron: null, translation: null },
      { startMs: 5_500, text: 'verse2', koPron: '발음2', translation: '번역2' },
      { startMs: 8_000, text: 'verse3', koPron: '발음3', translation: '번역3' },
    ]);
  });

  it('does not include richsync by default', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        lyrics: makeLyrics({
          hasRichsync: true,
          richsyncBody: '[{"ts":0,"l":[{"c":"hi"}]}]',
        }),
      }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.lyrics?.hasRichsync).toBe(true);
    expect(r.lyrics?.richsync).toBeNull();
  });

  it('includes richsync when includeRichsync=true', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        lyrics: makeLyrics({
          hasRichsync: true,
          richsyncBody: '[{"ts":0,"l":[{"c":"hi"}]}]',
        }),
      }),
    });
    const r = await service.getForSongId(100, 7, { includeRichsync: true });
    expect(r.lyrics?.richsync).toEqual([{ ts: 0, l: [{ c: 'hi' }] }]);
  });

  it('falls back to null richsync on JSON parse error', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({
        lyrics: makeLyrics({ hasRichsync: true, richsyncBody: 'NOT_JSON' }),
      }),
    });
    const r = await service.getForSongId(100, 7, { includeRichsync: true });
    expect(r.lyrics?.richsync).toBeNull();
  });

  it.each([
    [null, null, 'null'],
    [[], [], 'empty array'],
    [[{ id: 1, name: 'J-Pop', vanity: 'j-pop' }], [{ id: 1, name: 'J-Pop', vanity: 'j-pop' }], 'valid array'],
    [{ id: 1 }, null, 'object (not array) → null'],
    ['rock', null, 'string scalar → null'],
    [42, null, 'number scalar → null'],
    [[{ id: 'not-num', name: 5 }], [{}], 'array with wrong types → empty objects'],
    [[null, 'str', { id: 1 }], [{ id: 1 }], 'mixed array → only valid object retained'],
  ])('genres normalization: %s → %s (%s)', async (input, expected) => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({ mxmGenresJson: input }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.globalSong?.genres).toEqual(expected);
  });

  it('OK with no subtitle returns synced.lines = null', async () => {
    prisma.song.findFirst.mockResolvedValue({
      ...baseSong,
      globalSong: makeGlobalSong({ lyrics: makeLyrics({ hasSubtitle: false }) }),
    });
    const r = await service.getForSongId(100, 7);
    expect(r.lyrics?.synced.format).toBeNull();
    expect(r.lyrics?.synced.lines).toBeNull();
  });
});
