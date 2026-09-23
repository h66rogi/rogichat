import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { EnvironmentVariables } from '../config/env.config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 노래책 추가 시 본 채널의 카테고리/난이도를 자동 결정.
 *
 * 입력: channelId + 식별된 globalSongId.
 * 흐름:
 *   1) 본 채널 Category 목록 (id, name) 조회 — LLM이 이 안에서만 선택
 *   2) 같은 globalSongId 가 다른 채널들에서 어떤 difficulty / 카테고리로 등록됐는지 통계
 *   3) LLM에 (본 채널 카테고리 목록 + 다른 채널 분포 + 평균 difficulty) 박고 결정 받음
 *   4) LLM 미설정/실패 또는 통계 0건 → difficulty=3, categoryId=null fallback
 *
 * 본 채널 카테고리 목록에 매핑되는 게 없으면 categoryId=null (호출자는 SongCategory 생성 X).
 */
@Injectable()
export class LlmCategoryDifficultyJudgeService {
  private readonly logger = new Logger(LlmCategoryDifficultyJudgeService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly model: string;

  /** 다른 채널 통계 표본 cap. 너무 많으면 LLM 토큰만 늘고 평균 변동 적음. */
  private static readonly OTHER_CHANNEL_SAMPLE_LIMIT = 200;
  /** 통계 0건 시 기본 difficulty (1-5 중 중간). */
  private static readonly DEFAULT_DIFFICULTY = 3;

  constructor(
    configService: ConfigService<EnvironmentVariables>,
    private readonly prisma: PrismaService,
  ) {
    this.apiKey = configService.get('OPENROUTER_API_KEY') ?? '';
    this.model =
      configService.get('FUZZY_CHAT_DETECTION_LLM_MODEL') ??
      'anthropic/claude-haiku-4.5';
    this.http = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: 8_000,
      headers: {
        'HTTP-Referer':
          configService.get('OPENROUTER_SITE_URL') ?? 'https://meloming.com',
        'X-Title': 'Meloming Songbook Add Judge',
      },
    });
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async decide(input: {
    channelId: number;
    globalSongId: number;
  }): Promise<JudgeResult> {
    const channelCategories = await this.prisma.category.findMany({
      where: { channelId: input.channelId },
      select: { id: true, name: true },
      orderBy: { displayOrder: 'asc' },
    });

    const otherChannelSongs = await this.prisma.song.findMany({
      where: {
        globalSongId: input.globalSongId,
        channelId: { not: input.channelId },
      },
      select: {
        difficulty: true,
        songCategories: {
          select: { category: { select: { name: true } } },
        },
      },
      take: LlmCategoryDifficultyJudgeService.OTHER_CHANNEL_SAMPLE_LIMIT,
    });

    const difficulties = otherChannelSongs
      .map((s) => s.difficulty)
      .filter((d): d is number => typeof d === 'number');
    const avgDifficulty =
      difficulties.length > 0
        ? Math.max(
            1,
            Math.min(
              5,
              Math.round(
                difficulties.reduce((a, b) => a + b, 0) / difficulties.length,
              ),
            ),
          )
        : LlmCategoryDifficultyJudgeService.DEFAULT_DIFFICULTY;

    const categoryDistribution = countOccurrences(
      otherChannelSongs.flatMap((s) =>
        s.songCategories.map((sc) => sc.category.name),
      ),
    );

    if (
      otherChannelSongs.length === 0 ||
      channelCategories.length === 0 ||
      !this.isConfigured()
    ) {
      return {
        categoryId: null,
        difficulty: avgDifficulty,
        llmCalled: false,
        usedAvgDifficulty: true,
        reasoning:
          otherChannelSongs.length === 0
            ? 'no other-channel data — default difficulty'
            : channelCategories.length === 0
              ? 'channel has no categories — categoryId null'
              : 'LLM unconfigured — average difficulty only',
      };
    }

    const llm = await this.callLlm({
      channelCategories,
      categoryDistribution,
      avgDifficulty,
      otherChannelSampleSize: otherChannelSongs.length,
    });
    if (!llm) {
      return {
        categoryId: null,
        difficulty: avgDifficulty,
        llmCalled: false, // 호출 시도했지만 실패 — counter 부풀리기 방지
        usedAvgDifficulty: true,
        reasoning: 'LLM call failed — fallback to average',
      };
    }

    // LLM이 본 채널에 없는 categoryId를 반환하면 reject
    const categoryId =
      llm.categoryId !== null &&
      channelCategories.some((c) => c.id === llm.categoryId)
        ? llm.categoryId
        : null;
    const usedAvgDifficulty =
      llm.difficulty === null ||
      llm.difficulty === undefined ||
      !Number.isFinite(llm.difficulty);
    const difficulty = clampInt(
      llm.difficulty ?? avgDifficulty,
      1,
      5,
      avgDifficulty,
    );
    return {
      categoryId,
      difficulty,
      llmCalled: true,
      usedAvgDifficulty,
      reasoning: llm.reasoning,
    };
  }

