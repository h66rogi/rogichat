import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { EnvironmentVariables } from '../../config/env.config';
import type { SerperOrganicResult } from './serper-lookup.service';

/**
 * LLM-assisted candidate extraction.
 *
 * Given Serper organic results for a Korean/non-English song, ask Claude
 * Haiku 4.5 to produce 3 high-quality Musixmatch search queries
 * (title + artist pairs), ranked best-first.
 *
 * Why LLM instead of regex: Serper snippet structure varies a lot
 * (Spotify links, Genius lyrics pages, YouTube titles, blog posts, etc.).
 * Regex extraction is brittle for the long tail. LLM correctly handles
 * Japanese kanji ↔ romanized ↔ English; multi-language artist names; and
 * filtering out obvious noise (cover artists, remixes when not wanted).
 *
 * spec: docs/superpowers/specs/2026-04-28-musixmatch-integration-design.md
 *       Section 11.5 (Phase A→B 다리)
 */
export interface CandidateQuery {
  q_track: string;
  q_artist: string;
}

@Injectable()
export class LlmCandidateExtractorService {
  private readonly logger = new Logger(LlmCandidateExtractorService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(configService: ConfigService<EnvironmentVariables>) {
    this.apiKey = configService.get('OPENROUTER_API_KEY') ?? '';
    this.model =
      configService.get('MUSIXMATCH_ALTERNATE_SEARCH_LLM_MODEL') ??
      'anthropic/claude-haiku-4.5';
    this.http = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: 15_000,
      headers: {
        'HTTP-Referer':
          configService.get('OPENROUTER_SITE_URL') ?? 'https://meloming.com',
        'X-Title': 'Meloming Musixmatch Candidate Extractor',
      },
    });
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Extract up to 3 mxm-style search candidates from Serper hits.
   * Failure-safe: returns empty array on any error so caller can fall back.
   */
  async extractCandidates(input: {
    koreanTitle: string;
    koreanArtist: string;
    serperResults: SerperOrganicResult[];
  }): Promise<CandidateQuery[]> {
    if (!this.isConfigured()) {
      this.logger.warn('OpenRouter API key not configured');
      return [];
    }
    if (input.serperResults.length === 0) return [];

    const userPayload = JSON.stringify({
      korean_title: input.koreanTitle,
      korean_artist: input.koreanArtist,
      search_results: input.serperResults.map((r) => ({
        title: r.title,
        snippet: r.snippet,
      })),
    });

    const requestBody = {
      model: this.model,
      user: 'meloming-back:musixmatch-candidate-extractor',
      messages: [
        {
          role: 'system',
          content:
            'You extract Musixmatch search candidates from Google snippets. Reply ONLY with a compact JSON array of up to 3 candidates ranked best-first: [{"q_track":"...","q_artist":"..."}]. Prefer original-language titles (Japanese kanji / Korean hangul / English) AND romanized titles. Use the most accurate artist spelling visible in snippets. NO prose, NO markdown fences.',
        },
        { role: 'user', content: userPayload },
      ],
      temperature: 0.1,
      max_tokens: 400,
    };

    let raw: string;
    try {
      const resp = await this.http.post<{
        choices?: Array<{ message?: { content?: string } }>;
      }>('/chat/completions', requestBody, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      raw = resp.data?.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      this.logger.warn(`OpenRouter extraction failed (${this.redact(msg)})`);
      return [];
    }

    return this.parseCandidates(raw);
  }

  /**
   * Parse LLM output. Robust against:
   *  - markdown code fences
   *  - trailing commentary
   *  - duplicate candidates
   *  - missing/empty fields
   */
  private parseCandidates(raw: string): CandidateQuery[] {
    let cleaned = raw.trim();
    // Strip markdown fences if model added them despite instructions
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Try to find a JSON array substring
      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start === -1 || end === -1 || end <= start) {
        return [];
      }
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return [];
      }
    }
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const out: CandidateQuery[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      const q_track = typeof obj.q_track === 'string' ? obj.q_track.trim() : '';
      const q_artist =
        typeof obj.q_artist === 'string' ? obj.q_artist.trim() : '';
      if (!q_track || !q_artist) continue;
      const key = `${q_track}|||${q_artist}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ q_track, q_artist });
      if (out.length >= 3) break;
    }
    return out;
  }

  private redact(input: string): string {
    if (!this.apiKey) return input;
    return input.split(this.apiKey).join('***');
  }
}
