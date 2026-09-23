// sharp 는 native binding 을 로드하므로 spec 단계에서 mock 한다.
// (실제 webp 인코더 테스트는 통합/E2E 에서 다룸)
jest.mock('sharp', () => {
  return jest.fn();
});

import sharp from 'sharp';
import { Logger } from '@nestjs/common';
import {
  ThumbnailGenerationError,
  ThumbnailService,
} from './thumbnail.service';

const sharpMock = sharp as unknown as jest.Mock;

type UploadServiceMock = {
  uploadBuffer: jest.Mock;
};

function createUploadServiceMock(): UploadServiceMock {
  return { uploadBuffer: jest.fn() };
}

/**
 * sharp().resize().webp().toBuffer() 체인을 stub.
 * `toBufferReturn` 으로 최종 toBuffer() 의 반환을 제어한다.
 *  - Buffer 면 resolve
 *  - Error 면 reject
 */
function stubSharpChain(toBufferReturn: Buffer | Error): jest.Mock {
  const toBufferMock = jest.fn();
  if (toBufferReturn instanceof Error) {
    toBufferMock.mockRejectedValue(toBufferReturn);
  } else {
    toBufferMock.mockResolvedValue(toBufferReturn);
  }
  const webpMock = jest.fn().mockReturnValue({ toBuffer: toBufferMock });
  const resizeMock = jest.fn().mockReturnValue({ webp: webpMock });
  sharpMock.mockImplementation(() => ({ resize: resizeMock }));
  return resizeMock;
}

/**
 * 기본 fetch mock 응답 빌더.
 * - body 는 Web ReadableStream (한 번에 하나의 chunk 를 enqueue 후 close) 으로 만들어
 *   ThumbnailService 의 streaming size cap 코드를 자연스럽게 통과시킨다.
 * - chunks 인자로 여러 청크를 보내고 싶으면 array 로 넘긴다.
 */
function makeFetchResponse(opts: {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  contentLength?: string | null;
  chunks?: Uint8Array[];
}): Response {
  const headers = new Headers();
  if (opts.contentType !== null && opts.contentType !== undefined) {
    headers.set('content-type', opts.contentType);
  }
  if (opts.contentLength !== null && opts.contentLength !== undefined) {
    headers.set('content-length', opts.contentLength);
  }
  const chunks = opts.chunks ?? [new Uint8Array([0x89, 0x50, 0x4e, 0x47])];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers,
    body,
  } as unknown as Response;
}

/**
 * https://cdn.example.com 을 ThumbnailService 의 allowlist 에 등록.
 * UPLOAD_CDN_URL 한 칸을 차지하므로 테스트 내내 동일 base 를 쓰면 된다.
 */
function setAllowlistEnv(): void {
  process.env.UPLOAD_CDN_URL = 'https://cdn.example.com';
  process.env.AWS_S3_BUCKET_NAME = 'meloming-upload-test';
  process.env.AWS_REGION = 'ap-northeast-2';
}

function clearAllowlistEnv(): void {
  delete process.env.UPLOAD_CDN_URL;
  delete process.env.AWS_S3_BUCKET_NAME;
  delete process.env.AWS_REGION;
}

