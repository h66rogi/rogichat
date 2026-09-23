import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { EnvironmentVariables } from '../../config/env.config';

/**
 * Convert non-Korean lyrics (Japanese in Phase A1f) into Korean Hangul
 * phonetic spelling, matching the convention Korean fans use when karaoke-
 * singing foreign-language songs (e.g. 君を泣かすから → 키미오 나카스카라).
 *
 * Provider: OpenRouter Claude Haiku 4.5. Response is best-effort:
 *   - Failure → returns null. Caller treats as "pronunciation unavailable".
 *   - Empty input → returns null without an LLM call.
 *
 * Cost: ~\$0.005 per song body (1-2k tokens). Generated once at lyrics
 * fetch time and stored as `GlobalSongLyrics.bodyKoPron`.
 *
 * Phase scope:
 *   - A1f: Japanese (`ja`) only.
 *   - Future: English/Chinese transliteration in separate phase.
 */
@Injectable()
export class KoreanPronunciationService {
  private readonly logger = new Logger(KoreanPronunciationService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(configService: ConfigService<EnvironmentVariables>) {
    this.apiKey = configService.get('OPENROUTER_API_KEY') ?? '';
    // IMPORTANT: Anthropic Claude refuses lyrics transliteration on
    // copyright grounds (verified empirically). Use Gemini 2.5 Flash Lite
    // by default — best price/quality for J→K phonetic conversion (verified
    // with PoC against gpt-5.4-nano, mistral-small, qwen3-vl-8b, deepseek).
    // Override via MUSIXMATCH_KO_PRON_LLM_MODEL.
    this.model =
      configService.get('MUSIXMATCH_KO_PRON_LLM_MODEL') ??
      'google/gemini-2.5-flash-lite';
    this.http = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: 30_000, // longer than alternate-search; pron output can be 2-3KB
      headers: {
        'HTTP-Referer':
          configService.get('OPENROUTER_SITE_URL') ?? 'https://meloming.com',
        'X-Title': 'Meloming Musixmatch Korean Pronunciation',
      },
    });
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Currently we only generate Korean pronunciation for Japanese lyrics.
   * Returning false means caller should skip pronunciation generation for
   * this song.
   */
  isSupportedLanguage(language: string | null): boolean {
    return language === 'ja';
  }

  /**
   * Generate Korean phonetic spelling for the given text. Returns null on
   * any failure so the caller can decide whether to retry later. Empty
   * input also returns null.
   */
  async transliterate(text: string, language: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    if (!this.isSupportedLanguage(language)) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;

    const requestBody = {
      model: this.model,
      user: `meloming-back:musixmatch-pronunciation:${language}`,
      messages: [
        {
          role: 'system',
          content: this.systemPrompt(language),
        },
        { role: 'user', content: trimmed },
      ],
      // Low temperature for consistent, reproducible output
      temperature: 0.0,
      // max_tokens is just a ceiling — billed by actual usage, so be generous.
      // Korean Hangul tokenizes ~2-3 tokens per character on OpenAI/Gemini.
      // Use a wide ceiling (60k) to cover even 5,000+ char songs (long
      // ballads, rap) without ever truncating mid-sentence. Gemini 2.5
      // Flash supports up to 65,536 output tokens.
      max_tokens: 60000,
    };

    try {
      const resp = await this.http.post<{
        choices?: Array<{ message?: { content?: string } }>;
      }>('/chat/completions', requestBody, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      const out = resp.data?.choices?.[0]?.message?.content?.trim() ?? '';
      if (!out) return null;
      return out;
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      this.logger.warn(
        `Korean pronunciation generation failed (${this.redact(msg)})`,
      );
      return null;
    }
  }

  private systemPrompt(language: string): string {
    if (language === 'ja') {
      return [
        'You convert Japanese text into Korean Hangul phonetic spelling for karaoke sing-along.',
        'Example: 君を泣かすから → 키미오 나카스카라',
        'PRESERVE all line breaks exactly. PRESERVE punctuation.',
        'OUTPUT ONLY the Korean phonetic spelling. No original text. No explanations. No markdown.',
        'Korean Hangul only — do not include English romanization.',
      ].join(' ');
    }
    return 'Convert the input to Korean Hangul phonetic spelling.';
  }

  private redact(input: string): string {
    if (!this.apiKey) return input;
    return input.split(this.apiKey).join('***');
  }
}
