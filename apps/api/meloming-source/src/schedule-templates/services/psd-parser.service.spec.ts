import {
  BadRequestException,
  GatewayTimeoutException,
  InternalServerErrorException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PsdParserService,
  PsdParseTimeoutError,
  PsdQueueFullError,
  PsdWorkerInitError,
} from './psd-parser.service';
import { PsdParseError } from '../workers/psd-parse.worker';
import type Piscina from 'piscina';

/**
 * The actual PSD-parse-and-flatten logic lives in
 * `../workers/psd-parse.worker.ts` and is unit-tested in
 * `psd-parse.worker.spec.ts`. This spec only verifies that the service
 *  - dispatches each parse to the piscina pool with the buffer transferred
 *    as an ArrayBuffer (with piscina `transferList` for zero-copy)
 *  - aborts via AbortSignal after PSD_PARSE_TIMEOUT_MS (30s)
 *  - translates worker errors back into the right NestJS HTTP exceptions,
 *    including the bounded-queue "Task queue is at limit" → 503 case
 *  - guards `setPoolForTesting` in production
 *  - destroys the pool on module shutdown
 *
 * We never instantiate a real piscina pool here — instead we install a fake
 * pool via `setPoolForTesting`.
 */

interface FakePoolRunOptions {
  signal?: AbortSignal;
  transferList?: unknown[];
}

interface FakePool {
  run: jest.Mock;
  destroy: jest.Mock;
}