describe('ThumbnailService', () => {
  let upload: UploadServiceMock;
  let service: ThumbnailService;
  let warnSpy: jest.SpyInstance;
  const originalFetch = globalThis.fetch;
  const envSnapshot = {
    UPLOAD_CDN_URL: process.env.UPLOAD_CDN_URL,
    AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME,
    AWS_REGION: process.env.AWS_REGION,
  };

  beforeEach(() => {
    upload = createUploadServiceMock();
    service = new ThumbnailService(upload as never);
    sharpMock.mockReset();
    setAllowlistEnv();
    // Logger.warn / log 출력 억제 — 실제 출력 검증은 별도 케이스에서.
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
    warnSpy.mockRestore();
    jest.clearAllMocks();
    // env 복구 — 다른 spec 에 영향 주지 않게.
    clearAllowlistEnv();
    if (envSnapshot.UPLOAD_CDN_URL !== undefined) {
      process.env.UPLOAD_CDN_URL = envSnapshot.UPLOAD_CDN_URL;
    }
    if (envSnapshot.AWS_S3_BUCKET_NAME !== undefined) {
      process.env.AWS_S3_BUCKET_NAME = envSnapshot.AWS_S3_BUCKET_NAME;
    }
    if (envSnapshot.AWS_REGION !== undefined) {
      process.env.AWS_REGION = envSnapshot.AWS_REGION;
    }
  });

  describe('generateAndUpload (happy path)', () => {
    it('fetches → resizes to width=480 webp → uploads with channel folder', async () => {
      const sourceBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const webpBuffer = Buffer.from('webp-bytes');

      const fetchMock = jest.fn().mockResolvedValue(
        makeFetchResponse({
          contentType: 'image/png',
          chunks: [sourceBytes],
        }),
      );
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      const resizeMock = stubSharpChain(webpBuffer);

      upload.uploadBuffer.mockResolvedValue({
        fileUrl: 'https://cdn.example.com/abc.webp',
        fileName: 'abc.webp',
      });

      const url = await service.generateAndUpload(
        'https://cdn.example.com/base.png',
        42,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'https://cdn.example.com/base.png',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(resizeMock).toHaveBeenCalledWith({
        width: 480,
        withoutEnlargement: true,
      });
      expect(upload.uploadBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          buffer: webpBuffer,
          mimetype: 'image/webp',
          folder: 'schedule-templates/thumbnails',
        }),
      );
      // sharp 에 들어간 입력 buffer 가 fetch 한 바이트와 동일한지 검증.
      const sharpInput = sharpMock.mock.calls[0][0] as Buffer;
      expect(Buffer.isBuffer(sharpInput)).toBe(true);
      expect(Array.from(sharpInput)).toEqual(Array.from(sourceBytes));
      // originalname 은 확장자 힌트만 검증
      const callArgs = upload.uploadBuffer.mock.calls[0][0] as {
        originalname: string;
      };
      expect(callArgs.originalname).toMatch(/\.webp$/);
      expect(url).toBe('https://cdn.example.com/abc.webp');
    });

    it('accepts image/jpeg, image/webp, image/gif content-types', async () => {
      const webpBuffer = Buffer.from('w');
      stubSharpChain(webpBuffer);
      upload.uploadBuffer.mockResolvedValue({
        fileUrl: 'https://cdn.example.com/x.webp',
        fileName: 'x.webp',
      });
      for (const ct of ['image/jpeg', 'image/webp', 'image/gif']) {
        const fetchMock = jest
          .fn()
          .mockResolvedValue(makeFetchResponse({ contentType: ct }));
        (globalThis as { fetch: typeof fetch }).fetch =
          fetchMock as unknown as typeof fetch;
        await expect(
          service.generateAndUpload('https://cdn.example.com/x', 1),
        ).resolves.toBe('https://cdn.example.com/x.webp');
      }
    });

    it('strips Content-Type parameters before whitelist check (e.g. "image/png; charset=binary")', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        makeFetchResponse({
          contentType: 'image/png; charset=binary',
        }),
      );
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;
      stubSharpChain(Buffer.from('w'));
      upload.uploadBuffer.mockResolvedValue({
        fileUrl: 'https://cdn.example.com/x.webp',
        fileName: 'x.webp',
      });
      await expect(
        service.generateAndUpload('https://cdn.example.com/x', 1),
      ).resolves.toBeTruthy();
    });
  });

  describe('error paths', () => {
    it('throws ThumbnailGenerationError(stage=fetch, reason=NETWORK) on network error', async () => {
      const fetchMock = jest
        .fn()
        .mockRejectedValue(new TypeError('ECONNREFUSED'));
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload('https://cdn.example.com/x.png', 1),
      ).rejects.toMatchObject({
        name: 'ThumbnailGenerationError',
        stage: 'fetch',
        reason: 'NETWORK',
      });
      expect(upload.uploadBuffer).not.toHaveBeenCalled();
    });

    it('throws ThumbnailGenerationError(stage=fetch, reason=HTTP_ERROR) on non-ok response', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        makeFetchResponse({
          ok: false,
          status: 404,
          contentType: 'image/png',
        }),
      );
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload('https://cdn.example.com/x.png', 1),
      ).rejects.toMatchObject({
        name: 'ThumbnailGenerationError',
        stage: 'fetch',
        reason: 'HTTP_ERROR',
      });
      expect(upload.uploadBuffer).not.toHaveBeenCalled();
    });

    it('throws ThumbnailGenerationError(stage=process, reason=SHARP_ERROR) when sharp fails', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(makeFetchResponse({ contentType: 'image/png' }));
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      stubSharpChain(new Error('Input file is not a recognised image'));

      await expect(
        service.generateAndUpload('https://cdn.example.com/x.png', 1),
      ).rejects.toMatchObject({
        name: 'ThumbnailGenerationError',
        stage: 'process',
        reason: 'SHARP_ERROR',
      });
      expect(upload.uploadBuffer).not.toHaveBeenCalled();
    });

    it('preserves underlying message in SHARP_ERROR (helps debug OOM / decoder crash)', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue(makeFetchResponse({ contentType: 'image/png' }));
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;
      stubSharpChain(new Error('libvips: insufficient memory'));

      const err = await service
        .generateAndUpload('https://cdn.example.com/x.png', 1)
        .catch((e) => e as ThumbnailGenerationError);
      expect(err).toBeInstanceOf(ThumbnailGenerationError);
      expect((err as ThumbnailGenerationError).message).toContain(
        'libvips: insufficient memory',
      );
    });

    it('throws ThumbnailGenerationError(stage=upload, reason=UPLOAD_ERROR) when S3 upload fails', async () => {
      const webpBuffer = Buffer.from('webp');
      const fetchMock = jest
        .fn()
        .mockResolvedValue(makeFetchResponse({ contentType: 'image/png' }));
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      stubSharpChain(webpBuffer);
      upload.uploadBuffer.mockRejectedValue(new Error('S3 down'));

      await expect(
        service.generateAndUpload('https://cdn.example.com/x.png', 1),
      ).rejects.toMatchObject({
        name: 'ThumbnailGenerationError',
        stage: 'upload',
        reason: 'UPLOAD_ERROR',
      });
    });
  });

  describe('SSRF defense (URL allowlist)', () => {
    it('rejects origin not in allowlist (UPLOAD_CDN_URL or S3 bucket)', async () => {
      const fetchMock = jest.fn();
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload('https://evil.example.org/x.png', 1),
      ).rejects.toMatchObject({
        stage: 'fetch',
        reason: 'URL_NOT_ALLOWED',
      });
      // fetch 자체가 호출되면 안 됨 (네트워크에 한 번도 닿지 않아야 SSRF 방어)
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects internal metadata IP (e.g. AWS 169.254.169.254)', async () => {
      const fetchMock = jest.fn();
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload(
          'http://169.254.169.254/latest/meta-data/',
          1,
        ),
      ).rejects.toMatchObject({
        stage: 'fetch',
        reason: 'URL_NOT_ALLOWED',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects malformed URL with URL_NOT_ALLOWED', async () => {
      await expect(
        service.generateAndUpload('not-a-url', 1),
      ).rejects.toMatchObject({
        stage: 'fetch',
        reason: 'URL_NOT_ALLOWED',
      });
    });

    it('allows S3 bucket virtual-hosted URL when env is set', async () => {
      process.env.AWS_S3_BUCKET_NAME = 'meloming-upload-test';
      process.env.AWS_REGION = 'ap-northeast-2';
      const fetchMock = jest
        .fn()
        .mockResolvedValue(makeFetchResponse({ contentType: 'image/png' }));
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;
      stubSharpChain(Buffer.from('w'));
      upload.uploadBuffer.mockResolvedValue({
        fileUrl: 'https://cdn.example.com/x.webp',
        fileName: 'x.webp',
      });

      await expect(
        service.generateAndUpload(
          'https://meloming-upload-test.s3.ap-northeast-2.amazonaws.com/key.png',
          1,
        ),
      ).resolves.toBeTruthy();
    });

    // S3 path-style 의 경우 host 만으로는 bucket 검증이 안 됨 — 첫 path
    // segment 가 bucket 이름인지 추가 확인이 필수 (Codex F10 review#3).
    describe('S3 path-style bucket enforcement', () => {
      it('allows path-style URL when first path segment is the configured bucket', async () => {
        const fetchMock = jest
          .fn()
          .mockResolvedValue(makeFetchResponse({ contentType: 'image/png' }));
        (globalThis as { fetch: typeof fetch }).fetch =
          fetchMock as unknown as typeof fetch;
        stubSharpChain(Buffer.from('w'));
        upload.uploadBuffer.mockResolvedValue({
          fileUrl: 'https://cdn.example.com/x.webp',
          fileName: 'x.webp',
        });

        await expect(
          service.generateAndUpload(
            'https://s3.ap-northeast-2.amazonaws.com/meloming-upload-test/foo.png',
            1,
          ),
        ).resolves.toBeTruthy();
      });

      it('rejects path-style URL pointing at a different bucket → URL_NOT_ALLOWED', async () => {
        const fetchMock = jest.fn();
        (globalThis as { fetch: typeof fetch }).fetch =
          fetchMock as unknown as typeof fetch;

        await expect(
          service.generateAndUpload(
            'https://s3.ap-northeast-2.amazonaws.com/other-bucket/foo.png',
            1,
          ),
        ).rejects.toMatchObject({
          stage: 'fetch',
          reason: 'URL_NOT_ALLOWED',
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('rejects path-style URL with empty path (no bucket segment)', async () => {
        const fetchMock = jest.fn();
        (globalThis as { fetch: typeof fetch }).fetch =
          fetchMock as unknown as typeof fetch;

        await expect(
          service.generateAndUpload(
            'https://s3.ap-northeast-2.amazonaws.com/',
            1,
          ),
        ).rejects.toMatchObject({
          stage: 'fetch',
          reason: 'URL_NOT_ALLOWED',
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('rejects path-style URL with no path at all (origin root)', async () => {
        const fetchMock = jest.fn();
        (globalThis as { fetch: typeof fetch }).fetch =
          fetchMock as unknown as typeof fetch;

        await expect(
          service.generateAndUpload(
            'https://s3.ap-northeast-2.amazonaws.com',
            1,
          ),
        ).rejects.toMatchObject({
          stage: 'fetch',
          reason: 'URL_NOT_ALLOWED',
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('rejects virtual-hosted URL pointing at a different bucket', async () => {
        // Codex review#3 의 cross-check: virtual-hosted host 비교는 origin 자체가
        // 다르면 화이트리스트에 매치되지 않아야 한다.
        const fetchMock = jest.fn();
        (globalThis as { fetch: typeof fetch }).fetch =
          fetchMock as unknown as typeof fetch;

        await expect(
          service.generateAndUpload(
            'https://other-bucket.s3.ap-northeast-2.amazonaws.com/foo.png',
            1,
          ),
        ).rejects.toMatchObject({
          stage: 'fetch',
          reason: 'URL_NOT_ALLOWED',
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('rejects http (non-https) S3 path-style URL', async () => {
        // attacker 가 https → http 로 바꿔 우회 시도하는 케이스 차단 검증.
        const fetchMock = jest.fn();
        (globalThis as { fetch: typeof fetch }).fetch =
          fetchMock as unknown as typeof fetch;

        await expect(
          service.generateAndUpload(
            'http://s3.ap-northeast-2.amazonaws.com/meloming-upload-test/foo.png',
            1,
          ),
        ).rejects.toMatchObject({
          stage: 'fetch',
          reason: 'URL_NOT_ALLOWED',
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });
  });

  describe('timeout (10s) via AbortController', () => {
    it('aborts the fetch when timer fires → ThumbnailGenerationError(stage=fetch, reason=TIMEOUT)', async () => {
      jest.useFakeTimers();
      try {
        // fetch 가 abort 시그널을 받으면 reject 하도록 mock.
        const fetchMock = jest.fn(
          (
            _url: string,
            init?: { signal?: AbortSignal },
          ) =>
            new Promise((_resolve, reject) => {
              const sig = init?.signal;
              if (sig) {
                sig.addEventListener('abort', () => {
                  // Web fetch 가 abort 시 던지는 DOMException 흉내.
                  const e = new Error('aborted');
                  e.name = 'AbortError';
                  reject(e);
                });
              }
            }),
        );
        (globalThis as { fetch: typeof fetch }).fetch =
          fetchMock as unknown as typeof fetch;

        const promise = service.generateAndUpload(
          'https://cdn.example.com/slow.png',
          1,
        );
        // 10s 가 지나면 AbortController 가 abort → fetch reject → catch.
        jest.advanceTimersByTime(10_000);
        await expect(promise).rejects.toMatchObject({
          stage: 'fetch',
          reason: 'TIMEOUT',
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('AbortError reclassification on body read (Codex F10 review#3)', () => {
    it('reclassifies AbortError-during-reader.read() as TIMEOUT (raw AbortError must not leak)', async () => {
      // 시나리오: response.body.getReader().read() 진행 중에 외부 10s timer 가
      // ac.abort() 를 발사 → reader.read() 가 raw AbortError 로 reject.
      // 우리는 이걸 TIMEOUT 으로 reclassify 해야 한다 (호출자가 AbortError 를
      // 그대로 받으면 reason 매핑이 깨지므로).
      //
      // ReadableStream native 구현 대신 reader 를 직접 stub 해서 가드를 정밀하게
      // 검증한다 (timer/event-loop 타이밍에 의존하지 않도록).
      const abortError = Object.assign(new Error('aborted'), {
        name: 'AbortError',
      });
      const readMock = jest.fn().mockRejectedValue(abortError);
      const releaseLockMock = jest.fn();
      const stubbedBody = {
        getReader: jest.fn().mockReturnValue({
          read: readMock,
          releaseLock: releaseLockMock,
          cancel: jest.fn().mockResolvedValue(undefined),
        }),
      } as unknown as ReadableStream<Uint8Array>;

      const headers = new Headers({ 'content-type': 'image/png' });
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers,
        body: stubbedBody,
      } as unknown as Response);
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload('https://cdn.example.com/slow.png', 1),
      ).rejects.toMatchObject({
        name: 'ThumbnailGenerationError',
        // body-read 단계에서 raw AbortError 를 만났을 때 TIMEOUT 으로 분류.
        // (raw `AbortError` 가 그대로 surface 되면 안 된다.)
        reason: 'TIMEOUT',
      });
      expect(readMock).toHaveBeenCalled();
    });

    it('reclassifies non-abort reader.read() failure as NETWORK (typed error, cause preserved)', async () => {
      // AbortError 가 아닌 stream 오류(끊긴 TCP, malformed chunk 등) 는 NETWORK
      // typed error 로 감싸 raw error 가 호출자에게 새지 않도록 한다.
      // cause 에 원래 에러를 보존해 silent fail 금지 원칙을 유지한다.
      const networkErr = Object.assign(new Error('chunked transfer broken'), {
        name: 'TypeError',
      });
      const readMock = jest.fn().mockRejectedValue(networkErr);
      const stubbedBody = {
        getReader: jest.fn().mockReturnValue({
          read: readMock,
          releaseLock: jest.fn(),
          cancel: jest.fn().mockResolvedValue(undefined),
        }),
      } as unknown as ReadableStream<Uint8Array>;

      const headers = new Headers({ 'content-type': 'image/png' });
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers,
        body: stubbedBody,
      } as unknown as Response);
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      const err = await service
        .generateAndUpload('https://cdn.example.com/x.png', 1)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ThumbnailGenerationError);
      expect((err as ThumbnailGenerationError).stage).toBe('fetch');
      expect((err as ThumbnailGenerationError).reason).toBe('NETWORK');
      expect((err as ThumbnailGenerationError).cause).toBe(networkErr);
    });
  });

  describe('size cap (50MB)', () => {
    it('rejects when Content-Length header exceeds 50MB → reason=OVERSIZED', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        makeFetchResponse({
          contentType: 'image/png',
          contentLength: String(60 * 1024 * 1024),
        }),
      );
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload('https://cdn.example.com/big.png', 1),
      ).rejects.toMatchObject({
        stage: 'process',
        reason: 'OVERSIZED',
      });
      // sharp 까지 가지 않음
      expect(sharpMock).not.toHaveBeenCalled();
    });

    it('aborts mid-stream when streamed bytes exceed 50MB even without Content-Length', async () => {
      // 51MB 를 1MB 단위 청크 51개로 보낸다. Content-Length 헤더는 없음.
      const oneMB = new Uint8Array(1024 * 1024);
      const chunks = Array.from({ length: 51 }, () => oneMB);
      const fetchMock = jest.fn().mockResolvedValue(
        makeFetchResponse({
          contentType: 'image/png',
          contentLength: null,
          chunks,
        }),
      );
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload('https://cdn.example.com/big.png', 1),
      ).rejects.toMatchObject({
        stage: 'process',
        reason: 'OVERSIZED',
      });
      expect(sharpMock).not.toHaveBeenCalled();
    });

    it('passes when Content-Length is well under 50MB', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        makeFetchResponse({
          contentType: 'image/png',
          contentLength: '1024',
        }),
      );
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;
      stubSharpChain(Buffer.from('w'));
      upload.uploadBuffer.mockResolvedValue({
        fileUrl: 'https://cdn.example.com/x.webp',
        fileName: 'x.webp',
      });
      await expect(
        service.generateAndUpload('https://cdn.example.com/x.png', 1),
      ).resolves.toBeTruthy();
    });
  });

  describe('Content-Type validation', () => {
    it('rejects text/html (server returned an error page) → INVALID_CONTENT_TYPE', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        makeFetchResponse({
          contentType: 'text/html',
        }),
      );
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload('https://cdn.example.com/x.png', 1),
      ).rejects.toMatchObject({
        stage: 'process',
        reason: 'INVALID_CONTENT_TYPE',
      });
      expect(sharpMock).not.toHaveBeenCalled();
    });

    it('rejects when Content-Type header is missing → INVALID_CONTENT_TYPE', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        makeFetchResponse({
          contentType: null,
        }),
      );
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload('https://cdn.example.com/x.png', 1),
      ).rejects.toMatchObject({
        stage: 'process',
        reason: 'INVALID_CONTENT_TYPE',
      });
      expect(sharpMock).not.toHaveBeenCalled();
    });

    it('rejects exotic image type not on whitelist (e.g. image/svg+xml)', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        makeFetchResponse({
          contentType: 'image/svg+xml',
        }),
      );
      (globalThis as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch;

      await expect(
        service.generateAndUpload('https://cdn.example.com/x.svg', 1),
      ).rejects.toMatchObject({
        stage: 'process',
        reason: 'INVALID_CONTENT_TYPE',
      });
    });
  });

  it('ThumbnailGenerationError carries cause, stage, and reason', () => {
    const cause = new Error('original');
    const err = new ThumbnailGenerationError(
      'msg',
      'process',
      'SHARP_ERROR',
      cause,
    );
    expect(err.stage).toBe('process');
    expect(err.reason).toBe('SHARP_ERROR');
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
  });
});
