import { PrismaService } from '../prisma/prisma.service';
import { LlmMatcherService } from '../song-request/v2/llm-matcher.service';
import { GlobalSongMatcherService } from './global-song-matcher.service';

type MockPrisma = {
  globalSongAlias: { findMany: jest.Mock };
  globalSong: { findMany: jest.Mock };
  globalArtistAlias: { findMany: jest.Mock };
  globalSongLyrics: { findMany: jest.Mock };
};

const buildPrisma = (): MockPrisma => ({
  globalSongAlias: { findMany: jest.fn().mockResolvedValue([]) },
  globalSong: { findMany: jest.fn().mockResolvedValue([]) },
  globalArtistAlias: { findMany: jest.fn().mockResolvedValue([]) },
  globalSongLyrics: { findMany: jest.fn().mockResolvedValue([]) },
});

const buildLlm = (): {
  isConfigured: jest.Mock;
  matchGlobalSong: jest.Mock;
} => ({
  isConfigured: jest.fn().mockReturnValue(true),
  matchGlobalSong: jest
    .fn()
    .mockResolvedValue({ matchedGlobalSongId: null, confidence: 0 }),
});

describe('GlobalSongMatcherService', () => {
  let prisma: MockPrisma;
  let llm: ReturnType<typeof buildLlm>;
  let service: GlobalSongMatcherService;

  beforeEach(() => {
    prisma = buildPrisma();
    llm = buildLlm();
    service = new GlobalSongMatcherService(
      prisma as unknown as PrismaService,
      llm as unknown as LlmMatcherService,
    );
  });

  it('빈 쿼리는 null', async () => {
    const r = await service.matchGlobalSong({ channelId: 1, rawQuery: '   ' });
    expect(r).toBeNull();
  });

  it('alias 정확 일치 시 confidence 1.0 + autoAcceptable=true', async () => {
    prisma.globalSongAlias.findMany.mockResolvedValue([
      {
        globalSong: {
          id: 11,
          title: '소나기',
          globalArtistId: 7,
          channelCount: 50,
          globalArtist: { canonicalName: '윤하', normKey: '윤하' },
        },
      },
    ]);

    const r = await service.matchGlobalSong({
      channelId: 1,
      rawQuery: '잠깐 오는 비',
    });

    expect(r).not.toBeNull();
    expect(r!.globalSong).toEqual({
      id: 11,
      title: '소나기',
      canonicalArtistName: '윤하',
    });
    expect(r!.confidence).toBe(1);
    expect(r!.autoAcceptable).toBe(true);
    expect(llm.matchGlobalSong).not.toHaveBeenCalled();
  });

  it('alias 여러 개 + artist 명시 시 normKey 일치 우선', async () => {
    prisma.globalSongAlias.findMany.mockResolvedValue([
      {
        globalSong: {
          id: 1,
          title: 'A',
          globalArtistId: 1,
          channelCount: 100,
          globalArtist: { canonicalName: '아티스트X', normKey: '아티스트x' },
        },
      },
      {
        globalSong: {
          id: 2,
          title: 'A',
          globalArtistId: 2,
          channelCount: 30,
          globalArtist: { canonicalName: '아이유', normKey: '아이유' },
        },
      },
    ]);

    const r = await service.matchGlobalSong({
      channelId: 1,
      rawQuery: '아이유 - 노래',
    });

    expect(r!.globalSong.id).toBe(2);
    expect(r!.globalSong.canonicalArtistName).toBe('아이유');
  });

  it('alias 미스 → normTitle 정확 일치 → confidence 0.95', async () => {
    prisma.globalSong.findMany.mockImplementation(({ where }) => {
      if (where.normTitle === '밤편지') {
        return Promise.resolve([
          {
            id: 22,
            title: '밤편지',
            globalArtistId: 5,
            channelCount: 200,
            globalArtist: { canonicalName: '아이유', normKey: '아이유' },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const r = await service.matchGlobalSong({
      channelId: 1,
      rawQuery: '밤편지',
    });

    expect(r!.globalSong.id).toBe(22);
    expect(r!.confidence).toBe(0.95);
    expect(r!.autoAcceptable).toBe(true);
  });

  it('jamo top score >=0.85 + 다음 후보와 gap >=0.05 시 그대로 채택 (LLM 호출 X)', async () => {
    // alias / normTitle 미스
    prisma.globalSong.findMany.mockImplementation(({ where }) => {
      // exact match 시도
      if (where.normTitle && typeof where.normTitle === 'string') {
        return Promise.resolve([]);
      }
      // jamo pool — startsWith
      if (
        where.normTitle &&
        typeof where.normTitle === 'object' &&
        typeof where.normTitle.startsWith === 'string'
      ) {
        return Promise.resolve([
          {
            id: 33,
            title: '밤편지',
            normTitle: '밤편지',
            globalArtistId: 5,
            channelCount: 200,
            globalArtist: { canonicalName: '아이유', normKey: '아이유' },
          },
          {
            id: 34,
            title: '밤편지를',
            normTitle: '밤편지를',
            globalArtistId: 9,
            channelCount: 1,
            globalArtist: { canonicalName: '다른가수', normKey: '다른가수' },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const r = await service.matchGlobalSong({
      channelId: 1,
      rawQuery: '밤편지',
    });

    expect(r!.globalSong.id).toBe(33);
    expect(r!.confidence).toBeGreaterThanOrEqual(0.85);
    expect(r!.autoAcceptable).toBe(true);
    expect(llm.matchGlobalSong).not.toHaveBeenCalled();
  });

  it('LLM이 후보 중 하나 선택 시 그 confidence로 finalize', async () => {
    prisma.globalSong.findMany.mockImplementation(({ where }) => {
      if (
        where.normTitle &&
        typeof where.normTitle === 'object' &&
        typeof where.normTitle.startsWith === 'string'
      ) {
        return Promise.resolve([
          {
            id: 50,
            title: '소나기',
            normTitle: '소나기',
            globalArtistId: 7,
            channelCount: 100,
            globalArtist: { canonicalName: '윤하', normKey: '윤하' },
          },
          {
            id: 51,
            title: '소나기2',
            normTitle: '소나기2',
            globalArtistId: 8,
            channelCount: 10,
            globalArtist: { canonicalName: '다른', normKey: '다른' },
          },
        ]);
      }
      return Promise.resolve([]);
    });
    llm.matchGlobalSong.mockResolvedValue({
      matchedGlobalSongId: 50,
      confidence: 0.88,
      reasoning: '잠깐 오는 비 = 소나기 (paraphrase)',
    });

    const r = await service.matchGlobalSong({
      channelId: 1,
      rawQuery: '잠깐 오는 비',
    });

    expect(r!.globalSong.id).toBe(50);
    expect(r!.confidence).toBe(0.88);
    expect(r!.autoAcceptable).toBe(true);
    expect(llm.matchGlobalSong).toHaveBeenCalled();
  });

  it('LLM 미설정 + jamo top이 단독 accept 안 되면 fallback에서 0.79로 cap → autoAcceptable=false', async () => {
    llm.isConfigured.mockReturnValue(false);
    // 두 후보 모두 score 비슷 → top - next < 0.05 → 단독 accept 실패 → LLM 단계 → 미설정 → fallback cap
    prisma.globalSong.findMany.mockImplementation(({ where }) => {
      if (
        where.normTitle &&
        typeof where.normTitle === 'object' &&
        typeof where.normTitle.startsWith === 'string'
      ) {
        return Promise.resolve([
          {
            id: 60,
            title: '밤펴지',
            normTitle: '밤펴지',
            globalArtistId: 5,
            channelCount: 5,
            globalArtist: { canonicalName: '아이유', normKey: '아이유' },
          },
          {
            id: 61,
            title: '밤편자',
            normTitle: '밤편자',
            globalArtistId: 5,
            channelCount: 4,
            globalArtist: { canonicalName: '아이유', normKey: '아이유' },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    const r = await service.matchGlobalSong({
      channelId: 1,
      rawQuery: '밤편지',
    });

    expect(r).not.toBeNull();
    expect(r!.confidence).toBeLessThan(0.8);
    expect(r!.autoAcceptable).toBe(false);
    expect(llm.matchGlobalSong).not.toHaveBeenCalled();
  });

  it('아무 단계도 매칭 못하면 null', async () => {
    const r = await service.matchGlobalSong({
      channelId: 1,
      rawQuery: 'zzzqqqxxx',
    });
    expect(r).toBeNull();
  });

  it('AUTO_THRESHOLD=0.8 (신청보다 보수적)', () => {
    expect(GlobalSongMatcherService.AUTO_THRESHOLD).toBe(0.8);
  });
});
