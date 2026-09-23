import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  MusixmatchAuthError,
  MusixmatchClient,
  MusixmatchCircuitOpenError,
  MusixmatchNotFoundError,
  MusixmatchPlanError,
  MusixmatchRateLimitError,
} from './musixmatch.client';
import { MusixmatchQuotaService } from './musixmatch-quota.service';
import { MusixmatchRedisService } from './musixmatch-redis.service';

jest.mock('axios');

/**
 * MusixmatchClient unit tests.
 *
 * Focus areas (spec Section 13.1):
 *   1. mxm wraps every response in `{ message: { header: { status_code }, body } }`.
 *      HTTP 200 with header.status_code != 200 must surface as a typed error.
 *   2. API key must be redacted from any log/error string.
 *   3. Retry on 429 / 5xx with backoff; auth/404/402 do not retry.
 *   4. Quota reserve is called BEFORE the HTTP request so retries also count.
 */
describe('MusixmatchClient', () => {
  const apiKey = 'test-api-key-redact-me';

  let mockedAxios: jest.Mocked<typeof axios>;
  let httpInstance: { request: jest.Mock };
  let quota: jest.Mocked<MusixmatchQuotaService>;
  let redis: jest.Mocked<MusixmatchRedisService>;
  let client: MusixmatchClient;

  beforeEach(() => {
    httpInstance = { request: jest.fn() };
    mockedAxios = axios as jest.Mocked<typeof axios>;
    (mockedAxios.create as jest.Mock).mockReturnValue(httpInstance);

    quota = {
      reserve: jest.fn().mockResolvedValue(undefined),
      recordOutcome: jest.fn().mockResolvedValue(undefined),
      getTodayUsage: jest.fn(),
    } as unknown as jest.Mocked<MusixmatchQuotaService>;

    redis = {
      getBreakerOpenedUntil: jest.fn().mockResolvedValue(null),
      openBreaker: jest.fn().mockResolvedValue(undefined),
      resetBreakerCounter: jest.fn().mockResolvedValue(undefined),
      incrementBreakerCounter: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<MusixmatchRedisService>;

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'MUSIXMATCH_API_KEY') return apiKey;
        return undefined;
      }),
    } as unknown as ConfigService;

    client = new MusixmatchClient(quota, redis, config);
  });

  function makeEnvelope(headerStatus: number, body: unknown) {
    return {
      status: headerStatus,
      data: {
        message: {
          header: { status_code: headerStatus },
          body,
        },
      },
    };
  }

  /**
   * Some non-2xx mxm responses come back without the JSON envelope (e.g.
   * a 5xx HTML error page from a proxy). Simulate that case.
   */
  function makeBareHttpResponse(httpStatus: number) {
    return {
      status: httpStatus,
      data: '<html>Internal Server Error</html>',
    };
  }

  describe('successful call', () => {
    it('returns the body when header.status_code = 200', async () => {
      httpInstance.request.mockResolvedValue(
        makeEnvelope(200, { track_list: [] }),
      );

      const result = await client.trackSearch(
        { q_track: 'hello' },
        { mode: 'normal' },
      );

      expect(result).toEqual({ track_list: [] });
      expect(quota.reserve).toHaveBeenCalledWith('track.search', 'normal');
      expect(quota.recordOutcome).toHaveBeenCalledWith({
        endpoint: 'track.search',
        success: true,
      });
    });

    it('passes the API key as a query param', async () => {
      httpInstance.request.mockResolvedValue(makeEnvelope(200, {}));

      await client.trackSearch({ q_track: 'x' }, { mode: 'normal' });

      const call = httpInstance.request.mock.calls[0][0];
      expect(call.params).toEqual(
        expect.objectContaining({
          q_track: 'x',
          format: 'json',
          apikey: apiKey,
        }),
      );
    });

    it('strips undefined params before sending', async () => {
      httpInstance.request.mockResolvedValue(makeEnvelope(200, {}));

      await client.trackSearch(
        {
          q_track: 'x',
          q_artist: undefined,
          page: 2,
        },
        { mode: 'normal' },
      );

      const call = httpInstance.request.mock.calls[0][0];
      expect(call.params).not.toHaveProperty('q_artist');
      expect(call.params.page).toBe(2);
    });
  });

  describe('mxm header status (HTTP 200 wrapper)', () => {
    it('throws MusixmatchAuthError on header 401 even with HTTP 200', async () => {
      httpInstance.request.mockResolvedValue(makeEnvelope(401, []));

      await expect(
        client.trackSearch({ q_track: 'x' }, { mode: 'normal' }),
      ).rejects.toBeInstanceOf(MusixmatchAuthError);

      // Auth errors do not retry
      expect(httpInstance.request).toHaveBeenCalledTimes(1);
    });

    it('throws MusixmatchPlanError on header 402 (mxm-side quota)', async () => {
      httpInstance.request.mockResolvedValue(makeEnvelope(402, []));

      await expect(
        client.trackGet({ track_id: 1 }, { mode: 'normal' }),
      ).rejects.toBeInstanceOf(MusixmatchPlanError);

      expect(httpInstance.request).toHaveBeenCalledTimes(1);
    });

    it('throws MusixmatchNotFoundError on header 404', async () => {
      httpInstance.request.mockResolvedValue(makeEnvelope(404, []));

      await expect(
        client.matcherTrackGet({ q_track: 'x' }, { mode: 'normal' }),
      ).rejects.toBeInstanceOf(MusixmatchNotFoundError);
    });

    it('records failure outcome on non-200 header status', async () => {
      httpInstance.request.mockResolvedValue(makeEnvelope(404, []));

      await expect(
        client.trackGet({ track_id: 1 }, { mode: 'normal' }),
      ).rejects.toBeInstanceOf(MusixmatchNotFoundError);

      expect(quota.recordOutcome).toHaveBeenCalledWith({
        endpoint: 'track.get',
        success: false,
        rateLimitHit: false,
      });
    });
  });

  describe('retry behavior', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('retries on header 429 (rate limit) with exponential backoff', async () => {
      httpInstance.request
        .mockResolvedValueOnce(makeEnvelope(429, []))
        .mockResolvedValueOnce(makeEnvelope(429, []))
        .mockResolvedValueOnce(makeEnvelope(200, { track: { track_id: 1 } }));

      const promise = client.trackGet(
        { track_id: 1 },
        { mode: 'normal', retryMax: 3 },
      );

      // Drain backoff timers (1s, 2s)
      await jest.advanceTimersByTimeAsync(1100);
      await jest.advanceTimersByTimeAsync(2100);

      const result = await promise;
      expect((result as { track: { track_id: number } }).track.track_id).toBe(1);
      expect(httpInstance.request).toHaveBeenCalledTimes(3);
    });

    it('retries on transport error (network-level — axios throws)', async () => {
      const axiosErr = new (axios.AxiosError as unknown as new (
        message: string,
      ) => Error)('ECONNRESET');
      Object.assign(axiosErr, {
        code: 'ECONNRESET',
        isAxiosError: true,
      });
      httpInstance.request
        .mockRejectedValueOnce(axiosErr)
        .mockResolvedValueOnce(makeEnvelope(200, { track: { track_id: 7 } }));

      const promise = client.trackGet(
        { track_id: 7 },
        { mode: 'normal', retryMax: 1 },
      );
      await jest.advanceTimersByTimeAsync(1100);
      await promise;

      expect(httpInstance.request).toHaveBeenCalledTimes(2);
    });

    it('retries on header status 5xx (mxm-side server error)', async () => {
      // mxm header.status_code = 503 wrapped in HTTP 200 body — and also
      // bare HTTP 503 without envelope. Both should map to TransportError.
      httpInstance.request
        .mockResolvedValueOnce(makeEnvelope(503, []))
        .mockResolvedValueOnce(makeEnvelope(200, { track: { track_id: 9 } }));

      const promise = client.trackGet(
        { track_id: 9 },
        { mode: 'normal', retryMax: 1 },
      );
      await jest.advanceTimersByTimeAsync(1100);
      await promise;

      expect(httpInstance.request).toHaveBeenCalledTimes(2);
    });

    it('retries on bare HTTP 5xx without envelope', async () => {
      httpInstance.request
        .mockResolvedValueOnce(makeBareHttpResponse(502))
        .mockResolvedValueOnce(makeEnvelope(200, { track: { track_id: 11 } }));

      const promise = client.trackGet(
        { track_id: 11 },
        { mode: 'normal', retryMax: 1 },
      );
      await jest.advanceTimersByTimeAsync(1100);
      await promise;

      expect(httpInstance.request).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry on HTTP 401 (auth)', async () => {
      // With validateStatus: () => true, axios returns response (not throws).
      // The bare HTTP 401 is mapped via headerStatus fallback.
      httpInstance.request.mockResolvedValue(makeBareHttpResponse(401));

      await expect(
        client.trackGet({ track_id: 1 }, { mode: 'normal', retryMax: 3 }),
      ).rejects.toBeInstanceOf(MusixmatchAuthError);

      expect(httpInstance.request).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on HTTP 404 (not found)', async () => {
      httpInstance.request.mockResolvedValue(makeBareHttpResponse(404));

      await expect(
        client.trackGet({ track_id: 1 }, { mode: 'normal', retryMax: 3 }),
      ).rejects.toBeInstanceOf(MusixmatchNotFoundError);

      expect(httpInstance.request).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on HTTP 402 (mxm plan/quota)', async () => {
      httpInstance.request.mockResolvedValue(makeBareHttpResponse(402));

      await expect(
        client.trackGet({ track_id: 1 }, { mode: 'normal', retryMax: 3 }),
      ).rejects.toBeInstanceOf(MusixmatchPlanError);

      expect(httpInstance.request).toHaveBeenCalledTimes(1);
    });

    it('throws MusixmatchRateLimitError after exhausting retries', async () => {
      httpInstance.request.mockResolvedValue(makeEnvelope(429, []));

      // Attach rejection handler BEFORE advancing timers so the rejection
      // doesn't become "unhandled" mid-run (jest fake timers + async pitfall).
      const assertion = expect(
        client.trackGet({ track_id: 1 }, { mode: 'normal', retryMax: 1 }),
      ).rejects.toBeInstanceOf(MusixmatchRateLimitError);

      await jest.advanceTimersByTimeAsync(2000);
      await assertion;
      expect(httpInstance.request).toHaveBeenCalledTimes(2);
    });

    it('does not retry on header 401', async () => {
      httpInstance.request.mockResolvedValue(makeEnvelope(401, []));

      await expect(
        client.trackGet({ track_id: 1 }, { mode: 'normal', retryMax: 3 }),
      ).rejects.toBeInstanceOf(MusixmatchAuthError);

      expect(httpInstance.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('quota integration', () => {
    it('reserves quota BEFORE making the HTTP call (so retries are counted)', async () => {
      const order: string[] = [];
      quota.reserve.mockImplementation(async () => {
        order.push('reserve');
      });
      httpInstance.request.mockImplementation(() => {
        order.push('http');
        return Promise.resolve(makeEnvelope(200, {}));
      });

      await client.trackSearch({ q_track: 'x' }, { mode: 'normal' });

      expect(order).toEqual(['reserve', 'http']);
    });

    it('reserves quota for EVERY retry attempt, not just the first call', async () => {
      jest.useFakeTimers();
      try {
        httpInstance.request
          .mockResolvedValueOnce(makeEnvelope(429, []))
          .mockResolvedValueOnce(makeEnvelope(429, []))
          .mockResolvedValueOnce(makeEnvelope(200, { track: { track_id: 1 } }));

        const promise = client.trackGet(
          { track_id: 1 },
          { mode: 'normal', retryMax: 2 },
        );
        await jest.advanceTimersByTimeAsync(1100);
        await jest.advanceTimersByTimeAsync(2100);
        await promise;

        // 3 attempts → 3 reserves
        expect(quota.reserve).toHaveBeenCalledTimes(3);
        expect(quota.reserve).toHaveBeenNthCalledWith(1, 'track.get', 'normal');
        expect(quota.reserve).toHaveBeenNthCalledWith(2, 'track.get', 'normal');
        expect(quota.reserve).toHaveBeenNthCalledWith(3, 'track.get', 'normal');
      } finally {
        jest.useRealTimers();
      }
    });

    it('records outcome with rateLimitHit=true on 429', async () => {
      httpInstance.request.mockResolvedValue(makeEnvelope(429, []));

      await expect(
        client.trackGet({ track_id: 1 }, { mode: 'normal', retryMax: 0 }),
      ).rejects.toBeInstanceOf(MusixmatchRateLimitError);

      expect(quota.recordOutcome).toHaveBeenCalledWith({
        endpoint: 'track.get',
        success: false,
        rateLimitHit: true,
      });
    });

    it('throws MusixmatchAuthError without making HTTP call when API key not configured', async () => {
      const config = {
        get: jest.fn().mockReturnValue(''),
      } as unknown as ConfigService;
      const unconfigured = new MusixmatchClient(quota, redis, config);

      await expect(
        unconfigured.trackSearch({ q_track: 'x' }, { mode: 'normal' }),
      ).rejects.toBeInstanceOf(MusixmatchAuthError);

      expect(quota.reserve).not.toHaveBeenCalled();
      expect(httpInstance.request).not.toHaveBeenCalled();
    });
  });

  describe('API key redaction (regression — must never leak)', () => {
    it('does not include the apikey in MusixmatchTransportError messages', async () => {
      const axiosErr = new (axios.AxiosError as unknown as new (
        message: string,
      ) => Error)(
        // Simulate axios surfacing the request URL with apikey query param
        `Request failed: GET https://api.musixmatch.com/ws/1.1/track.search?q_track=x&apikey=${apiKey}`,
      );
      Object.assign(axiosErr, { isAxiosError: true });
      httpInstance.request.mockRejectedValue(axiosErr);

      try {
        await client.trackSearch(
          { q_track: 'x' },
          { mode: 'normal', retryMax: 0 },
        );
        fail('should have thrown');
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).not.toContain(apiKey);
        // Sanity: message still indicates the failure
        expect(msg).toMatch(/transport/i);
      }
    });

    it('does not propagate raw AxiosError as cause', async () => {
      const axiosErr = new (axios.AxiosError as unknown as new (
        message: string,
      ) => Error)('boom');
      Object.assign(axiosErr, {
        isAxiosError: true,
        config: {
          url: '/track.search',
          params: { apikey: apiKey, q_track: 'x' },
        },
      });
      httpInstance.request.mockRejectedValue(axiosErr);

      try {
        await client.trackSearch(
          { q_track: 'x' },
          { mode: 'normal', retryMax: 0 },
        );
        fail('should have thrown');
      } catch (err) {
        // Whatever the structure, JSON.stringify (Sentry capture, console)
        // must NOT surface the apikey.
        const serialized = JSON.stringify({
          name: (err as Error).name,
          message: (err as Error).message,
          cause: (err as Error & { cause?: unknown }).cause,
        });
        expect(serialized).not.toContain(apiKey);
      }
    });
  });

  describe('isConfigured', () => {
    it('returns true when API key is set', () => {
      expect(client.isConfigured()).toBe(true);
    });

    it('returns false when API key is empty', () => {
      const config = {
        get: jest.fn().mockReturnValue(''),
      } as unknown as ConfigService;
      const unconfigured = new MusixmatchClient(quota, redis, config);
      expect(unconfigured.isConfigured()).toBe(false);
    });
  });

  describe('circuit breaker', () => {
    it('throws MusixmatchCircuitOpenError when breaker is open', async () => {
      redis.getBreakerOpenedUntil.mockResolvedValue(
        new Date(Date.now() + 60_000),
      );

      await expect(
        client.trackSearch({ q_track: 'x' }, { mode: 'normal' }),
      ).rejects.toBeInstanceOf(MusixmatchCircuitOpenError);

      expect(httpInstance.request).not.toHaveBeenCalled();
      expect(quota.reserve).not.toHaveBeenCalled();
    });

    it('opens breaker after consecutive non-expected errors hit threshold', async () => {
      redis.incrementBreakerCounter.mockResolvedValue(10);
      httpInstance.request.mockResolvedValue({
        status: 500,
        data: '<html>',
      });

      await expect(
        client.trackSearch({ q_track: 'x' }, { mode: 'normal', retryMax: 0 }),
      ).rejects.toBeDefined();

      expect(redis.incrementBreakerCounter).toHaveBeenCalled();
      expect(redis.openBreaker).toHaveBeenCalledWith(30 * 60);
    });

    it('does NOT bump breaker on 404 (expected "no match" signal)', async () => {
      httpInstance.request.mockResolvedValue({
        status: 404,
        data: { message: { header: { status_code: 404 }, body: [] } },
      });

      await expect(
        client.trackGet({ track_id: 1 }, { mode: 'normal' }),
      ).rejects.toBeInstanceOf(MusixmatchNotFoundError);

      expect(redis.incrementBreakerCounter).not.toHaveBeenCalled();
    });

    it('resets breaker counter on success', async () => {
      httpInstance.request.mockResolvedValue({
        status: 200,
        data: { message: { header: { status_code: 200 }, body: {} } },
      });

      await client.trackSearch({ q_track: 'x' }, { mode: 'normal' });

      expect(redis.resetBreakerCounter).toHaveBeenCalled();
    });
  });
});
