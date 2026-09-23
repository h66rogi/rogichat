import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LlmCategoryDifficultyJudgeService } from './llm-category-difficulty-judge.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type MockPrisma = {
  category: { findMany: jest.Mock };
  song: { findMany: jest.Mock };
};

const buildPrisma = (): MockPrisma => ({
  category: { findMany: jest.fn().mockResolvedValue([]) },
  song: { findMany: jest.fn().mockResolvedValue([]) },
});

const buildConfig = (apiKey: string): ConfigService =>
  ({
    get: jest.fn((key: string) => {
      if (key === 'OPENROUTER_API_KEY') return apiKey;
      if (key === 'FUZZY_CHAT_DETECTION_LLM_MODEL') return 'test/model';
      return undefined;
    }),
  }) as unknown as ConfigService;

const buildService = (
  prisma: MockPrisma,
  apiKey: string,
  httpPost?: jest.Mock,
): LlmCategoryDifficultyJudgeService => {
  const post = httpPost ?? jest.fn();
  mockedAxios.create.mockReturnValue({ post } as any);
  const config = buildConfig(apiKey);
  const service = new LlmCategoryDifficultyJudgeService(
    config,
    prisma as unknown as PrismaService,
  );
  return service;
};

describe('LlmCategoryDifficultyJudgeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('다른 채널 데이터 0건이면 difficulty=3 + categoryId=null', async () => {
    const prisma = buildPrisma();
    prisma.category.findMany.mockResolvedValue([{ id: 1, name: '발라드' }]);
    const service = buildService(prisma, 'sk-test');

    const r = await service.decide({ channelId: 1, globalSongId: 99 });

    expect(r.categoryId).toBeNull();
    expect(r.difficulty).toBe(3);
  });

  it('본 채널 카테고리 없으면 LLM 호출 X + categoryId=null + 평균 difficulty 반환', async () => {
    const prisma = buildPrisma();
    prisma.category.findMany.mockResolvedValue([]);
    prisma.song.findMany.mockResolvedValue([
      { difficulty: 4, songCategories: [] },
      { difficulty: 5, songCategories: [] },
    ]);
    const post = jest.fn();
    const service = buildService(prisma, 'sk-test', post);

    const r = await service.decide({ channelId: 1, globalSongId: 99 });

    expect(r.categoryId).toBeNull();
    expect(r.difficulty).toBe(5); // round((4+5)/2) = 5 (Math.round 0.5 → up)
    expect(post).not.toHaveBeenCalled();
  });

  it('LLM 미설정이면 LLM 호출 X + 평균 difficulty 반환', async () => {
    const prisma = buildPrisma();
    prisma.category.findMany.mockResolvedValue([{ id: 1, name: '발라드' }]);
    prisma.song.findMany.mockResolvedValue([
      { difficulty: 3, songCategories: [{ category: { name: '발라드' } }] },
      { difficulty: 4, songCategories: [{ category: { name: '발라드' } }] },
    ]);
    const post = jest.fn();
    const service = buildService(prisma, '', post);

    const r = await service.decide({ channelId: 1, globalSongId: 99 });

    expect(r.categoryId).toBeNull();
    expect(r.difficulty).toBe(4); // round(3.5) = 4
    expect(post).not.toHaveBeenCalled();
  });

  it('LLM 정상 응답 시 categoryId/difficulty 사용', async () => {
    const prisma = buildPrisma();
    prisma.category.findMany.mockResolvedValue([
      { id: 1, name: '발라드' },
      { id: 2, name: 'OST' },
    ]);
    prisma.song.findMany.mockResolvedValue([
      { difficulty: 4, songCategories: [{ category: { name: '발라드' } }] },
    ]);
    const post = jest.fn().mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                category_id: 1,
                difficulty: 4,
                reasoning: 'matches 발라드',
              }),
            },
          },
        ],
      },
    });
    const service = buildService(prisma, 'sk-test', post);

    const r = await service.decide({ channelId: 1, globalSongId: 99 });

    expect(r.categoryId).toBe(1);
    expect(r.difficulty).toBe(4);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('LLM이 본 채널에 없는 categoryId 반환하면 null로 reject', async () => {
    const prisma = buildPrisma();
    prisma.category.findMany.mockResolvedValue([{ id: 1, name: '발라드' }]);
    prisma.song.findMany.mockResolvedValue([
      { difficulty: 3, songCategories: [{ category: { name: '발라드' } }] },
    ]);
    const post = jest.fn().mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                category_id: 999,
                difficulty: 3,
              }),
            },
          },
        ],
      },
    });
    const service = buildService(prisma, 'sk-test', post);

    const r = await service.decide({ channelId: 1, globalSongId: 99 });

    expect(r.categoryId).toBeNull();
    expect(r.difficulty).toBe(3);
  });

  it('LLM이 difficulty 범위 외 반환하면 평균값으로 fallback (clamp 1-5)', async () => {
    const prisma = buildPrisma();
    prisma.category.findMany.mockResolvedValue([{ id: 1, name: '발라드' }]);
    prisma.song.findMany.mockResolvedValue([
      { difficulty: 4, songCategories: [{ category: { name: '발라드' } }] },
    ]);
    const post = jest.fn().mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({ category_id: 1, difficulty: 99 }),
            },
          },
        ],
      },
    });
    const service = buildService(prisma, 'sk-test', post);

    const r = await service.decide({ channelId: 1, globalSongId: 99 });

    expect(r.difficulty).toBe(5); // 99 → clamp 5
    expect(r.categoryId).toBe(1);
  });

  it('LLM 호출 실패 시 평균 difficulty fallback + categoryId=null', async () => {
    const prisma = buildPrisma();
    prisma.category.findMany.mockResolvedValue([{ id: 1, name: '발라드' }]);
    prisma.song.findMany.mockResolvedValue([
      { difficulty: 2, songCategories: [{ category: { name: '발라드' } }] },
      { difficulty: 3, songCategories: [{ category: { name: '발라드' } }] },
    ]);
    const post = jest.fn().mockRejectedValue(new Error('timeout'));
    const service = buildService(prisma, 'sk-test', post);

    const r = await service.decide({ channelId: 1, globalSongId: 99 });

    expect(r.categoryId).toBeNull();
    expect(r.difficulty).toBe(3); // round(2.5) = 3 (banker's: actually JS Math.round(2.5)=3)
  });

  it('LLM 응답이 invalid JSON이면 fallback', async () => {
    const prisma = buildPrisma();
    prisma.category.findMany.mockResolvedValue([{ id: 1, name: '발라드' }]);
    prisma.song.findMany.mockResolvedValue([
      { difficulty: 2, songCategories: [] },
    ]);
    const post = jest.fn().mockResolvedValue({
      data: { choices: [{ message: { content: 'garbage not json' } }] },
    });
    const service = buildService(prisma, 'sk-test', post);

    const r = await service.decide({ channelId: 1, globalSongId: 99 });

    expect(r.categoryId).toBeNull();
    expect(r.difficulty).toBe(2);
  });
});
