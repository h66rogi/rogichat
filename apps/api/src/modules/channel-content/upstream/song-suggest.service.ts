import { Inject, Injectable } from '@nestjs/common';
import Fuse from 'fuse.js';
import { Transactions } from '../../../infrastructure/database/transactions.js';
import { ChannelContentRepository } from '../channel-content.repository.js';

interface SongForFuzzy {
  id: number;
  channelId: number;
  title: string;
  artistName: string;
}

@Injectable()
export class SongSuggestService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository,
  ) {}

  /**
   * 채널의 노래 중 텍스트와 fuzzy matching되는 노래를 추천
   */
  async suggestSongs(
    channelId: number,
    text: string,
    limit: number = 5,
  ): Promise<{ suggestions: Array<{id:number;channelId:number;title:string;artistName:string;score:number}> }> {
    // 1. 채널의 모든 노래 가져오기
    const songs = await this.getSongsForFuzzy(channelId);

    if (songs.length === 0) {
      return { suggestions: [] };
    }

    // 2. 검색어 토큰화 (클립 제목에서 의미있는 키워드 추출)
    const tokens = this.tokenizeText(text);

    if (tokens.length === 0) {
      return { suggestions: [] };
    }

    // 3. Fuse.js로 fuzzy search
    const fuse = new Fuse(songs, {
      keys: [
        { name: 'title', weight: 2 },
        { name: 'artistName', weight: 1.5 },
      ],
      includeScore: true,
      threshold: 0.4, // 더 엄격하게
      ignoreLocation: true,
      minMatchCharLength: 2,
    });

    // 4. 각 토큰으로 검색해서 결과 합산
    const scoreMap = new Map<number, { item: SongForFuzzy; score: number }>();

    for (const token of tokens) {
      const results = fuse.search(token, { limit: limit * 2 });

      for (const result of results) {
        const existing = scoreMap.get(result.item.id);
        const score = result.score !== undefined ? 1 - result.score : 0;

        if (!existing || existing.score < score) {
          scoreMap.set(result.item.id, { item: result.item, score });
        }
      }
    }

    // 5. 점수 순으로 정렬하고 상위 N개 반환
    const suggestions = Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item, score }) => ({
        id: item.id,
        channelId: item.channelId,
        title: item.title,
        artistName: item.artistName,
        score,
      }));

    return { suggestions };
  }

  /**
   * 클립 제목에서 검색 키워드 추출
   * 예: "[클립]모카 - 폰서트 (10cm)" → ["모카", "폰서트", "10cm"]
   */
  private tokenizeText(text: string): string[] {
    // 1. 태그 제거: [클립], [CLIP], [VOD] 등
    const cleaned = text.replace(/\[.*?\]/g, '');

    // 2. 구분자로 분리: -, |, /, (, ), 공백
    const parts = cleaned.split(/[-|/()]+/);

    // 3. 각 파트 정리 및 필터링
    const tokens = parts
      .map((p) => p.trim())
      .filter((p) => p.length >= 2) // 2글자 이상
      .filter((p) => !this.isStopWord(p)); // 불용어 제거

    return tokens;
  }

  /**
   * 불용어 체크 (검색에서 제외할 단어)
   */
  private isStopWord(word: string): boolean {
    const stopWords = [
      'cover',
      'official',
      'mv',
      'music',
      'video',
      'live',
      'ver',
      'version',
      'feat',
      'ft',
      'full',
      'short',
      'shorts',
      '커버',
      '라이브',
      '직캠',
      '풀버전',
    ];
    return stopWords.includes(word.toLowerCase());
  }

  /**
   * 채널의 노래 목록 가져오기
   */
  private async getSongsForFuzzy(channelId: number): Promise<SongForFuzzy[]> {
    return this.transactions.read(async tx => {
      const {roomId} = await this.repository.primary(tx);
      if (channelId !== 1) return [];
      const songs = await tx.prisma.song.findMany({
        where: { channelId:roomId },
        select: {
          id: true,
          title: true,
          artist: { select: { name: true } },
        },
      });
      return songs.map(song => ({id:song.id,channelId:1,title:song.title,artistName:song.artist.name}));
    });
  }
}
