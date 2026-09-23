import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { EnvironmentVariables } from '../../config/env.config';

/**
 * Google search via Serper.dev — used as a bridge to discover
 * romanized/translated song titles when the original Korean/Japanese
 * title fails to match in Musixmatch.
 *
 * spec: docs/superpowers/specs/2026-04-28-musixmatch-integration-design.md
 *       Section 11.5 (Phase A→B 다리)
 */
export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
}

@Injectable()
export class SerperLookupService {
  private readonly logger = new Logger(SerperLookupService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;

  constructor(configService: ConfigService<EnvironmentVariables>) {
    this.apiKey = configService.get('SERPER_API_KEY') ?? '';
    this.http = axios.create({
      baseURL: 'https://google.serper.dev',
      timeout: 8_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Search Google for romanization/translation hints. Returns top organic
   * results (title + snippet only — no full HTML). Failure is non-fatal:
   * caller should treat empty array as "no hints found".
   */
  async search(
    query: string,
    options: { topN?: number } = {},
  ): Promise<SerperOrganicResult[]> {
    if (!this.isConfigured()) {
      this.logger.warn('Serper API key not configured');
      return [];
    }
    const topN = options.topN ?? 5;
    try {
      const resp = await this.http.post<{
        organic?: Array<{ title?: string; link?: string; snippet?: string }>;
      }>('/search', { q: query }, { headers: { 'X-API-KEY': this.apiKey } });
      const organic = resp.data?.organic ?? [];
      return organic.slice(0, topN).map((o) => ({
        title: o.title ?? '',
        link: o.link ?? '',
        snippet: o.snippet ?? '',
      }));
    } catch (err) {
      const msg = err instanceof AxiosError ? err.message : String(err);
      this.logger.warn(`Serper search failed (${this.redact(msg)})`);
      return [];
    }
  }

  /** Redact API key from any string before logging. */
  private redact(input: string): string {
    if (!this.apiKey) return input;
    return input.split(this.apiKey).join('***');
  }
}
