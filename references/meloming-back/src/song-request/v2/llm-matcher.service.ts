import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { EnvironmentVariables } from '../../config/env.config';
import { MetricsService } from '../../metrics';

/**
 * Tier 1 전용 "context-rich" LLM 매처.
 *
 * 기존 NER-only LLM extractor와 달리, 이 service는 LLM에 다음을 한 번에 박는다:
 *   1) 시스템 프롬프트 (역할 정의)
 *   2) 채널 노래책 전체 또는 사전필터된 후보 (cache breakpoint #1)
 *   3) per-message: rawMessage + 사전 fuzzy/cross-alias hits + 가사 hits
 *
 * 응답: matched_song_id (또는 null) + confidence + reasoning.
 *
 * 왜 agentic이 아닌가?
 *   - tool-loop은 다회 왕복 → 채팅 반응 1초 목표를 못 맞춤 (P95 4초+)
 *   - 어떤 데이터를 가져올지는 코드가 결정 가능 (자모/cross-alias) →
 *     사전에 모두 박는 단일 호출이 latency·비용·정확도 모두 우위
 *
 * Prompt cache:
 *   - system 프롬프트 + channel_songs 블록을 anthropic ephemeral cache에 박는다
 *   - 한 방송 = 같은 channelId = 같은 cache key → 5분 TTL 내 재사용
 *   - per-message 컨텍스트만 fresh
 */
export interface LlmMatcherContext {
  channelId: number;
  rawMessage: string;
  /** 채널 노래책 전체 (또는 사전 필터된 후보). LLM이 이 안에서 song_id 선택. */
  channelSongs: Array<{
    songId: number;
    title: string;
    artist: string;
    /** 노래책에 등록된 카테고리 (장르 등). 매칭 힌트용. */
    categories?: string[];
  }>;
  /** 사전 fuzzy 결과 (v1 candidates + jamo top). LLM에게 "이 후보가 가까웠다" 힌트. */
  fuzzyHints?: Array<{
    songId: number;
    score: number;
    via: string;
  }>;
  /** GlobalSong cross-streamer alias hit (다른 스트리머가 같은 곡에 붙인 표기). */
  crossAliases?: Array<{
    globalSongId: number;
    canonicalTitle: string;
    artist: string;
    aliases: string[];
  }>;
  /** 가사 부분일치 hit (입력 일부가 가사에 등장). */
  lyricsHits?: Array<{
    songId: number;
    title: string;
    artist: string;
    snippet: string;
  }>;
}

export interface LlmMatchResult {
  /** 매칭된 곡의 Song.id. 채널 노래책에 없으면 null. */
  matchedSongId: number | null;
  /** 0~1. 0.7 이상이면 자동 신청 권장. */
  confidence: number;
  /** 사람이 읽는 디버그 사유 (admin trace용). */
  reasoning?: string;
  /** raw LLM 응답 (디버그용). */
  raw?: string;
}

/**
 * 노래책 추가 (`!노래책추가`)용 GlobalSong 매칭 컨텍스트.
 *
 * 신청곡 매칭과 달리 채널 노래책에 없는 곡을 찾는 흐름이라 후보군이 GlobalSong.
 * `candidates`는 사전 단계(alias 정확/normTitle/jamo)로 좁혀진 GlobalSong 풀.
 * LLM은 이 안에서 하나만 선택 — 환각 방지.
 */
export interface GlobalSongLlmContext {
  /** 채팅에서 입력된 원본 쿼리 (`!노래책추가` prefix 제거된 본문). */
  rawQuery: string;
  /** 후보 GlobalSong (사전 단계로 좁혀진 풀, ≤50). LLM이 이 중 하나만 고름. */
  candidates: Array<{
    globalSongId: number;
    title: string;
    artist: string;
    aliases?: string[];
  }>;
  /** GlobalSong 가사 부분일치 hit (Musixmatch GlobalSongLyrics.body). */
  lyricsHits?: Array<{
    globalSongId: number;
    title: string;
    artist: string;
    snippet: string;
  }>;
}

export interface GlobalSongLlmMatchResult {
  matchedGlobalSongId: number | null;
  confidence: number;
  reasoning?: string;
  raw?: string;
}

