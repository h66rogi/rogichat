import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics';
import {
  GlobalSongMatcherService,
  MatchGlobalSongResult,
} from './global-song-matcher.service';
import { LlmCategoryDifficultyJudgeService } from './llm-category-difficulty-judge.service';
import { CacheKeyTrackingService } from '../redis/cache-key-tracking.service';
import { SongbookAddService } from './songbook-add.service';

const buildMatched = (
  overrides?: Partial<MatchGlobalSongResult>,
): MatchGlobalSongResult => ({
  globalSong: { id: 100, title: '소나기', canonicalArtistName: '윤하' },
  confidence: 0.92,
  autoAcceptable: true,
  trace: [],
  ...overrides,
});

type TxApi = {
  artist: { findFirst: jest.Mock; create: jest.Mock };
  song: { findFirst: jest.Mock; create: jest.Mock };
  songCategory: { create: jest.Mock };
};

const buildPrisma = () => {
  const tx: TxApi = {
    artist: { findFirst: jest.fn(), create: jest.fn() },
    song: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    songCategory: { create: jest.fn() },
  };
  return {
    prisma: {
      song: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (tx: TxApi) => Promise<unknown>) =>
        fn(tx),
      ),
    },
    tx,
  };
};

describe('SongbookAddService', () => {
  let prisma: ReturnType<typeof buildPrisma>['prisma'];
  let tx: TxApi;
  let matcher: { matchGlobalSong: jest.Mock };
  let judge: { decide: jest.Mock };
  let service: SongbookAddService;

  beforeEach(() => {
    const built = buildPrisma();
    prisma = built.prisma;
    tx = built.tx;
    matcher = { matchGlobalSong: jest.fn().mockResolvedValue(buildMatched()) };
    judge = {
      decide: jest.fn().mockResolvedValue({
        categoryId: 7,
        difficulty: 3,
        llmCalled: true,
        usedAvgDifficulty: false,
        reasoning: 'ok',
      }),
    };
    service = new SongbookAddService(
      prisma as unknown as PrismaService,
      matcher as unknown as GlobalSongMatcherService,
      judge as unknown as LlmCategoryDifficultyJudgeService,
      {
        songbookAddLatencySeconds: {
          labels: jest.fn().mockReturnValue({ observe: jest.fn() }),
        },
        songbookAddLlmJudgeCallsTotal: { inc: jest.fn() },
      } as unknown as MetricsService,
      {
        clearChannel: jest.fn().mockResolvedValue(0),
        clearChannelSafe: jest.fn().mockResolvedValue(undefined),
      } as unknown as CacheKeyTrackingService,
    );
  });

  it('정상 흐름: artist findFirst hit + song create + category create', async () => {
    tx.artist.findFirst.mockResolvedValue({ id: 50, name: '윤하' });
    tx.song.create.mockResolvedValue({ id: 999, title: '소나기' });

    const r = await service.add({
      channelId: 1,
      query: '잠깐 오는 비',
      requesterUserId: 100,
    });

    expect(tx.artist.create).not.toHaveBeenCalled();
    expect(tx.song.create).toHaveBeenCalledWith({
      data: {
        channelId: 1,
        title: '소나기',
        artistId: 50,
        globalSongId: 100,
        difficulty: 3,
      },
      select: expect.any(Object),
    });
    expect(tx.songCategory.create).toHaveBeenCalledWith({
      data: { songId: 999, categoryId: 7 },
    });
    expect(r).toEqual(
      expect.objectContaining({
        songId: 999,
        globalSongId: 100,
        title: '소나기',
        artistName: '윤하',
        difficulty: 3,
        categoryId: 7,
        confidence: 0.92,
      }),
    );
  });

  it('artist 없으면 create', async () => {
    tx.artist.findFirst.mockResolvedValue(null);
    tx.artist.create.mockResolvedValue({ id: 51, name: '윤하' });
    tx.song.create.mockResolvedValue({ id: 1000, title: '소나기' });

    const r = await service.add({
      channelId: 1,
      query: '잠깐 오는 비',
      requesterUserId: 100,
    });

    expect(tx.artist.create).toHaveBeenCalledWith({
      data: { channelId: 1, name: '윤하' },
      select: expect.any(Object),
    });
    expect(r.artistName).toBe('윤하');
  });

  it('categoryId=null 이면 SongCategory 생성 X', async () => {
    judge.decide.mockResolvedValue({
      categoryId: null,
      difficulty: 3,
      llmCalled: true,
      usedAvgDifficulty: false,
    });
    tx.artist.findFirst.mockResolvedValue({ id: 50, name: '윤하' });
    tx.song.create.mockResolvedValue({ id: 999, title: '소나기' });

    await service.add({
      channelId: 1,
      query: '잠깐 오는 비',
      requesterUserId: 100,
    });

    expect(tx.songCategory.create).not.toHaveBeenCalled();
  });

  it('matcher null → BadRequestException(NO_MATCH)', async () => {
    matcher.matchGlobalSong.mockResolvedValue(null);

    await expect(
      service.add({ channelId: 1, query: 'qqq', requesterUserId: 100 }),
    ).rejects.toMatchObject({
      response: { code: 'NO_MATCH' },
    });
    expect(prisma.song.findFirst).not.toHaveBeenCalled();
  });

  it('autoAcceptable=false → BadRequestException(LOW_CONFIDENCE)', async () => {
    matcher.matchGlobalSong.mockResolvedValue(
      buildMatched({ autoAcceptable: false, confidence: 0.6 }),
    );

    await expect(
      service.add({ channelId: 1, query: '...', requesterUserId: 100 }),
    ).rejects.toMatchObject({
      response: {
        code: 'LOW_CONFIDENCE',
        confidence: 0.6,
        candidateTitle: '소나기',
        candidateArtist: '윤하',
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('이미 등록된 곡 (globalSongId 일치) → ConflictException(ALREADY_IN_SONGBOOK)', async () => {
    prisma.song.findFirst.mockResolvedValue({
      id: 555,
      title: '소나기',
      artist: { name: '윤하' },
    });

    await expect(
      service.add({ channelId: 1, query: '잠깐 오는 비', requesterUserId: 100 }),
    ).rejects.toMatchObject({
      response: {
        code: 'ALREADY_IN_SONGBOOK',
        title: '소나기',
        artistName: '윤하',
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('매칭 실패 시 judge 호출하지 않음 (LLM 비용 절약)', async () => {
    matcher.matchGlobalSong.mockResolvedValue(null);

    try {
      await service.add({ channelId: 1, query: 'qqq', requesterUserId: 100 });
    } catch {}

    expect(judge.decide).not.toHaveBeenCalled();
  });

  it('Conflict인 경우에도 judge 호출하지 않음', async () => {
    prisma.song.findFirst.mockResolvedValue({
      id: 555,
      title: '소나기',
      artist: { name: '윤하' },
    });

    try {
      await service.add({
        channelId: 1,
        query: '잠깐 오는 비',
        requesterUserId: 100,
      });
    } catch {}

    expect(judge.decide).not.toHaveBeenCalled();
  });
});

describe('Exception classes', () => {
  it('BadRequestException(NO_MATCH) is BadRequestException', () => {
    expect(new BadRequestException({ code: 'NO_MATCH' })).toBeInstanceOf(
      BadRequestException,
    );
  });
  it('ConflictException(ALREADY_IN_SONGBOOK) is ConflictException', () => {
    expect(
      new ConflictException({ code: 'ALREADY_IN_SONGBOOK' }),
    ).toBeInstanceOf(ConflictException);
  });
});
