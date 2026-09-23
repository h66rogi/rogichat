import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { EnvironmentVariables } from '../../config/env.config';
import { EXTERNAL_REQUEST_USER_AGENT } from '../../common/constants/external-user-agent';
import {
  MUSIXMATCH_API_BASE_URL_DEFAULT,
  MUSIXMATCH_CONFIG,
  MXM_ENDPOINTS,
  MxmEndpoint,
} from './musixmatch.constants';
import {
  MusixmatchQuotaExceededError,
  MusixmatchQuotaService,
} from './musixmatch-quota.service';
import { MusixmatchRedisService } from './musixmatch-redis.service';
import {
  MxmCallOptions,
  MxmEnvelope,
  MxmLyricsGetBody,
  MxmLyricsTranslationGetBody,
  MxmMatcherTrackBody,
  MxmRichsyncGetBody,
  MxmSubtitleGetBody,
  MxmTrackGetBody,
  MxmTrackSearchBody,
} from './dto/musixmatch.dto';

/**
 * Low-level Musixmatch HTTP client.
 *
 * Responsibilities:
 *   - URL/query construction with base + apikey query param
 *   - Quota reserve before each call (via MusixmatchQuotaService)
 *   - Retry on 429/5xx with exponential backoff
 *   - Status normalization: mxm wraps every response in `{ message: { header,
 *     body } }`. The header `status_code` is authoritative — HTTP 200 with
 *     header.status_code=401 is an auth error, not success.
 *   - API key redaction in all logs and errors
 *
 * Does NOT:
 *   - Decide which endpoint to call (matcher service does that)
 *   - Cache responses (lyrics service handles that)
 *   - Implement business logic (matching, dedup, etc.)
 *
 * spec: docs/superpowers/specs/2026-04-28-musixmatch-integration-design.md
 *       Section 3.1 (architecture), 6.1 (quota), 6.2 (status handling),
 *       13.1 (testing)
 */