@Injectable()
export class LlmMatcherService {
  private readonly logger = new Logger(LlmMatcherService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(
    configService: ConfigService<EnvironmentVariables>,
    private readonly metrics: MetricsService,
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
        'X-Title': 'Meloming Song Matcher',
      },
    });
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async match(ctx: LlmMatcherContext): Promise<LlmMatchResult> {
    if (!this.isConfigured()) {
      this.logger.warn('OPENROUTER_API_KEY not configured — skipping LLM');
      return { matchedSongId: null, confidence: 0 };
    }
    if (!ctx.rawMessage.trim()) {
      return { matchedSongId: null, confidence: 0 };
    }
    if (ctx.channelSongs.length === 0) {
      return { matchedSongId: null, confidence: 0 };
    }

    const systemPrompt =
      'You match Korean live-stream chat messages to a song in the streamer\'s songbook (channel_songs).\n' +
      'Reply ONLY with compact JSON: {"matched_song_id":number|null,"confidence":0.0-1.0,"reasoning":"<short>"}.\n' +
      '\n' +
      'MATCH AGGRESSIVELY in these cases — pick a song from channel_songs whenever a plausible candidate exists:\n' +
      '1. Typos / fuzzy spelling: 조은날→좋은날, 박편지→밤편지, 배털기웃으→베텔기우스, 라이오테→라이언테.\n' +
      '2. Abbreviated or fragment title (chorus only, first phrase only, partial line).\n' +
      '3. Artist or title omitted / partial.\n' +
      '4. Thematic / topical / paraphrase references — match by what the song is about or a paraphrased equivalent. Prefer semantic match over single-word overlap:\n' +
      '   - "무슨 한강다리 해도" → 양화대교 (Han River bridge)\n' +
      '   - "잠깐 오는 비" → 소나기 (NOT "비가 오는 날엔" — single-word "비" overlap; "잠깐 오는 비" is the literal definition of 소나기)\n' +
      '   - "쏟아지는 비" → 폭우 / 소나기 (paraphrase, not "빗속에서")\n' +
      '   - "첫눈 오는 날" → 첫눈 (direct, not "눈이 오던 날")\n' +
      '   - "부산 노래" → 부산갈매기\n' +
      '   - "벚꽃 노래" → 봄날, 벚꽃엔딩 등 (pick any matching, see #5)\n' +
      '   IMPORTANT: When two candidates exist — one with shared keyword, one with semantic/paraphrase match — choose the semantic match unless the keyword candidate is overwhelmingly closer in form.\n' +
      '5. Vague mood/style/artist descriptions — pick ANY song that matches the description (random tie-break OK):\n' +
      '   - "버즈 그 신나는 노래" → pick any uptempo 버즈 song from songbook\n' +
      '   - "잔잔한 발라드" → pick any ballad\n' +
      '   - "신해철꺼 아무거나" → pick any 신해철 song\n' +
      '   This is intentional — viewers often delegate the choice to the streamer.\n' +
      '6. Pronunciation-based matches (Korean phonetic transliteration of foreign titles/artists):\n' +
      '   - "배털기웃으" → 베텔기우스 (Betelgeuse, similar pronunciation)\n' +
      '   - "예스터데이" / "예스떼이" → Yesterday\n' +
      '7. Lyrics-fragment requests — viewers quote a remembered lyric line:\n' +
      '   - "여러분의 등록금이 펑펑" → 불꽃놀이 (하현상) if the lyrics contain that line.\n' +
      '   - Use lyrics_hits as primary evidence here.\n' +
      '\n' +
      'CONFIDENCE GUIDE:\n' +
      '- Exact / near-exact title match (typos, abbreviation, fragment): 0.85-1.0\n' +
      '- Clear thematic / lyrics reference with one strong candidate: 0.7-0.9\n' +
      '- Vague description with multiple plausible candidates → pick one: 0.55-0.7\n' +
      '- Genuinely ambiguous between unrelated songs (or songbook has nothing close): null\n' +
      '\n' +
      'Use cross_streamer_aliases and lyrics_hits as supporting evidence, but matched_song_id MUST be a song from channel_songs (the streamer\'s own songbook).\n' +
      'NO markdown fences, NO prose outside the JSON.';

    // 채널 노래책을 cache breakpoint로 격리 — 같은 채널 후속 매칭은 캐시 히트
    const channelSongsBlob = JSON.stringify({
      channel_songs: ctx.channelSongs.map((s) => ({
        id: s.songId,
        title: s.title,
        artist: s.artist,
        ...(s.categories && s.categories.length > 0
          ? { categories: s.categories }
          : {}),
      })),
    });

    const perMessageBlob = JSON.stringify({
      message: ctx.rawMessage.trim(),
      ...(ctx.fuzzyHints && ctx.fuzzyHints.length > 0
        ? { fuzzy_hints: ctx.fuzzyHints }
        : {}),
      ...(ctx.crossAliases && ctx.crossAliases.length > 0
        ? { cross_streamer_aliases: ctx.crossAliases }
        : {}),
      ...(ctx.lyricsHits && ctx.lyricsHits.length > 0
        ? { lyrics_hits: ctx.lyricsHits }
        : {}),
    });

    // OpenRouter는 anthropic 모델일 때 cache_control을 그대로 전달.
    // system을 array로 보내면서 channel_songs 블록에 ephemeral cache 표시.
    const requestBody = {
      model: this.model,
      user: 'meloming-back:song-request-v2',
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: systemPrompt },
            {
              type: 'text',
              text: `\n\n[CHANNEL ${ctx.channelId} SONGBOOK]\n${channelSongsBlob}`,
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
        {
          role: 'user',
          content: perMessageBlob,
        },
      ],
      temperature: 0.1,
      max_tokens: 250,
    };

    let raw = '';
    try {
      const resp = await this.http.post<{
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      }>('/chat/completions', requestBody, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      raw = resp.data?.choices?.[0]?.message?.content ?? '';
      const usage = resp.data?.usage;
      if (usage) {
        const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
        const promptUncached = (usage.prompt_tokens ?? 0) - cached;
        if (promptUncached > 0) {
          this.metrics.songMatcherV2LlmTokensTotal.inc(
            { type: 'prompt' },
            promptUncached,
          );
        }
        if (cached > 0) {
          this.metrics.songMatcherV2LlmTokensTotal.inc(
            { type: 'cached_prompt' },
            cached,
          );
        }
        if ((usage.completion_tokens ?? 0) > 0) {
          this.metrics.songMatcherV2LlmTokensTotal.inc(
            { type: 'completion' },
            usage.completion_tokens ?? 0,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      this.logger.warn(
        `LLM match failed (${this.redact(msg)}): "${ctx.rawMessage.slice(0, 80)}"`,
      );
      return { matchedSongId: null, confidence: 0 };
    }

    return this.parse(raw, ctx);
  }

  private parse(raw: string, ctx: LlmMatcherContext): LlmMatchResult {
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) {
        return { matchedSongId: null, confidence: 0, raw };
      }
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return { matchedSongId: null, confidence: 0, raw };
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      return { matchedSongId: null, confidence: 0, raw };
    }
    const o = parsed as Record<string, unknown>;
    const idVal = o.matched_song_id;
    const matchedSongId =
      typeof idVal === 'number' && Number.isInteger(idVal) ? idVal : null;
    const confidence =
      typeof o.confidence === 'number'
        ? Math.max(0, Math.min(1, o.confidence))
        : 0;
    const reasoning =
      typeof o.reasoning === 'string' ? o.reasoning.trim() : undefined;

    // 환각 방지: LLM이 채널 노래책에 없는 song_id를 반환하면 reject
    if (matchedSongId !== null) {
      const known = ctx.channelSongs.some((s) => s.songId === matchedSongId);
      if (!known) {
        this.logger.warn(
          `LLM hallucinated song_id=${matchedSongId} not in channel ${ctx.channelId} songbook — rejecting`,
        );
        return {
          matchedSongId: null,
          confidence: 0,
          reasoning: `LLM returned id ${matchedSongId} not in songbook`,
          raw,
        };
      }
    }

    return { matchedSongId, confidence, reasoning, raw };
  }

  /**
   * GlobalSong 매칭 (`!노래책추가` 흐름).
   *
   * 신청곡 매칭과 달리 채널 노래책이 아닌 GlobalSong 후보 풀에서 선택.
   * threshold는 호출 측(`GlobalSongMatcherService.AUTO_THRESHOLD = 0.8`)에서 판정.
   */
  async matchGlobalSong(
    ctx: GlobalSongLlmContext,
  ): Promise<GlobalSongLlmMatchResult> {
    if (!this.isConfigured()) {
      this.logger.warn(
        'OPENROUTER_API_KEY not configured — skipping LLM matchGlobalSong',
      );
      return { matchedGlobalSongId: null, confidence: 0 };
    }
    if (!ctx.rawQuery.trim()) {
      return { matchedGlobalSongId: null, confidence: 0 };
    }
    if (ctx.candidates.length === 0) {
      return { matchedGlobalSongId: null, confidence: 0 };
    }

    const systemPrompt =
      'You match a Korean songbook-add query to ONE GlobalSong from `candidates`.\n' +
      'Reply ONLY with compact JSON: {"matched_global_song_id":number|null,"confidence":0.0-1.0,"reasoning":"<short>"}.\n' +
      '\n' +
      'MATCH AGGRESSIVELY in the same scenarios as song-request matching:\n' +
      '1. Typos / fuzzy spelling.\n' +
      '2. Abbreviated / fragment / chorus-only title.\n' +
      '3. Artist or title omitted.\n' +
      '4. Thematic / paraphrase reference (e.g., "잠깐 오는 비" → 소나기, "한강다리 노래" → 양화대교).\n' +
      '5. Pronunciation-based (e.g., "배털기웃으" → 베텔기우스).\n' +
      '6. Lyrics fragment — viewer may quote a remembered line; lyrics_hits is primary evidence.\n' +
      '\n' +
      'CONFIDENCE GUIDE:\n' +
      '- Exact / near-exact title in candidates (typo, abbreviation): 0.85-1.0\n' +
      '- Clear thematic / lyrics evidence with one strong candidate: 0.7-0.9\n' +
      '- Multiple plausible candidates → pick best: 0.55-0.75\n' +
      '- Genuinely ambiguous or no candidate close: null\n' +
      '\n' +
      'matched_global_song_id MUST be from candidates. NO markdown fences, NO prose outside JSON.';

    const userBlob = JSON.stringify({
      query: ctx.rawQuery.trim(),
      candidates: ctx.candidates.map((c) => ({
        id: c.globalSongId,
        title: c.title,
        artist: c.artist,
        ...(c.aliases && c.aliases.length > 0 ? { aliases: c.aliases } : {}),
      })),
      ...(ctx.lyricsHits && ctx.lyricsHits.length > 0
        ? { lyrics_hits: ctx.lyricsHits }
        : {}),
    });

    const raw = await this.callOpenRouter({
      systemPrompt,
      userPayload: userBlob,
      usageUser: 'meloming-back:songbook-add-global-song',
    });
    if (raw === null) {
      return { matchedGlobalSongId: null, confidence: 0 };
    }
    return this.parseGlobalSongResponse(raw, ctx);
  }

  /**
   * OpenRouter 단일 호출 + token 메트릭 기록. 실패 시 null.
   * match() / matchGlobalSong() 공통 인프라.
   */
  private async callOpenRouter(input: {
    systemPrompt: string;
    userPayload: string;
    usageUser: string;
  }): Promise<string | null> {
    const requestBody = {
      model: this.model,
      user: input.usageUser,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPayload },
      ],
      temperature: 0.1,
      max_tokens: 250,
    };
    try {
      const resp = await this.http.post<{
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      }>('/chat/completions', requestBody, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      const usage = resp.data?.usage;
      if (usage) {
        const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
        const promptUncached = (usage.prompt_tokens ?? 0) - cached;
        if (promptUncached > 0) {
          this.metrics.songMatcherV2LlmTokensTotal.inc(
            { type: 'prompt' },
            promptUncached,
          );
        }
        if (cached > 0) {
          this.metrics.songMatcherV2LlmTokensTotal.inc(
            { type: 'cached_prompt' },
            cached,
          );
        }
        if ((usage.completion_tokens ?? 0) > 0) {
          this.metrics.songMatcherV2LlmTokensTotal.inc(
            { type: 'completion' },
            usage.completion_tokens ?? 0,
          );
        }
      }
      return resp.data?.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      this.logger.warn(
        `LLM call failed (${this.redact(msg)}): "${input.userPayload.slice(0, 80)}"`,
      );
      return null;
    }
  }

  private parseGlobalSongResponse(
    raw: string,
    ctx: GlobalSongLlmContext,
  ): GlobalSongLlmMatchResult {
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
      if (start === -1 || end === -1 || end <= start) {
        return { matchedGlobalSongId: null, confidence: 0, raw };
      }
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return { matchedGlobalSongId: null, confidence: 0, raw };
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      return { matchedGlobalSongId: null, confidence: 0, raw };
    }
    const o = parsed as Record<string, unknown>;
    const idVal = o.matched_global_song_id;
    const matchedGlobalSongId =
      typeof idVal === 'number' && Number.isInteger(idVal) ? idVal : null;
    const confidence =
      typeof o.confidence === 'number'
        ? Math.max(0, Math.min(1, o.confidence))
        : 0;
    const reasoning =
      typeof o.reasoning === 'string' ? o.reasoning.trim() : undefined;

    if (matchedGlobalSongId !== null) {
      const known = ctx.candidates.some(
        (c) => c.globalSongId === matchedGlobalSongId,
      );
      if (!known) {
        this.logger.warn(
          `LLM hallucinated globalSongId=${matchedGlobalSongId} not in candidates — rejecting`,
        );
        return {
          matchedGlobalSongId: null,
          confidence: 0,
          reasoning: `LLM returned id ${matchedGlobalSongId} not in candidates`,
          raw,
        };
      }
    }

    return { matchedGlobalSongId, confidence, reasoning, raw };
  }

  private redact(s: string): string {
    if (!this.apiKey) return s;
    return s.split(this.apiKey).join('***');
  }
}
