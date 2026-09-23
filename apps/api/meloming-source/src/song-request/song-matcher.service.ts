import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MatchedSong {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  albumArt?: string | null;
  karaokeUrl?: string | null;
  coverUrl?: string | null;
  originalUrl?: string | null;
  lyricsText?: string | null;
}

export interface SongMatchResult {
  matched: boolean;
  song?: MatchedSong;
  candidates?: MatchedSong[];
}

@Injectable()
export class SongMatcherService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 채널의 모든 곡을 한 번에 로드합니다.
   */
  private async loadChannelSongs(channelId: number) {
    return this.prisma.song.findMany({
      where: { channelId },
      select: {
        id: true,
        title: true,
        channelId: true,
        artist: { select: { id: true, name: true } },
        songCategories: {
          select: { category: { select: { id: true, name: true } } },
        },
        globalSongId: true,
        albumArt: true,
        karaokeUrl: true,
        coverUrl: true,
        originalUrl: true,
      },
    });
  }

  /**
   * 로드된 곡 배열에 정규화된 인덱스를 추가합니다.
   */
  private indexSongs(songs: Awaited<ReturnType<typeof this.loadChannelSongs>>) {
    return songs.map((song) => ({
      song,
      normTitle: this.normalizeText(song.title),
      normArtist: this.normalizeText(song.artist.name),
    }));
  }

  /**
   * 키워드가 랜덤 신청인지 확인합니다.
   */
  private isRandomKeyword(normalized: string): boolean {
    return normalized === '랜덤' || normalized === 'random';
  }

  /**
   * 채널에서 랜덤으로 노래를 선택합니다.
   */
  private async matchRandom(channelId: number): Promise<SongMatchResult> {
    const songIds = await this.prisma.song.findMany({
      where: { channelId },
      select: { id: true },
    });
    if (songIds.length === 0) return { matched: false };
    const pick = songIds[Math.floor(Math.random() * songIds.length)];
    const song = await this.getSongById(channelId, pick.id);
    return song ? { matched: true, song } : { matched: false };
  }

  /**
   * GlobalSongAlias를 통해 노래를 검색합니다.
   */
  private async matchByAlias(
    channelId: number,
    normArtist: string,
    normTitle: string,
  ): Promise<SongMatchResult> {
    if (!normTitle) return { matched: false };

    const linkedSongs = await this.prisma.song.findMany({
      where: { channelId, globalSongId: { not: null } },
      include: {
        artist: true,
        globalSong: {
          include: {
            aliases: true,
            globalArtist: { include: { aliases: true } },
          },
        },
      },
    });

    for (const song of linkedSongs) {
      if (!song.globalSong) continue;
      const titleAliases =
        song.globalSong.aliases?.map((a) => a.normAliasTitle) ?? [];
      if (!titleAliases.includes(normTitle)) continue;

      if (normArtist) {
        const artistAliases =
          song.globalSong.globalArtist?.aliases?.map((a) => a.normAlias) ?? [];
        if (!artistAliases.includes(normArtist)) continue;
      }

      const matched = await this.getSongById(channelId, song.id);
      return matched ? { matched: true, song: matched } : { matched: false };
    }
    return { matched: false };
  }

  /**
   * 채널의 노래책에서 아티스트와 제목으로 노래를 검색합니다.
   * 정확히 일치하는 노래가 있으면 반환하고, 없으면 유사한 후보를 반환합니다.
   */
  async matchSong(
    channelId: number,
    rawArtist: string,
    rawTitle: string,
  ): Promise<SongMatchResult> {
    const normalizedArtist = this.normalizeText(rawArtist);
    const normalizedTitle = this.normalizeText(rawTitle);

    // Step 0: Random
    if (this.isRandomKeyword(normalizedTitle)) {
      return this.matchRandom(channelId);
    }

    // Step 1: Alias
    const aliasResult = await this.matchByAlias(
      channelId,
      normalizedArtist,
      normalizedTitle,
    );
    if (aliasResult.matched) return aliasResult;

    const allSongs = await this.loadChannelSongs(channelId);
    const indexed = this.indexSongs(allSongs);

    // Step 2: 아티스트 + 제목 완전 일치
    const exactMatch = indexed.find(
      (item) =>
        item.normTitle === normalizedTitle &&
        item.normArtist === normalizedArtist,
    );
    if (exactMatch) {
      const result = await this.getSongById(channelId, exactMatch.song.id);
      if (result) return { matched: true, song: result };
    }

    // Step 2b: 제목만 완전 일치
    const titleOnlyExact = indexed.find(
      (item) => item.normTitle === normalizedTitle,
    );
    if (titleOnlyExact) {
      const result = await this.getSongById(channelId, titleOnlyExact.song.id);
      if (result) return { matched: true, song: result };
    }

    // Step 3: artist↔title 스왑 후 완전 일치
    const swapExact = indexed.find(
      (item) =>
        item.normTitle === normalizedArtist &&
        item.normArtist === normalizedTitle,
    );
    if (swapExact) {
      const result = await this.getSongById(channelId, swapExact.song.id);
      if (result) return { matched: true, song: result };
    }

    // Step 4: 부분 매칭 (원래 순서)
    const partialScored = indexed
      .map((item) => ({
        item,
        score:
          this.calculateSimilarity(item.normArtist, normalizedArtist) * 0.4 +
          this.calculateSimilarity(item.normTitle, normalizedTitle) * 0.6,
      }))
      .filter((x) => x.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (partialScored.length === 1) {
      const result = await this.getSongById(
        channelId,
        partialScored[0].item.song.id,
      );
      if (result) return { matched: true, song: result };
    } else if (
      partialScored.length > 1 &&
      partialScored[0].score - partialScored[1].score >= 0.3
    ) {
      const result = await this.getSongById(
        channelId,
        partialScored[0].item.song.id,
      );
      if (result) return { matched: true, song: result };
    } else if (partialScored.length > 1) {
      const candidates = (
        await Promise.all(
          partialScored.map((x) => this.getSongById(channelId, x.item.song.id)),
        )
      ).filter((s): s is MatchedSong => s !== null);
      return { matched: false, candidates };
    }

    // Step 5: 부분 매칭 (스왑 순서)
    const swapPartialScored = indexed
      .map((item) => ({
        item,
        score:
          this.calculateSimilarity(item.normArtist, normalizedTitle) * 0.4 +
          this.calculateSimilarity(item.normTitle, normalizedArtist) * 0.6,
      }))
      .filter((x) => x.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (swapPartialScored.length === 1) {
      const result = await this.getSongById(
        channelId,
        swapPartialScored[0].item.song.id,
      );
      if (result) return { matched: true, song: result };
    } else if (
      swapPartialScored.length > 1 &&
      swapPartialScored[0].score - swapPartialScored[1].score >= 0.3
    ) {
      const result = await this.getSongById(
        channelId,
        swapPartialScored[0].item.song.id,
      );
      if (result) return { matched: true, song: result };
    } else if (swapPartialScored.length > 1) {
      const candidates = (
        await Promise.all(
          swapPartialScored.map((x) =>
            this.getSongById(channelId, x.item.song.id),
          ),
        )
      ).filter((s): s is MatchedSong => s !== null);
      return { matched: false, candidates };
    }

    // Steps 6-8: keyword fallthrough (use rawTitle || rawArtist as keyword)
    const fallbackKeyword = rawTitle || rawArtist;
    return this.runKeywordSteps(channelId, fallbackKeyword, allSongs);
  }

  /**
   * 단일 키워드로 노래를 검색합니다 (채팅에서 구분자 없이 입력한 경우).
   * 제목 또는 아티스트명에 키워드가 포함된 곡을 찾고, 결과가 1개면 자동 매칭합니다.
   * 정규화된 값끼리 비교하여 raw/normalized 불일치 버그를 수정합니다.
   */
  async matchByKeyword(
    channelId: number,
    keyword: string,
  ): Promise<SongMatchResult> {
    const normalized = this.normalizeText(keyword);
    if (!normalized) return { matched: false };

    // Step 0: Random
    if (this.isRandomKeyword(normalized)) {
      return this.matchRandom(channelId);
    }

    const allSongs = await this.loadChannelSongs(channelId);
    const indexed = this.indexSongs(allSongs);

    // 정규화된 값끼리 비교 — raw LIKE 쿼리 버그 수정
    const scored = indexed
      .map(({ song, normTitle, normArtist }) => {
        let score = 0;
        if (normTitle === normalized) score = 1.0;
        else if (normTitle.includes(normalized))
          score = normalized.length / normTitle.length;
        else if (normArtist === normalized) score = 0.5;
        else if (normArtist.includes(normalized))
          score = 0.3 * (normalized.length / normArtist.length);
        return { song, score };
      })
      .filter((item) => item.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (scored.length === 1) {
      return { matched: true, song: this.mapToMatchedSong(scored[0].song) };
    }

    if (scored.length > 1) {
      // 최고 점수가 두 번째와 큰 차이가 나면 (0.3 이상) 최고 점수를 자동 매칭
      if (scored[0].score - scored[1].score >= 0.3) {
        return { matched: true, song: this.mapToMatchedSong(scored[0].song) };
      }
      return {
        matched: false,
        candidates: scored.map((s) => this.mapToMatchedSong(s.song)),
      };
    }

    return this.runKeywordSteps(channelId, keyword, allSongs);
  }

  /**
   * Steps 6-8: lyrics search → category match fallback.
   * Used both from matchByKeyword (after scoring) and matchSong (after Steps 4/5).
   */
  private async runKeywordSteps(
    channelId: number,
    keyword: string,
    allSongs: Awaited<ReturnType<typeof this.loadChannelSongs>>,
  ): Promise<SongMatchResult> {
    const normalized = this.normalizeText(keyword);

    // Step 7: Lyrics (4+ normalized chars only)
    if (normalized.length >= 4) {
      const lyricsResult = await this.matchByLyrics(channelId, normalized);
      if (lyricsResult.matched || lyricsResult.candidates?.length)
        return lyricsResult;
    }

    // Step 8: Category match
    const categoryResult = await this.matchByCategory(
      channelId,
      keyword,
      allSongs,
    );
    if (categoryResult.matched) return categoryResult;

    return { matched: false };
  }

  /**
   * 카테고리 이름으로 노래를 검색하고 랜덤으로 선택합니다.
   */
  private async matchByCategory(
    channelId: number,
    keyword: string,
    allSongs: Awaited<ReturnType<typeof this.loadChannelSongs>>,
  ): Promise<SongMatchResult> {
    const matchedCat = allSongs
      .flatMap((s) => s.songCategories)
      .find((sc) => sc.category.name === keyword);

    if (!matchedCat) return { matched: false };

    const songsInCat = allSongs.filter((s) =>
      s.songCategories.some((sc) => sc.category.id === matchedCat.category.id),
    );
    if (songsInCat.length === 0) return { matched: false };

    const pick = songsInCat[Math.floor(Math.random() * songsInCat.length)];
    const song = await this.getSongById(channelId, pick.id);
    return song ? { matched: true, song } : { matched: false };
  }

  /**
   * 가사 텍스트로 노래를 검색합니다.
   * - 1개: 자동 매칭
   * - 2-10개: candidates 반환 (matched: false)
   * - 11개 이상: 일반 키워드로 판단, 무시
   * @param normalized 이미 정규화된 검색어
   */
  private async matchByLyrics(
    channelId: number,
    normalized: string,
  ): Promise<SongMatchResult> {
    const hits = await this.prisma.song.findMany({
      where: { channelId, lyricsText: { contains: normalized } },
      select: { id: true },
      take: 11,
    });
    if (hits.length === 0 || hits.length > 10) return { matched: false };
    if (hits.length === 1) {
      const song = await this.getSongById(channelId, hits[0].id);
      return song ? { matched: true, song } : { matched: false };
    }
    // 2-10 hits: return candidates without auto-matching
    const candidates = (
      await Promise.all(hits.map((h) => this.getSongById(channelId, h.id)))
    ).filter((s): s is MatchedSong => s !== null);
    return { matched: false, candidates };
  }

  /**
   * 노래 ID로 직접 조회합니다.
   */
  async getSongById(
    channelId: number,
    songId: number,
  ): Promise<MatchedSong | null> {
    const song = await this.prisma.song.findFirst({
      where: {
        id: songId,
        channelId,
      },
      include: {
        artist: true,
      },
    });

    if (!song) {
      return null;
    }

    return this.mapToMatchedSong(song);
  }

  /**
   * 텍스트를 정규화합니다 (소문자, 공백 제거, 특수문자 제거).
   */
  private normalizeText(text: string): string {
    if (!text) return '';
    return text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\-_]/g, '')
      .replace(
        /[^\w가-힣\u1100-\u11FF\u3131-\u3163ぁ-んァ-ヺー〜\u4E00-\u9FFF\u3400-\u4DBF]/g,
        '',
      );
  }

  /**
   * 두 문자열의 유사도를 계산합니다 (0~1).
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (!str1 || !str2) return 0;

    // 포함 관계 확인
    if (str1.includes(str2) || str2.includes(str1)) {
      const shorter = str1.length < str2.length ? str1 : str2;
      const longer = str1.length < str2.length ? str2 : str1;
      return shorter.length / longer.length;
    }

    // Levenshtein 거리 기반 유사도
    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - distance / maxLength;
  }

  /**
   * Levenshtein 거리를 계산합니다.
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }

    return dp[m][n];
  }

  /**
   * Prisma Song 객체를 MatchedSong으로 변환합니다.
   */
  private mapToMatchedSong(song: {
    id: number;
    title: string;
    artist: { id: number; name: string };
    albumArt?: string | null;
    karaokeUrl?: string | null;
    coverUrl?: string | null;
    originalUrl?: string | null;
    lyricsText?: string | null;
  }): MatchedSong {
    return {
      id: song.id,
      title: song.title,
      artistId: song.artist.id,
      artistName: song.artist.name,
      albumArt: song.albumArt,
      karaokeUrl: song.karaokeUrl,
      coverUrl: song.coverUrl,
      originalUrl: song.originalUrl,
      lyricsText: song.lyricsText,
    };
  }
}