function makeFakePool(
  impl: (input: unknown, opts?: FakePoolRunOptions) => unknown,
): FakePool {
  return {
    run: jest.fn().mockImplementation((input, opts) => {
      return Promise.resolve().then(() => impl(input, opts));
    }),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

describe('PsdParserService', () => {
  let service: PsdParserService;

  beforeEach(() => {
    service = new PsdParserService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe('parsePsd', () => {
    it('forwards a buffer to the worker pool as an ArrayBuffer via transferList', async () => {
      const fakePool = makeFakePool(() => ({
        baseImageW: 100,
        baseImageH: 50,
        flattenPngBuffer: Buffer.from('png'),
        templateSpec: { version: 1, slots: [] },
        warnings: [],
      }));
      service.setPoolForTesting(fakePool as unknown as Piscina);

      const psdBytes = Buffer.from([0x38, 0x42, 0x50, 0x53, 0x00, 0x01]);
      const result = await service.parsePsd(psdBytes);

      expect(fakePool.run).toHaveBeenCalledTimes(1);
      const [input, opts] = fakePool.run.mock.calls[0];
      expect(input.buffer).toBeInstanceOf(ArrayBuffer);
      expect(input.buffer.byteLength).toBe(psdBytes.length);
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      // Zero-copy transfer: the ArrayBuffer passed to pool.run MUST also be
      // listed in transferList so piscina moves ownership instead of cloning.
      expect(Array.isArray(opts.transferList)).toBe(true);
      expect(opts.transferList).toHaveLength(1);
      expect(opts.transferList[0]).toBe(input.buffer);
      expect(result.baseImageW).toBe(100);
      expect(result.templateSpec.version).toBe(1);
    });

    it('transfers the exact same bytes to the worker (length + sample bytes)', async () => {
      // Byte-fidelity check: whatever bytes go into parsePsd(buffer) must be
      // what the worker sees on the other side. We capture the ArrayBuffer
      // the service hands to pool.run and compare its bytes against the
      // input Buffer.
      let seenBytes: Uint8Array | null = null;
      const fakePool = makeFakePool((input) => {
        const ab = (input as { buffer: ArrayBuffer }).buffer;
        // Clone here because the real worker would wrap with Buffer.from;
        // we just need to snapshot the bytes for the assertion.
        seenBytes = new Uint8Array(ab.slice(0));
        return {
          baseImageW: 1,
          baseImageH: 1,
          flattenPngBuffer: Buffer.alloc(0),
          templateSpec: { version: 1, slots: [] },
          warnings: [],
        };
      });
      service.setPoolForTesting(fakePool as unknown as Piscina);

      // 4 KB of pseudo-PSD bytes (value = i % 256 so every byte matters)
      const source = Buffer.alloc(4096);
      for (let i = 0; i < source.length; i++) source[i] = i % 256;

      await service.parsePsd(source);

      expect(seenBytes).not.toBeNull();
      const received = seenBytes as unknown as Uint8Array;
      expect(received.byteLength).toBe(source.length);
      // Spot-check start, middle, end — full memcmp would cost more with no
      // extra coverage since byteLength already matches and transfer doesn't
      // mutate bytes.
      expect(received[0]).toBe(source[0]);
      expect(received[Math.floor(source.length / 2)]).toBe(
        source[Math.floor(source.length / 2)],
      );
      expect(received[source.length - 1]).toBe(source[source.length - 1]);
    });

    it('returns the worker result unchanged on success', async () => {
      const expected = {
        baseImageW: 1920,
        baseImageH: 1080,
        flattenPngBuffer: Buffer.from('png-bytes'),
        templateSpec: { version: 1 as const, slots: [] },
        warnings: ['hi'],
      };
      service.setPoolForTesting(
        makeFakePool(() => expected) as unknown as Piscina,
      );

      const result = await service.parsePsd(Buffer.from([0x38]));
      expect(result).toEqual(expected);
    });

    it('translates worker PSD_INVALID error code into BadRequestException', async () => {
      service.setPoolForTesting(
        makeFakePool(() => {
          throw new PsdParseError('PSD_INVALID', 'bad header');
        }) as unknown as Piscina,
      );
      await expect(
        service.parsePsd(Buffer.from([0x38])),
      ).rejects.toBeInstanceOf(BadRequestException);
      try {
        await service.parsePsd(Buffer.from([0x38]));
        fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toMatchObject({
          code: 'PSD_INVALID',
        });
      }
    });

    it('translates worker PSD_OVERSIZED error code into PayloadTooLargeException', async () => {
      service.setPoolForTesting(
        makeFakePool(() => {
          throw new PsdParseError('PSD_OVERSIZED', 'too big');
        }) as unknown as Piscina,
      );
      try {
        await service.parsePsd(Buffer.from([0x38]));
        fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PayloadTooLargeException);
        expect((e as PayloadTooLargeException).getResponse()).toMatchObject({
          code: 'PSD_OVERSIZED',
        });
      }
    });

    it('translates worker PSD_UNSUPPORTED_DEPTH error code into BadRequestException', async () => {
      service.setPoolForTesting(
        makeFakePool(() => {
          throw new PsdParseError('PSD_UNSUPPORTED_DEPTH', 'use 8-bit');
        }) as unknown as Piscina,
      );
      try {
        await service.parsePsd(Buffer.from([0x38]));
        fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toMatchObject({
          code: 'PSD_UNSUPPORTED_DEPTH',
        });
      }
    });

    it('translates an arbitrary worker throw into BadRequest(PSD_INVALID)', async () => {
      service.setPoolForTesting(
        makeFakePool(() => {
          throw new Error('boom');
        }) as unknown as Piscina,
      );
      try {
        await service.parsePsd(Buffer.from([0x38]));
        fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toMatchObject({
          code: 'PSD_INVALID',
        });
      }
    });

    it('handles cross-thread serialized PsdParseError (instanceof check fails after deserialization)', async () => {
      // Worker errors come back as plain {name, code, message} objects across
      // the worker_threads boundary. Make sure we still detect them.
      service.setPoolForTesting(
        makeFakePool(() => {
          const err = Object.assign(new Error('cross-thread big'), {
            name: 'PsdParseError',
            code: 'PSD_OVERSIZED',
          });
          throw err;
        }) as unknown as Piscina,
      );
      try {
        await service.parsePsd(Buffer.from([0x38]));
        fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PayloadTooLargeException);
      }
    });

    it('handles cross-thread plain Error whose message has [CODE] prefix (structured clone strips name/code)', async () => {
      // structuredClone of a custom Error keeps message but drops name/code.
      // Our worker emits messages like `[PSD_OVERSIZED] real message` so the
      // service can still recover the code on the receive side.
      service.setPoolForTesting(
        makeFakePool(() => {
          const err = new Error('[PSD_OVERSIZED] PSD too large');
          throw err;
        }) as unknown as Piscina,
      );
      try {
        await service.parsePsd(Buffer.from([0x38]));
        fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PayloadTooLargeException);
        const body = (e as PayloadTooLargeException).getResponse() as {
          code: string;
          message: string;
        };
        expect(body.code).toBe('PSD_OVERSIZED');
        // Prefix should be stripped from the user-facing message
        expect(body.message).toBe('PSD too large');
      }
    });

    it('handles cross-thread plain Error with [PSD_UNSUPPORTED_DEPTH] prefix', async () => {
      service.setPoolForTesting(
        makeFakePool(() => {
          throw new Error(
            '[PSD_UNSUPPORTED_DEPTH] PSD bit depth 16 is not supported.',
          );
        }) as unknown as Piscina,
      );
      try {
        await service.parsePsd(Buffer.from([0x38]));
        fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        const body = (e as BadRequestException).getResponse() as {
          code: string;
          message: string;
        };
        expect(body.code).toBe('PSD_UNSUPPORTED_DEPTH');
        expect(body.message).toMatch(/16 is not supported/);
      }
    });

    it('throws PsdParseTimeoutError when the abort signal fires', async () => {
      // Fake a piscina pool that observes the signal and rejects with abort.
      const fakePool: FakePool = {
        run: jest.fn().mockImplementation((_input, opts) => {
          return new Promise((_resolve, reject) => {
            const signal: AbortSignal = opts.signal;
            signal.addEventListener('abort', () => {
              const err = new Error('The task has been aborted');
              (err as unknown as { name: string }).name = 'AbortError';
              reject(err);
            });
          });
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      service.setPoolForTesting(fakePool as unknown as Piscina);

      jest.useFakeTimers();
      const promise = service.parsePsd(Buffer.from([0x38]));
      jest.advanceTimersByTime(31_000);
      await expect(promise).rejects.toBeInstanceOf(PsdParseTimeoutError);
      jest.useRealTimers();
    });

    it('throws PsdQueueFullError when piscina rejects with "Task queue is at limit"', async () => {
      // Exact sentinel from piscina's errors.js#TaskQueueAtLimit. Must be
      // classified as queue-full (→ 503), NOT as a generic PSD_INVALID (400).
      service.setPoolForTesting(
        makeFakePool(() => {
          throw new Error('Task queue is at limit');
        }) as unknown as Piscina,
      );

      try {
        await service.parsePsd(Buffer.from([0x38]));
        fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PsdQueueFullError);
      }
    });
  });

  describe('setPoolForTesting production guard', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    afterEach(() => {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('throws when NODE_ENV === "production"', () => {
      process.env.NODE_ENV = 'production';
      const svc = new PsdParserService();
      expect(() => svc.setPoolForTesting(null)).toThrow(
        'setPoolForTesting is not allowed in production',
      );
    });

    it('is allowed when NODE_ENV is test / development / unset', () => {
      for (const env of ['test', 'development', undefined]) {
        if (env === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = env;
        }
        const svc = new PsdParserService();
        expect(() => svc.setPoolForTesting(null)).not.toThrow();
      }
    });
  });

  describe('toHttpException (static)', () => {
    it('maps PsdParseTimeoutError to GatewayTimeoutException', () => {
      const mapped = PsdParserService.toHttpException(new PsdParseTimeoutError());
      expect(mapped).toBeInstanceOf(GatewayTimeoutException);
      expect((mapped as GatewayTimeoutException).getResponse()).toMatchObject({
        code: 'PSD_PARSE_TIMEOUT',
      });
    });

    it('maps PsdQueueFullError to ServiceUnavailableException (503) with PSD_QUEUE_FULL', () => {
      const mapped = PsdParserService.toHttpException(new PsdQueueFullError());
      expect(mapped).toBeInstanceOf(ServiceUnavailableException);
      expect(
        (mapped as ServiceUnavailableException).getResponse(),
      ).toMatchObject({
        code: 'PSD_QUEUE_FULL',
        message: '서버가 혼잡합니다. 잠시 후 다시 시도해 주세요.',
      });
    });

    it('maps PsdWorkerInitError to InternalServerErrorException (500) with PSD_WORKER_INIT_ERROR', () => {
      // B8 review#3 IMPORTANT: the worker-init failure is a *permanent*
      // infrastructure error (the worker artifact is missing on disk).
      // Retrying does not help, so we map it to 500 (not 503) and the
      // controller deliberately does NOT add a Retry-After header.
      const mapped = PsdParserService.toHttpException(
        new PsdWorkerInitError('/some/missing/path.js'),
      );
      expect(mapped).toBeInstanceOf(InternalServerErrorException);
      // CRITICAL: must NOT be a ServiceUnavailableException, otherwise the
      // controller's `mapped instanceof ServiceUnavailableException` branch
      // would inherit Retry-After: 5 from the queue-full path.
      expect(mapped).not.toBeInstanceOf(ServiceUnavailableException);
      expect(
        (mapped as InternalServerErrorException).getResponse(),
      ).toMatchObject({
        code: 'PSD_WORKER_INIT_ERROR',
        message: 'PSD 워커 초기화에 실패했습니다.',
      });
    });

    it('passes through other Errors unchanged', () => {
      const e = new BadRequestException({ code: 'PSD_INVALID' });
      expect(PsdParserService.toHttpException(e)).toBe(e);
    });
  });

  describe('PsdWorkerInitError integration with parsePsd', () => {
    // The full path is: getPool() does an `existsSync(workerPath)` check; on
    // false it throws PsdWorkerInitError. parsePsd catches that and lets it
    // propagate (it's a service-level typed error, not a worker-thread
    // rejection, so translateWorkerError isn't where it gets handled —
    // toHttpException at the controller is). This verifies the error flow
    // end-to-end without spinning a real piscina pool.
    it('parsePsd surfaces PsdWorkerInitError when the worker file is absent', async () => {
      // Use jest.spyOn to swap fs.existsSync just for this test. We can't use
      // setPoolForTesting because the lazy getPool() check happens *before*
      // pool construction, so we need to drive the existsSync check directly.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as { existsSync: (p: string) => boolean };
      const spy = jest
        .spyOn(fs, 'existsSync')
        .mockReturnValue(false);
      try {
        const fresh = new PsdParserService();
        await expect(
          fresh.parsePsd(Buffer.from([0x38, 0x42, 0x50, 0x53])),
        ).rejects.toBeInstanceOf(PsdWorkerInitError);
      } finally {
        spy.mockRestore();
      }
    });

    it('end-to-end: PsdWorkerInitError → toHttpException → 500 (no 503, so controller emits no Retry-After)', () => {
      const initErr = new PsdWorkerInitError('/dist/missing.js');
      const mapped = PsdParserService.toHttpException(initErr);
      // 500 status (InternalServerErrorException default)
      expect(mapped).toBeInstanceOf(InternalServerErrorException);
      // The controller branch that sets Retry-After is gated on
      // `instanceof ServiceUnavailableException`. Document the invariant
      // here so the contract is regression-tested.
      expect(mapped).not.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('onModuleDestroy', () => {
    it('calls pool.destroy when a pool was created', async () => {
      const fakePool = makeFakePool(() => ({
        baseImageW: 1,
        baseImageH: 1,
        flattenPngBuffer: Buffer.alloc(0),
        templateSpec: { version: 1, slots: [] },
        warnings: [],
      }));
      service.setPoolForTesting(fakePool as unknown as Piscina);

      await service.onModuleDestroy();
      expect(fakePool.destroy).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when no pool was constructed', async () => {
      // Fresh service, no setPoolForTesting call.
      const fresh = new PsdParserService();
      await expect(fresh.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