@Injectable()
export class MusixmatchClient {
  private readonly logger = new Logger(MusixmatchClient.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly retryMax: number;

  // Circuit breaker thresholds (spec Section 6.3)
  private static readonly BREAKER_ERROR_THRESHOLD = 10;
  private static readonly BREAKER_OPEN_SEC = 30 * 60;

  constructor(
    private readonly quota: MusixmatchQuotaService,
    private readonly redis: MusixmatchRedisService,
    configService: ConfigService<EnvironmentVariables>,
  ) {
    this.apiKey = configService.get('MUSIXMATCH_API_KEY') ?? '';
    const baseURL =
      configService.get('MUSIXMATCH_API_BASE_URL') ??
      MUSIXMATCH_API_BASE_URL_DEFAULT;
    const timeout =
      configService.get('MUSIXMATCH_REQUEST_TIMEOUT_MS') ??
      MUSIXMATCH_CONFIG.REQUEST_TIMEOUT_MS_DEFAULT;
    this.retryMax =
      configService.get('MUSIXMATCH_RETRY_MAX') ??
      MUSIXMATCH_CONFIG.RETRY_MAX_DEFAULT;

    this.http = axios.create({
      baseURL,
      timeout,
      headers: { 'User-Agent': EXTERNAL_REQUEST_USER_AGENT },
      // Accept any HTTP status — mxm wraps real status in body header.
      // We do retry/error mapping uniformly via `header.status_code` so
      // axios should not throw on non-2xx.
      validateStatus: () => true,
    });
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  // -----------------------------------------------------------------
  // Typed endpoint wrappers (Phase A1a only types — services come in A1b)
  // -----------------------------------------------------------------

  trackSearch(
    params: {
      q_track?: string;
      q_artist?: string;
      f_has_lyrics?: 0 | 1;
      f_has_subtitle?: 0 | 1;
      page_size?: number;
      page?: number;
      s_track_rating?: 'asc' | 'desc';
    },
    options: MxmCallOptions,
  ): Promise<MxmTrackSearchBody> {
    return this.call<MxmTrackSearchBody>(
      MXM_ENDPOINTS.TRACK_SEARCH,
      params,
      options,
    );
  }

  trackGet(
    params: { track_id?: number; track_isrc?: string; commontrack_id?: number },
    options: MxmCallOptions,
  ): Promise<MxmTrackGetBody> {
    return this.call<MxmTrackGetBody>(MXM_ENDPOINTS.TRACK_GET, params, options);
  }

  matcherTrackGet(
    params: {
      q_track?: string;
      q_artist?: string;
      f_has_lyrics?: 0 | 1;
      f_has_subtitle?: 0 | 1;
    },
    options: MxmCallOptions,
  ): Promise<MxmMatcherTrackBody> {
    return this.call<MxmMatcherTrackBody>(
      MXM_ENDPOINTS.MATCHER_TRACK_GET,
      params,
      options,
    );
  }

  trackLyricsGet(
    params: { track_id?: number; commontrack_id?: number; track_isrc?: string },
    options: MxmCallOptions,
  ): Promise<MxmLyricsGetBody> {
    return this.call<MxmLyricsGetBody>(
      MXM_ENDPOINTS.TRACK_LYRICS_GET,
      params,
      options,
    );
  }

  trackLyricsTranslationGet(
    params: {
      track_id?: number;
      commontrack_id?: number;
      track_isrc?: string;
      selected_language: string;
    },
    options: MxmCallOptions,
  ): Promise<MxmLyricsTranslationGetBody> {
    return this.call<MxmLyricsTranslationGetBody>(
      MXM_ENDPOINTS.TRACK_LYRICS_TRANSLATION_GET,
      params,
      options,
    );
  }

  trackSubtitleGet(
    params: {
      track_id?: number;
      commontrack_id?: number;
      subtitle_format?: 'lrc' | 'dfxp';
      f_subtitle_length?: number;
      f_subtitle_length_max_deviation?: number;
    },
    options: MxmCallOptions,
  ): Promise<MxmSubtitleGetBody> {
    return this.call<MxmSubtitleGetBody>(
      MXM_ENDPOINTS.TRACK_SUBTITLE_GET,
      params,
      options,
    );
  }

  trackRichsyncGet(
    params: { track_id?: number; commontrack_id?: number },
    options: MxmCallOptions,
  ): Promise<MxmRichsyncGetBody> {
    return this.call<MxmRichsyncGetBody>(
      MXM_ENDPOINTS.TRACK_RICHSYNC_GET,
      params,
      options,
    );
  }

  // -----------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------

  /**
   * Single call to mxm with quota reservation, retry, and status normalization.
   *
   * @throws MusixmatchQuotaExceededError when bucket limit hit
   * @throws MusixmatchApiError for any non-200 mxm header status
   * @throws MusixmatchNotFoundError specifically for header status 404
   * @throws MusixmatchAuthError specifically for header status 401
   * @throws MusixmatchTransportError for network/HTTP issues after retries
   */
  async call<TBody>(
    endpoint: MxmEndpoint,
    params: Record<string, string | number | undefined>,
    options: MxmCallOptions,
  ): Promise<TBody> {
    if (!this.isConfigured()) {
      throw new MusixmatchAuthError(endpoint, 'API key not configured');
    }

    // Circuit breaker check — fail fast when mxm is known to be down.
    const openedUntil = await this.redis.getBreakerOpenedUntil();
    if (openedUntil && openedUntil.getTime() > Date.now()) {
      throw new MusixmatchCircuitOpenError(endpoint, openedUntil);
    }

    const retryMax = options.retryMax ?? this.retryMax;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryMax; attempt++) {
      // Reserve BEFORE every HTTP attempt — mxm bills per attempt, so retries
      // must charge the quota too (spec Section 6.1).
      await this.quota.reserve(endpoint, options.mode);

      try {
        const data = await this.executeOnce<TBody>(endpoint, params);
        await this.quota.recordOutcome({ endpoint, success: true });
        await this.redis.resetBreakerCounter();
        return data;
      } catch (error) {
        lastError = error;
        const retryable = this.shouldRetry(error);
        const isRateLimit = error instanceof MusixmatchRateLimitError;
        const isExpected = this.isExpectedError(error);

        await this.quota.recordOutcome({
          endpoint,
          success: false,
          rateLimitHit: isRateLimit,
        });

        if (!isExpected) {
          await this.bumpBreaker();
        }

        if (!retryable || attempt === retryMax) {
          throw error;
        }

        const delayMs = this.backoffDelay(attempt);
        this.logger.warn(
          `mxm ${endpoint} attempt ${attempt + 1}/${retryMax + 1} failed (${this.describeError(error)}), retrying in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    // Unreachable but type-safe
    throw lastError as Error;
  }

  /** 404 (not found) is a normal "no match" signal, not a service failure. */
  private isExpectedError(error: unknown): boolean {
    return error instanceof MusixmatchNotFoundError;
  }

  private async bumpBreaker(): Promise<void> {
    const consecutive = await this.redis.incrementBreakerCounter();
    if (consecutive >= MusixmatchClient.BREAKER_ERROR_THRESHOLD) {
      await this.redis.openBreaker(MusixmatchClient.BREAKER_OPEN_SEC);
      this.logger.error(
        `mxm circuit breaker OPENED after ${consecutive} consecutive errors; halt for ${MusixmatchClient.BREAKER_OPEN_SEC}s`,
      );
    }
  }

  private async executeOnce<TBody>(
    endpoint: MxmEndpoint,
    params: Record<string, string | number | undefined>,
  ): Promise<TBody> {
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined),
    );
    // Pin country=KR for every mxm call (spec Section 1.3, 10.3 — KR-only).
    // mxm uses this as the licensing/restriction context; without it we
    // cannot trust restricted=0 responses for KR users.
    const config: AxiosRequestConfig = {
      method: 'GET',
      url: `/${endpoint}`,
      params: {
        country: 'KR',
        ...cleanParams,
        format: 'json',
        apikey: this.apiKey,
      },
    };

    let response;
    try {
      response = await this.http.request<MxmEnvelope<TBody>>(config);
    } catch (err) {
      // With validateStatus: () => true, axios only throws on transport-layer
      // failures (timeout, DNS, ECONNRESET, etc.) — not on HTTP non-2xx.
      // We deliberately do NOT propagate the raw AxiosError as `cause`:
      // err.config carries the apikey query param and would leak through any
      // downstream `console.error(error)` / Sentry capture / JSON.stringify.
      if (err instanceof AxiosError) {
        const codeOrMsg = err.code ?? err.message;
        throw new MusixmatchTransportError(
          endpoint,
          `axios error: ${this.redact(codeOrMsg)}`,
        );
      }
      throw new MusixmatchTransportError(endpoint, this.redact(String(err)));
    }

    const httpStatus = response.status;
    const envelope = response.data;
    // mxm authoritative status — header.status_code (when present, mirrors
    // HTTP). When mxm itself returns a non-JSON 5xx page, envelope/header
    // can be missing; fall back to HTTP status.
    const headerStatus = envelope?.message?.header?.status_code ?? httpStatus;

    if (headerStatus === 200) {
      return envelope.message.body as TBody;
    }
    if (headerStatus === 401) {
      throw new MusixmatchAuthError(endpoint, `status ${headerStatus}`);
    }
    if (headerStatus === 402) {
      throw new MusixmatchPlanError(
        endpoint,
        `status ${headerStatus} (mxm-side quota)`,
      );
    }
    if (headerStatus === 404) {
      throw new MusixmatchNotFoundError(endpoint, `status ${headerStatus}`);
    }
    if (headerStatus === 429) {
      throw new MusixmatchRateLimitError(endpoint, `status ${headerStatus}`);
    }
    if (headerStatus >= 500 && headerStatus < 600) {
      // 5xx is retryable transport error
      throw new MusixmatchTransportError(endpoint, `status ${headerStatus}`);
    }
    throw new MusixmatchApiError(endpoint, `unexpected status ${headerStatus}`);
  }

  private shouldRetry(error: unknown): boolean {
    if (error instanceof MusixmatchRateLimitError) return true;
    if (error instanceof MusixmatchTransportError) return true;
    return false;
  }

  private backoffDelay(attempt: number): number {
    // 1s, 2s, 4s ...
    return 1000 * Math.pow(2, attempt);
  }

  /**
   * Build a safe single-line description of an error suitable for logging.
   * Strips API key and avoids leaking response bodies.
   */
  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${this.redact(error.message)}`;
    }
    return this.redact(String(error));
  }

  /**
   * Strip the apikey from any string before it reaches a log sink.
   * mxm's apikey is a query param so it can leak via error.message,
   * upstream HTTP request URLs, response headers' Set-Cookie, etc.
   */
  private redact(input: string): string {
    if (!this.apiKey) return input;
    return input
      .split(this.apiKey)
      .join('***')
      .replace(/(apikey=)[^&\s]+/gi, '$1***');
  }
}

// -----------------------------------------------------------------
// Error hierarchy
// -----------------------------------------------------------------

export class MusixmatchApiError extends Error {
  constructor(
    public readonly endpoint: string,
    message: string,
  ) {
    super(`mxm ${endpoint}: ${message}`);
    this.name = 'MusixmatchApiError';
  }
}

export class MusixmatchAuthError extends MusixmatchApiError {
  constructor(endpoint: string, message: string) {
    super(endpoint, `auth: ${message}`);
    this.name = 'MusixmatchAuthError';
  }
}

export class MusixmatchPlanError extends MusixmatchApiError {
  constructor(endpoint: string, message: string) {
    super(endpoint, `plan: ${message}`);
    this.name = 'MusixmatchPlanError';
  }
}

export class MusixmatchNotFoundError extends MusixmatchApiError {
  constructor(endpoint: string, message: string) {
    super(endpoint, `not found: ${message}`);
    this.name = 'MusixmatchNotFoundError';
  }
}

export class MusixmatchRateLimitError extends MusixmatchApiError {
  constructor(endpoint: string, message: string) {
    super(endpoint, `rate limit: ${message}`);
    this.name = 'MusixmatchRateLimitError';
  }
}

export class MusixmatchTransportError extends MusixmatchApiError {
  constructor(endpoint: string, message: string) {
    super(endpoint, `transport: ${message}`);
    this.name = 'MusixmatchTransportError';
  }
}

export class MusixmatchCircuitOpenError extends MusixmatchApiError {
  constructor(
    endpoint: string,
    public readonly openedUntil: Date,
  ) {
    super(endpoint, `circuit breaker open until ${openedUntil.toISOString()}`);
    this.name = 'MusixmatchCircuitOpenError';
  }
}

// Re-export quota error so consumers don't need a second import line
export { MusixmatchQuotaExceededError };