  private async callLlm(input: {
    channelCategories: Array<{ id: number; name: string }>;
    categoryDistribution: Array<{ name: string; count: number }>;
    avgDifficulty: number;
    otherChannelSampleSize: number;
  }): Promise<LlmJudgeResponse | null> {
    const systemPrompt =
      'You classify a song into ONE of the streamer\'s existing categories and assign a difficulty 1-5.\n' +
      'Reply ONLY with compact JSON: {"category_id":number|null,"difficulty":1-5,"reasoning":"<short>"}.\n' +
      '\n' +
      'Rules:\n' +
      '- category_id MUST be one of the ids in `channel_categories`. If none semantically fits, return null.\n' +
      '- Choose the channel category most semantically aligned with the dominant `other_channel_distribution` entry.\n' +
      '- difficulty: prefer values within ±1 of `other_channel_avg_difficulty`. Use the average when uncertain.\n' +
      '- NO markdown fences, NO prose outside JSON.';

    const userBlob = JSON.stringify({
      channel_categories: input.channelCategories,
      other_channel_distribution: input.categoryDistribution,
      other_channel_avg_difficulty: input.avgDifficulty,
      other_channel_sample_size: input.otherChannelSampleSize,
    });

    let raw = '';
    try {
      const resp = await this.http.post<{
        choices?: Array<{ message?: { content?: string } }>;
      }>(
        '/chat/completions',
        {
          model: this.model,
          user: 'meloming-back:songbook-add-category-judge',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userBlob },
          ],
          temperature: 0.1,
          max_tokens: 150,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );
      raw = resp.data?.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      this.logger.warn(`LLM judge call failed: ${this.redact(msg)}`);
      return null;
    }
    return parseJudgeResponse(raw);
  }

  private redact(s: string): string {
    if (!this.apiKey) return s;
    return s.split(this.apiKey).join('***');
  }
}

export interface JudgeResult {
  categoryId: number | null;
  difficulty: number; // 1-5
  /** true 이면 OpenRouter 호출이 실제 성공했음. fallback (미설정/실패/데이터 0건) 은 false. */
  llmCalled: boolean;
  /** difficulty 가 LLM 결정값이 아니라 다른 채널 평균으로 fallback 됐는지. */
  usedAvgDifficulty: boolean;
  reasoning?: string;
}

interface LlmJudgeResponse {
  categoryId: number | null;
  difficulty: number | null;
  reasoning?: string;
}

function countOccurrences(items: string[]): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function clampInt(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

function parseJudgeResponse(raw: string): LlmJudgeResponse | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const categoryId =
    typeof o.category_id === 'number' && Number.isInteger(o.category_id)
      ? o.category_id
      : null;
  const difficulty =
    typeof o.difficulty === 'number' && Number.isFinite(o.difficulty)
      ? o.difficulty
      : null;
  const reasoning =
    typeof o.reasoning === 'string' ? o.reasoning.trim() : undefined;
  return { categoryId, difficulty, reasoning };
}
