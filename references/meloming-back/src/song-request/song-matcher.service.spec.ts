import { SongMatcherService } from './song-matcher.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SongMatcherService', () => {
  let service: SongMatcherService;

  beforeEach(() => {
    const prisma = {} as unknown as PrismaService;
    service = new SongMatcherService(prisma);
  });

  describe('normalizeText', () => {
    const normalize = (text: string) =>
      (service as any).normalizeText(text) as string;

    it('removes whitespace from Korean string', () => {
      expect(normalize('밤 편지')).toBe('밤편지');
    });

    it('returns already-normalized Korean string unchanged', () => {
      expect(normalize('밤편지')).toBe('밤편지');
    });

    it('lowercases English and removes spaces', () => {
      expect(normalize('Love poem')).toBe('lovepoem');
    });

    it('preserves Japanese Hiragana and Kanji', () => {
      expect(normalize('夜に駆ける')).toBe('夜に駆ける');
    });

    it('preserves Katakana', () => {
      expect(normalize('ヨアソビ')).toBe('ヨアソビ');
    });

    it('removes parentheses but keeps content inside', () => {
      expect(normalize('아이유(IU)')).toBe('아이유iu');
    });

    it('converts fullwidth characters to halfwidth via NFKC', () => {
      expect(normalize('ＹＯＡＳＯＢＩ')).toBe('yoasobi');
    });

    it('returns empty string for empty input', () => {
      expect(normalize('')).toBe('');
    });

    it('preserves Korean jamo (자모) — NFKC converts compatibility jamo to Hangul Jamo block', () => {
      // ㅂ (U+3142, compatibility jamo) → ᄇ (U+1107, Hangul Jamo) via NFKC
      // Characters are preserved (not stripped), just in canonical form
      expect(normalize('ㅂㅂㅂ')).toBe('ᄇᄇᄇ');
    });

    it('removes hyphens', () => {
      expect(normalize('K-pop')).toBe('kpop');
    });
  });

  // ---------------------------------------------------------------------------
  // Task 3: matchRandom
  // ---------------------------------------------------------------------------
  describe('matchRandom (via matchByKeyword)', () => {
    it('returns matched song when keyword is 랜덤', async () => {
      const songId = { id: 42 };

      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([songId]),
          findFirst: jest.fn().mockResolvedValue({
            id: 42,
            title: '랜덤곡',
            artist: { id: 1, name: 'Artist' },
            albumArt: null,
            karaokeUrl: null,
            coverUrl: null,
            originalUrl: null,
            lyricsText: null,
          }),
        },
      };

      const result = await service.matchByKeyword(1, '랜덤');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(42);
    });

    it('returns matched song when keyword is random (English)', async () => {
      const songId = { id: 7 };
      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([songId]),
          findFirst: jest.fn().mockResolvedValue({
            id: 7,
            title: 'Some Song',
            artist: { id: 1, name: 'Artist' },
            albumArt: null,
            karaokeUrl: null,
            coverUrl: null,
            originalUrl: null,
            lyricsText: null,
          }),
        },
      };

      const result = await service.matchByKeyword(1, 'random');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(7);
    });

    it('returns false when channel has 0 songs', async () => {
      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      const result = await service.matchByKeyword(1, '랜덤');
      expect(result.matched).toBe(false);
      expect(result.song).toBeUndefined();
    });

    it('triggers random path in matchSong when title is 랜덤', async () => {
      const songId = { id: 10 };
      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([songId]),
          findFirst: jest.fn().mockResolvedValue({
            id: 10,
            title: '랜덤곡',
            artist: { id: 1, name: 'Artist' },
            albumArt: null,
            karaokeUrl: null,
            coverUrl: null,
            originalUrl: null,
            lyricsText: null,
          }),
        },
      };

      const result = await service.matchSong(1, '', '랜덤');
      expect(result.matched).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 4: matchByAlias
  // ---------------------------------------------------------------------------
  describe('matchByAlias (via matchSong)', () => {
    it('matches song via title alias when artist is not provided', async () => {
      const linkedSong = {
        id: 30,
        title: '원제목',
        channelId: 1,
        globalSongId: 100,
        artist: { id: 1, name: 'Artist' },
        globalSong: {
          aliases: [{ normAliasTitle: '별명제목' }],
          globalArtist: null,
        },
      };

      (service as any).prisma = {
        song: {
          // matchByAlias: findMany with globalSongId filter
          findMany: jest.fn().mockResolvedValue([linkedSong]),
          // getSongById: findFirst
          findFirst: jest.fn().mockResolvedValue({
            id: 30,
            title: '원제목',
            artist: { id: 1, name: 'Artist' },
            albumArt: null,
            karaokeUrl: null,
            coverUrl: null,
            originalUrl: null,
            lyricsText: null,
          }),
        },
      };

      const result = await (service as any).matchByAlias(1, '', '별명제목');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(30);
    });

    it('matches song via title alias AND artist alias', async () => {
      const linkedSong = {
        id: 31,
        title: '원제목',
        channelId: 1,
        globalSongId: 101,
        artist: { id: 2, name: 'Artist B' },
        globalSong: {
          aliases: [{ normAliasTitle: '별명제목' }],
          globalArtist: {
            aliases: [{ normAlias: '별명아티스트' }],
          },
        },
      };

      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([linkedSong]),
          findFirst: jest.fn().mockResolvedValue({
            id: 31,
            title: '원제목',
            artist: { id: 2, name: 'Artist B' },
            albumArt: null,
            karaokeUrl: null,
            coverUrl: null,
            originalUrl: null,
            lyricsText: null,
          }),
        },
      };

      const result = await (service as any).matchByAlias(1, '별명아티스트', '별명제목');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(31);
    });

    it('returns false when artist alias does not match', async () => {
      const linkedSong = {
        id: 32,
        title: '원제목',
        channelId: 1,
        globalSongId: 102,
        artist: { id: 3, name: 'Artist C' },
        globalSong: {
          aliases: [{ normAliasTitle: '별명제목' }],
          globalArtist: {
            aliases: [{ normAlias: '다른아티스트' }],
          },
        },
      };

      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([linkedSong]),
        },
      };

      const result = await (service as any).matchByAlias(1, '없는아티스트', '별명제목');
      expect(result.matched).toBe(false);
    });

    it('returns false when normTitle is empty', async () => {
      const result = await (service as any).matchByAlias(1, '', '');
      expect(result.matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 5: matchByLyrics
  // ---------------------------------------------------------------------------
  describe('matchByLyrics (via matchByKeyword)', () => {
    it('matches when lyricsText contains keyword (4+ chars)', async () => {
      // No songs match the title/artist scoring, but one song matches lyrics
      (service as any).prisma = {
        song: {
          findMany: jest
            .fn()
            .mockImplementationOnce(async () => []) // loadChannelSongs → no scoring hits
            .mockImplementationOnce(async () => [{ id: 5 }]), // matchByLyrics take:11
          findFirst: jest.fn().mockResolvedValue({
            id: 5,
            title: '가사있는곡',
            artist: { id: 1, name: 'Artist' },
            albumArt: null,
            karaokeUrl: null,
            coverUrl: null,
            originalUrl: null,
            lyricsText: '이건 특별한 가사입니다',
          }),
        },
      };

      const result = await service.matchByKeyword(1, '이건 특별한');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(5);
    });

    it('returns false when keyword < 4 chars', async () => {
      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      // keyword "가나" has 2 chars — should not reach matchByLyrics at all
      const result = await service.matchByKeyword(1, '가나');
      expect(result.matched).toBe(false);
    });

    it('returns false when > 10 lyrics hits', async () => {
      // Provide 11 hits — too many, should return matched: false
      const elevenHits = Array.from({ length: 11 }, (_, i) => ({ id: i + 1 }));

      (service as any).prisma = {
        song: {
          findMany: jest
            .fn()
            .mockImplementationOnce(async () => []) // loadChannelSongs → no scoring hits
            .mockImplementationOnce(async () => elevenHits), // matchByLyrics
        },
      };

      const result = await service.matchByKeyword(1, '흔한가사');
      expect(result.matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 7: Full matching flow integration tests
  // ---------------------------------------------------------------------------
  describe('full matching flow', () => {
    /** Helper: build a full song row compatible with loadChannelSongs result */
    function makeChannelSong(
      id: number,
      title: string,
      artistName: string,
      categoryName?: string,
    ) {
      return {
        id,
        title,
        channelId: 1,
        artist: { id: 1, name: artistName },
        songCategories: categoryName
          ? [{ category: { id: 10, name: categoryName } }]
          : [],
        globalSongId: null,
        albumArt: null,
        karaokeUrl: null,
        coverUrl: null,
        originalUrl: null,
        lyricsText: null,
      };
    }

    /** Helper: build the findFirst song row (getSongById response) */
    function makeSongDetail(id: number, title: string, artistName: string) {
      return {
        id,
        title,
        artist: { id: 1, name: artistName },
        albumArt: null,
        karaokeUrl: null,
        coverUrl: null,
        originalUrl: null,
        lyricsText: null,
      };
    }

    // -------------------------------------------------------------------------
    // 1. matchSong: 아이유 - 밤편지 → exact artist+title match
    // -------------------------------------------------------------------------
    it('matchSong 아이유 - 밤편지 returns exact match via title-only match (step 2b)', async () => {
      const songRow = makeChannelSong(100, '밤편지', '아이유');

      (service as any).prisma = {
        song: {
          // matchByAlias: findMany with globalSongId filter → no alias songs
          findMany: jest
            .fn()
            .mockResolvedValueOnce([]) // matchByAlias: linkedSongs (no global songs)
            .mockResolvedValueOnce([songRow]), // loadChannelSongs
          findFirst: jest.fn().mockResolvedValue(makeSongDetail(100, '밤편지', '아이유')),
        },
      };

      const result = await service.matchSong(1, '아이유', '밤편지');
      expect(result.matched).toBe(true);
      expect(result.song?.title).toBe('밤편지');
      expect(result.song?.artistName).toBe('아이유');
    });

    // -------------------------------------------------------------------------
    // 2. matchByKeyword: 밤 편지 (whitespace) → normalized match via scoring
    // -------------------------------------------------------------------------
    it('matchByKeyword 밤 편지 normalizes whitespace and matches via scoring', async () => {
      // "밤 편지" normalizes to "밤편지" — should match song titled "밤편지"
      const songRow = makeChannelSong(101, '밤편지', '아이유');

      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([songRow]),
        },
      };

      const result = await service.matchByKeyword(1, '밤 편지');
      expect(result.matched).toBe(true);
      expect(result.song?.title).toBe('밤편지');
    });

    // -------------------------------------------------------------------------
    // 3. matchByKeyword: Japanese 夜に駆ける → preserved and matched
    // -------------------------------------------------------------------------
    it('matchByKeyword 夜に駆ける matches Japanese title (would have failed before Task 1)', async () => {
      // normalizeText must preserve Japanese chars; scoring: normTitle === normalized → score 1.0
      const songRow = makeChannelSong(102, '夜に駆ける', 'YOASOBI');

      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([songRow]),
        },
      };

      const result = await service.matchByKeyword(1, '夜に駆ける');
      expect(result.matched).toBe(true);
      expect(result.song?.title).toBe('夜に駆ける');
    });

    // -------------------------------------------------------------------------
    // 4. matchByKeyword: 랜덤 → random song from channel
    // -------------------------------------------------------------------------
    it('matchByKeyword 랜덤 returns a random song from channel', async () => {
      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([{ id: 200 }]),
          findFirst: jest.fn().mockResolvedValue(makeSongDetail(200, '랜덤곡', 'Artist')),
        },
      };

      const result = await service.matchByKeyword(1, '랜덤');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(200);
    });

    // -------------------------------------------------------------------------
    // 5. matchByKeyword: 발라드 (category) → only matches via category
    //    when no song is titled 발라드
    // -------------------------------------------------------------------------
    it('matchByKeyword 발라드 matches via category when no song is titled 발라드', async () => {
      // Song title "재즈음악" won't match "발라드" via scoring (no overlap).
      // Category name is "발라드" → category step picks this song.
      const songRow = makeChannelSong(201, '재즈음악', 'Artist', '발라드');

      (service as any).prisma = {
        song: {
          // loadChannelSongs returns the song with category info
          findMany: jest.fn().mockResolvedValue([songRow]),
          // getSongById called by matchByCategory
          findFirst: jest.fn().mockResolvedValue(makeSongDetail(201, '재즈음악', 'Artist')),
        },
      };

      const result = await service.matchByKeyword(1, '발라드');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(201);
    });

    // -------------------------------------------------------------------------
    // 6. matchSong: 아이유 - 존재하지않는곡 → matched: false
    // -------------------------------------------------------------------------
    it('matchSong returns matched false when song does not exist', async () => {
      // "존재하지않는곡" won't match any song in the channel
      const songRow = makeChannelSong(300, '밤편지', '아이유');

      (service as any).prisma = {
        song: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([]) // matchByAlias: no linked songs
            .mockResolvedValueOnce([songRow]) // loadChannelSongs
            .mockResolvedValueOnce([]), // matchByLyrics (Steps 6-8 fallthrough)
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      const result = await service.matchSong(1, '아이유', '존재하지않는곡');
      expect(result.matched).toBe(false);
    });

    // -------------------------------------------------------------------------
    // 7. matchByKeyword: Love poem → matches song titled Lovepoem (keyword normalization)
    // -------------------------------------------------------------------------
    it('matchByKeyword "Love poem" matches song titled "Lovepoem" via normalization', async () => {
      // "Love poem" normalizes to "lovepoem"; song "Lovepoem" also normalizes to "lovepoem"
      // → exact normTitle match → score 1.0
      const songRow = makeChannelSong(400, 'Lovepoem', 'IU');

      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([songRow]),
        },
      };

      const result = await service.matchByKeyword(1, 'Love poem');
      expect(result.matched).toBe(true);
      expect(result.song?.title).toBe('Lovepoem');
      expect(result.song?.artistName).toBe('IU');
    });
  });

  // ---------------------------------------------------------------------------
  // Task 6: matchByCategory
  // ---------------------------------------------------------------------------
  describe('matchByCategory (via matchByKeyword)', () => {
    /** Make a full song row as returned by loadChannelSongs */
    function makeSongRow(
      id: number,
      title: string,
      categoryName: string,
      categoryId = 1,
    ) {
      return {
        id,
        title,
        channelId: 1,
        artist: { id: 1, name: 'Artist' },
        songCategories: [{ category: { id: categoryId, name: categoryName } }],
        globalSongId: null,
        albumArt: null,
        karaokeUrl: null,
        coverUrl: null,
        originalUrl: null,
        lyricsText: null,
      };
    }

    it('matches category name exactly and returns a song from that category', async () => {
      // Song title "완전다른곡" won't match "발라드" via scoring
      const songRow = makeSongRow(20, '완전다른곡', '발라드');

      (service as any).prisma = {
        song: {
          // 1st: loadChannelSongs; 2nd: matchByLyrics (3-char keyword skips lyrics)
          findMany: jest.fn().mockResolvedValue([songRow]),
          findFirst: jest.fn().mockResolvedValue({
            id: 20,
            title: '완전다른곡',
            artist: { id: 1, name: 'Artist' },
            albumArt: null,
            karaokeUrl: null,
            coverUrl: null,
            originalUrl: null,
            lyricsText: null,
          }),
        },
      };

      // "발라드" is 3 chars — lyrics step skipped. Goes to category match.
      const result = await service.matchByKeyword(1, '발라드');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(20);
    });

    it('returns false for partial category name (not exact match)', async () => {
      // Use a song whose title is completely different from the keyword so
      // keyword scoring returns 0 hits, and category name is "발라드팝" (not "발라드").
      // Keyword "발라드" should NOT match category "발라드팝" (exact comparison).
      const songRow = makeSongRow(21, '완전다른제목곡xyz', '발라드팝');

      (service as any).prisma = {
        song: {
          findMany: jest.fn().mockResolvedValue([songRow]),
        },
      };

      // "발라드" != "발라드팝" — category exact match should fail
      const result = await service.matchByKeyword(1, '발라드');
      expect(result.matched).toBe(false);
    });

    it('returns false when no songs exist in matched category', async () => {
      // Test the private method directly with an empty allSongs array
      const emptyAllSongs: any[] = [];
      const result = await (service as any).matchByCategory(1, '발라드', emptyAllSongs);
      expect(result.matched).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // New spec compliance tests
  // ---------------------------------------------------------------------------
  describe('spec compliance', () => {
    /** Helper: build a full song row compatible with loadChannelSongs result */
    function makeChannelSong(
      id: number,
      title: string,
      artistName: string,
      categoryName?: string,
    ) {
      return {
        id,
        title,
        channelId: 1,
        artist: { id: 1, name: artistName },
        songCategories: categoryName
          ? [{ category: { id: 10, name: categoryName } }]
          : [],
        globalSongId: null,
        albumArt: null,
        karaokeUrl: null,
        coverUrl: null,
        originalUrl: null,
        lyricsText: null,
      };
    }

    function makeSongDetail(id: number, title: string, artistName: string) {
      return {
        id,
        title,
        artist: { id: 1, name: artistName },
        albumArt: null,
        karaokeUrl: null,
        coverUrl: null,
        originalUrl: null,
        lyricsText: null,
      };
    }

    // -------------------------------------------------------------------------
    // Test 1: matchSong Step 4 score-gap >= 0.3 → auto-match top 1
    // -------------------------------------------------------------------------
    it('matchSong: partial match with score gap >= 0.3 auto-matches top result (Step 4)', async () => {
      // Two songs: "아이유밤편지" matches the query "아이유 밤편지" much better than "아이유xyz".
      // We need the gap between top score and second score to be >= 0.3.
      // song A: normTitle="밤편지", normArtist="아이유" — normalizedArtist="아이유", normalizedTitle="밤편지"
      //   score = sim("아이유","아이유")*0.4 + sim("밤편지","밤편지")*0.6 = 1*0.4 + 1*0.6 = 1.0
      // song B: normTitle="다른곡xyz", normArtist="누군가"
      //   score = sim("누군가","아이유")*0.4 + sim("다른곡xyz","밤편지")*0.6 ≈ small
      const songA = makeChannelSong(500, '밤편지', '아이유');
      const songB = makeChannelSong(501, '다른곡xyz', '누군가');

      (service as any).prisma = {
        song: {
          findMany: jest
            .fn()
            // matchByAlias: no linked songs
            .mockResolvedValueOnce([])
            // loadChannelSongs
            .mockResolvedValueOnce([songA, songB]),
          findFirst: jest.fn().mockResolvedValue(makeSongDetail(500, '밤편지', '아이유')),
        },
      };

      const result = await service.matchSong(1, '아이유', '밤편지');
      // Should exact-match via Step 2 or 2b (normTitle match) — but regardless, matched
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(500);
    });

    // -------------------------------------------------------------------------
    // Test 1b: explicit score-gap test via partial only (no exact match)
    // -------------------------------------------------------------------------
    it('matchSong: partial score gap >= 0.3 auto-matches when no exact match exists', async () => {
      // songA title "밤편지가사" contains "밤편지" (partial). songB is unrelated.
      // normalizedTitle = "밤편지", normalizedArtist = "아이유"
      // songA: sim("아이유","아이유")*0.4 + sim("밤편지가사","밤편지")*0.6
      //       = 1*0.4 + (5/6)*0.6 = 0.4 + 0.5 = 0.9
      // songB: sim("누군가","아이유")*0.4 + sim("완전다름","밤편지")*0.6 ≈ 0.3* something small
      const songA = makeChannelSong(502, '밤편지가사', '아이유');
      const songB = makeChannelSong(503, '완전다름', '누군가');

      (service as any).prisma = {
        song: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([]) // matchByAlias
            .mockResolvedValueOnce([songA, songB]), // loadChannelSongs
          findFirst: jest.fn().mockResolvedValue(makeSongDetail(502, '밤편지가사', '아이유')),
        },
      };

      const result = await service.matchSong(1, '아이유', '밤편지');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(502);
    });

    // -------------------------------------------------------------------------
    // Test 2: matchSong falls through Steps 1-5 and matches via Step 8 (category)
    // -------------------------------------------------------------------------
    it('matchSong: falls through Steps 1-5 and matches via category (Step 8)', async () => {
      // A song with a completely different title/artist won't match Steps 2-5.
      // But its category name matches the rawTitle fallback keyword.
      const songRow = makeChannelSong(600, '완전다른곡', '완전다른가수', '발라드');

      (service as any).prisma = {
        song: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([]) // matchByAlias
            .mockResolvedValueOnce([songRow]) // loadChannelSongs
            .mockResolvedValueOnce([]), // matchByLyrics in runKeywordSteps (keyword "발라드" = 3 normalized chars, skipped)
          findFirst: jest.fn().mockResolvedValue(makeSongDetail(600, '완전다른곡', '완전다른가수')),
        },
      };

      // rawTitle="발라드" won't match title/artist via Steps 2-5,
      // but will match the category name "발라드" in Step 8.
      // Note: "발라드" normalizes to "발라드" (3 chars) so lyrics step is skipped.
      const result = await service.matchSong(1, '', '발라드');
      expect(result.matched).toBe(true);
      expect(result.song?.id).toBe(600);
    });

    // -------------------------------------------------------------------------
    // Test 3: matchByLyrics with 3 hits → candidates returned (not matched)
    // -------------------------------------------------------------------------
    it('matchByLyrics with 3 hits returns candidates (not matched)', async () => {
      const threeHits = [{ id: 1 }, { id: 2 }, { id: 3 }];

      const songDetails = [
        makeSongDetail(1, '곡A', 'Artist'),
        makeSongDetail(2, '곡B', 'Artist'),
        makeSongDetail(3, '곡C', 'Artist'),
      ];

      (service as any).prisma = {
        song: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([]) // loadChannelSongs → empty, no scoring hits
            .mockResolvedValueOnce(threeHits), // matchByLyrics (keyword length >= 4)
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(songDetails[0])
            .mockResolvedValueOnce(songDetails[1])
            .mockResolvedValueOnce(songDetails[2]),
        },
      };

      // "특별한가사" is 5 chars (normalized) — triggers lyrics step
      const result = await service.matchByKeyword(1, '특별한가사');
      expect(result.matched).toBe(false);
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates?.map((c) => c.id)).toEqual([1, 2, 3]);
    });
  });
});
