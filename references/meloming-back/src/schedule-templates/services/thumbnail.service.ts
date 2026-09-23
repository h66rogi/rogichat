import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { UploadService } from '../../upload/upload.service';

/**
 * Thumbnail 생성 단계에서 발생한 에러를 식별하기 위한 typed error.
 *
 * 호출 측은 일반 Error 와 구분해 "thumbnail 만 실패한 것" 인지
 * 다른 인프라 장애인지 분기할 수 있다. 현재 호출 경로(create/update 의
 * fire-and-forget) 는 이 에러를 받으면 warn 로그만 남기고 템플릿 자체는
 * 보존하므로 사용자 작업이 차단되지 않는다.
 *
 * `reason` 은 실패의 세부 원인(타임아웃/오버사이즈/허용 origin 위반 등)을
 * 식별하기 위한 보조 코드. `stage` 만으로는 부족한 상황(예: fetch 단계 안에서
 * SSRF 차단 vs 네트워크 오류 vs 타임아웃) 을 구분하려는 용도다.
 */
export type ThumbnailGenerationReason =
  | 'TIMEOUT'
  | 'OVERSIZED'
  | 'URL_NOT_ALLOWED'
  | 'INVALID_CONTENT_TYPE'
  | 'NETWORK'
  | 'HTTP_ERROR'
  | 'SHARP_ERROR'
  | 'UPLOAD_ERROR';

export class ThumbnailGenerationError extends Error {
  /**
   * @param stage 'fetch' | 'process' | 'upload' — 어느 단계에서 실패했는지
   *   디버깅 단서로 남긴다.
   * @param reason 세부 원인 코드. 호출자가 alarm/metric 를 분기할 때 사용.
   * @param cause 원래 에러. ESM `Error.cause` 와 호환되도록 별도 보관.
   */
  constructor(
    message: string,
    public readonly stage: 'fetch' | 'process' | 'upload',
    public readonly reason?: ThumbnailGenerationReason,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ThumbnailGenerationError';
  }
}

/**
 * baseImageUrl → 480px width WebP thumbnail 자동 생성.
 *
 * 정책:
 *  - resize: width=480, withoutEnlargement (480px 미만 원본은 그대로).
 *    aspect ratio 보존을 위해 height 미지정. 480 은 mid-tier retina
 *    디바이스의 list grid 카드(약 240~280 CSS px) 에서 2x 까지 커버하면서
 *    srcSet 듀얼 업로드 없이 단일 객체로 끝낼 수 있는 균형점.
 *  - encoding: webp(quality=80). PNG 대비 60-80% 작아 list grid 에서
 *    이득이 크다. sharp 0.34 가 기본 지원하므로 추가 의존성 없음.
 *  - upload folder: `schedule-templates/thumbnails` — UploadService 가
 *    `<folder>/YYYYMMDD/<uuid>.webp` 로 키를 생성한다.
 *
 * 보안/안정성 가드 (Codex F10 review):
 *  - **timeout 10s** — slow loris / 행 잡힌 origin 으로부터 워커 보호.
 *    AbortController 로 fetch 자체를 끊고, 끊어진 뒤에는 stream 도 cancel.
 *  - **size cap 50MB** — Content-Length 우선 차단(헤더 신뢰), 헤더 없는 CDN
 *    대비 streaming 누적 합산 도중에도 cap 초과 시 즉시 abort + throw.
 *    50MB 는 schedule template baseImage(보통 2-5MB PSD/PNG) 대비 충분히 여유.
 *  - **URL 허용목록(SSRF 방어)** — origin 이 `UPLOAD_CDN_URL`/S3 bucket public
 *    URL 둘 중 하나가 아니면 fetch 자체를 거부. 내부 메타데이터 endpoint
 *    (169.254.169.254 등) 나 사내망 IP 를 호출하는 SSRF 시도를 차단.
 *  - **Content-Type 검증** — 응답 Content-Type 이 image/* 의 화이트리스트에
 *    없으면 거부. text/html(에러 페이지)이나 application/json 이 sharp 로
 *    들어가는 사고 방지.
 *
 * 에러 정책:
 *  - fetch / sharp / upload 어느 단계든 실패하면 ThumbnailGenerationError
 *    로 감싸서 throw. 호출 측은 warn 로그만 남기고 템플릿은 그대로 유지.
 *  - silent fail 금지. 항상 stage / reason 정보를 포함한 typed error 로 surface.
 */
@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);

  /**
   * 단일 변 최대 픽셀 수.
   *
   * 480px 선택 이유 (Codex F10 review#3):
   *  - list grid 카드의 실제 CSS 폭은 약 240~280px (16:9 aspect, 좌우 padding 포함).
   *  - 320 은 1x 디바이스에선 충분하지만 2x retina(iPhone, MacBook 등) 에서
   *    원본 240~280 CSS px 를 480~560 device px 로 그려야 하므로 흐릿하다.
   *  - 480 은 한 번의 webp 인코딩만으로 1x/2x 디바이스를 모두 시각적으로
   *    선명하게 커버. srcSet 으로 1x/2x 를 따로 두 번 인코딩/업로드하는 것보다
   *    스토리지/CPU 모두 저렴하다.
   *  - withoutEnlargement: true 로 480px 미만 원본은 원본 크기를 보존.
   */
  private static readonly TARGET_WIDTH = 480;

  /**
   * webp encoder quality. 80 은 시각적으로 PNG 와 거의 구분이 안 가면서
   * 파일 크기를 1/3 ~ 1/4 로 줄인다. 그 이하는 schedule template 같은
   * 그래픽 텍스트가 깨질 수 있어 내림 금지.
   */
  private static readonly WEBP_QUALITY = 80;

  /**
   * fetch 단계 timeout (ms). slow origin / 끊긴 TCP 로부터 워커 보호.
   * AbortController 로 fetch + body stream 모두 끊는다.
   */
  private static readonly FETCH_TIMEOUT_MS = 10_000;

  /**
   * 다운로드 허용 최대 바이트. Content-Length 헤더 + streaming 누적 합산
   * 둘 다 이 값을 초과하면 OVERSIZED 로 throw.
   */
  private static readonly MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

  /**
   * 허용 Content-Type 화이트리스트. text/html(에러 페이지) 등이 sharp 에
   * 들어가지 않도록 명시적으로 한정.
   */
  private static readonly ALLOWED_CONTENT_TYPES: readonly string[] = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ];

  constructor(private readonly uploadService: UploadService) {}

  /**
   * baseImageUrl 을 fetch → sharp resize/webp → S3 업로드 후 CDN URL 반환.
   *
   * @throws ThumbnailGenerationError — fetch/process/upload 중 한 단계 실패
   */
  async generateAndUpload(
    baseImageUrl: string,
    channelId: number,
  ): Promise<string> {
    const buffer = await this.fetchImageBuffer(baseImageUrl);
    const webp = await this.processToWebp(buffer);
    return this.uploadWebp(webp, channelId);
  }

  /**
   * 허용된 origin 의 화이트리스트를 만든다.
   * `UPLOAD_CDN_URL` 과 S3 bucket public URL(둘 다 환경변수 기반) 의 origin
   * 만 신뢰. 둘 다 비어있으면 빈 set 을 돌려 모든 origin 이 차단되도록 한다
   * (테스트 환경에서 명시적으로 mock 한 origin 만 통과시키는 게 안전).
   *
   * 반환값:
   *  - origins: 그대로 origin 비교만으로 통과시킬 수 있는 host 집합
   *    (UPLOAD_CDN_URL, virtual-hosted style S3 host)
   *  - pathStyleS3Hosts: `s3.<region>.amazonaws.com` 처럼 host 가 bucket 정보를
   *    담고 있지 않은 path-style host 집합. 이 집합에 속한 origin 은
   *    추가로 첫 path segment 가 우리 bucket name 인지 검사해야 안전하다
   *    (다른 bucket 을 가리키는 SSRF 차단).
   *  - bucketName: path-style 검사를 위한 bucket 이름(없으면 null).
   *
   * NOTE: env 가 런타임에 바뀔 수 있으므로 매 호출마다 다시 계산한다 — 캐시 X.
   */
  private static buildAllowedOrigins(): {
    origins: Set<string>;
    pathStyleS3Hosts: Set<string>;
    bucketName: string | null;
  } {
    const origins = new Set<string>();
    const pathStyleS3Hosts = new Set<string>();

    const cdnUrl = process.env.UPLOAD_CDN_URL;
    if (cdnUrl) {
      try {
        origins.add(new URL(cdnUrl).origin);
      } catch {
        /* invalid env -> ignore, 다른 source 에서 보강될 수 있음 */
      }
    }

    const bucket = process.env.AWS_S3_BUCKET_NAME ?? null;
    const region = process.env.AWS_REGION ?? 'ap-northeast-2';
    if (bucket) {
      // virtual-hosted style: host 자체에 bucket 이 들어있어 origin 비교만으로
      // bucket 까지 강제된다. 다른 bucket 의 host 는 origin 자체가 다르므로 통과 X.
      origins.add(`https://${bucket}.s3.${region}.amazonaws.com`);
      origins.add(`https://${bucket}.s3.amazonaws.com`);
      // path-style: host 는 동일하고 bucket 은 path 첫 segment 로 들어간다.
      // 따라서 origin 만으로는 bucket 검증이 안 되므로 별도 set 에 둬서
      // path 검사 단계로 넘긴다 (Codex F10 review#3).
      pathStyleS3Hosts.add(`s3.${region}.amazonaws.com`);
    }

    return { origins, pathStyleS3Hosts, bucketName: bucket };
  }

  /**
   * URL 허용목록 검사. 외부 origin 으로의 SSRF 를 차단하는 first line.
   * `URL` 파싱이 실패하면(잘못된 URL) 거부.
   *
   * S3 path-style host(`s3.<region>.amazonaws.com`) 의 경우 bucket 정보가
   * path 에 들어있으므로 추가로 첫 path segment 가 우리 bucket 이름과
   * 일치하는지 강제 검사한다 (Codex F10 review#3 — over-permissive 차단).
   */
  private assertUrlAllowed(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      throw new ThumbnailGenerationError(
        `Invalid URL: ${url}`,
        'fetch',
        'URL_NOT_ALLOWED',
        err,
      );
    }
    const { origins, pathStyleS3Hosts, bucketName } =
      ThumbnailService.buildAllowedOrigins();

    // 1) virtual-hosted/일반 CDN — origin 자체가 화이트리스트에 있는지만 보면 OK.
    if (origins.has(parsed.origin)) return;

    // 2) S3 path-style — host 는 우리 region 의 path-style endpoint, 첫 path
    //    segment 는 우리 bucket 이름이어야 한다. 둘 다 만족해야 통과.
    //    URL.protocol 은 ':' 까지 포함하므로 parsed.origin 으로 https 강제.
    if (
      parsed.protocol === 'https:' &&
      pathStyleS3Hosts.has(parsed.hostname) &&
      bucketName
    ) {
      const firstSegment = parsed.pathname.split('/').filter(Boolean)[0];
      if (firstSegment === bucketName) return;
      this.logger.warn(
        `Thumbnail fetch blocked by S3 path-style bucket mismatch: ` +
          `expected=${bucketName} actual=${firstSegment ?? '(empty)'} url=${url}`,
      );
      throw new ThumbnailGenerationError(
        `S3 path-style URL must reference bucket ${bucketName} as first path segment`,
        'fetch',
        'URL_NOT_ALLOWED',
      );
    }

    // 3) 그 외 모두 거부.
    this.logger.warn(
      `Thumbnail fetch blocked by allowlist: origin=${parsed.origin} url=${url}`,
    );
    throw new ThumbnailGenerationError(
      `URL origin not in allowlist: ${parsed.origin}`,
      'fetch',
      'URL_NOT_ALLOWED',
    );
  }

  private async fetchImageBuffer(url: string): Promise<Buffer> {
    this.assertUrlAllowed(url);

    const ac = new AbortController();
    const timer = setTimeout(
      () => ac.abort(),
      ThumbnailService.FETCH_TIMEOUT_MS,
    );

    let response: Response;
    try {
      try {
        response = await fetch(url, { signal: ac.signal });
      } catch (err) {
        if (ac.signal.aborted) {
          this.logger.warn(`Thumbnail fetch timed out for url=${url}`);
          throw new ThumbnailGenerationError(
            `Thumbnail fetch timed out after ${ThumbnailService.FETCH_TIMEOUT_MS}ms`,
            'fetch',
            'TIMEOUT',
            err,
          );
        }
        this.logger.warn(
          `Thumbnail fetch failed (network) for url=${url}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new ThumbnailGenerationError(
          `Failed to fetch base image: ${url}`,
          'fetch',
          'NETWORK',
          err,
        );
      }

      if (!response.ok) {
        this.logger.warn(
          `Thumbnail fetch failed (status=${response.status}) for url=${url}`,
        );
        throw new ThumbnailGenerationError(
          `Failed to fetch base image (${response.status}): ${url}`,
          'fetch',
          'HTTP_ERROR',
        );
      }

      this.assertContentType(response, url);
      this.assertContentLength(response, url);

      return await this.readBodyWithSizeCap(response, url, ac);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Content-Type 화이트리스트 검사. 헤더 누락도 거부 — schedule template
   * baseImage 는 항상 우리가 업로드한 image/* 라서 헤더가 빠질 일이 없다.
   */
  private assertContentType(response: Response, url: string): void {
    const ct = response.headers.get('content-type');
    if (!ct) {
      this.logger.warn(`Thumbnail fetch missing Content-Type for url=${url}`);
      throw new ThumbnailGenerationError(
        'Missing Content-Type header',
        'process',
        'INVALID_CONTENT_TYPE',
      );
    }
    // Content-Type 은 `image/png; charset=binary` 같이 parameter 가 붙을 수
    // 있어 첫 토큰만 비교한다.
    const mediaType = ct.split(';')[0].trim().toLowerCase();
    if (!ThumbnailService.ALLOWED_CONTENT_TYPES.includes(mediaType)) {
      this.logger.warn(
        `Thumbnail fetch rejected by content-type policy: ct=${ct} url=${url}`,
      );
      throw new ThumbnailGenerationError(
        `Disallowed Content-Type: ${ct}`,
        'process',
        'INVALID_CONTENT_TYPE',
      );
    }
  }

  /**
   * Content-Length 가 들어오면 즉시 cap 검사. 일부 CDN 은 헤더를 안 보내므로
   * 통과하더라도 streaming 단계에서 한 번 더 검증 (readBodyWithSizeCap).
   */
  private assertContentLength(response: Response, url: string): void {
    const lenHeader = response.headers.get('content-length');
    if (!lenHeader) return;
    const len = Number(lenHeader);
    if (!Number.isFinite(len) || len < 0) return;
    if (len > ThumbnailService.MAX_DOWNLOAD_BYTES) {
      this.logger.warn(
        `Thumbnail fetch oversized (Content-Length=${len}) for url=${url}`,
      );
      throw new ThumbnailGenerationError(
        `Image too large: ${len} bytes (max ${ThumbnailService.MAX_DOWNLOAD_BYTES})`,
        'process',
        'OVERSIZED',
      );
    }
  }

  /**
   * Body stream 을 읽으면서 누적 바이트가 cap 을 넘는 즉시 abort.
   * Content-Length 헤더가 누락된 CDN 대비 두 번째 방어선.
   *
   * AbortError 분류 (Codex F10 review#3):
   *  - size cap 위반으로 우리가 직접 `ac.abort()` 한 경우 → 이미
   *    `ThumbnailGenerationError(reason='OVERSIZED')` 를 동기로 throw 했으므로
   *    아래 catch 는 도달하지 않는다. 단, stream 구현체에 따라 같은 abort
   *    신호가 다음 `reader.read()` 에서 raw AbortError 로 surface 할 수 있어
   *    방어적으로 OVERSIZED 로 reclassify 한다.
   *  - 외부 10s 타임아웃 timer 가 body-read 도중에 fire 한 경우 → AbortError
   *    가 올라오는데 이것은 TIMEOUT 으로 분류해야 한다. raw AbortError 가
   *    호출자에게 그대로 전파되면 reason 매핑이 깨진다.
   */
  private async readBodyWithSizeCap(
    response: Response,
    url: string,
    ac: AbortController,
  ): Promise<Buffer> {
    const body = response.body;
    if (!body) {
      // body 가 없는 응답은 0바이트 — sharp 가 invalid input 으로 reject.
      return Buffer.alloc(0);
    }
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    // 우리가 직접 size-cap 으로 abort 했는지 추적 — 이후 reader.read() 가 던지는
    // AbortError 를 OVERSIZED 로 분류하기 위한 플래그.
    let abortedBySizeCap = false;
    try {
      while (!done) {
        // ReadableStreamReadResult 는 discriminated union (done:true 일 때 value
        // 가 optional) 인데 빌드 환경에 따라 type 자체가 노출되지 않을 수 있어
        // 구조적 호환 타입으로 명시한다.
        let result: { done: boolean; value?: Uint8Array };
        try {
          result = await reader.read();
        } catch (err) {
          if (this.isAbortError(err)) {
            if (abortedBySizeCap) {
              throw new ThumbnailGenerationError(
                `Image too large (streamed ${total} bytes, max ${ThumbnailService.MAX_DOWNLOAD_BYTES})`,
                'process',
                'OVERSIZED',
                err,
              );
            }
            // size cap 이 아니라면 외부 timer 의 abort — TIMEOUT 으로 분류.
            this.logger.warn(
              `Thumbnail body-read aborted by timeout for url=${url}`,
            );
            throw new ThumbnailGenerationError(
              `Thumbnail fetch timed out during body read after ${ThumbnailService.FETCH_TIMEOUT_MS}ms`,
              'fetch',
              'TIMEOUT',
              err,
            );
          }
          // abort 가 아닌 stream/network 오류는 NETWORK 로 분류해 typed error 로
          // 항상 반환한다. raw error 가 호출자에게 새서 reason 매핑이 깨지지 않도록.
          this.logger.warn(
            `Thumbnail body-read failed for url=${url}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          throw new ThumbnailGenerationError(
            `Failed to read base image body: ${url}`,
            'fetch',
            'NETWORK',
            err,
          );
        }
        done = result.done;
        const value: Uint8Array | undefined = result.value;
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > ThumbnailService.MAX_DOWNLOAD_BYTES) {
          this.logger.warn(
            `Thumbnail download exceeded size cap mid-stream (read=${total}) for url=${url}`,
          );
          abortedBySizeCap = true;
          ac.abort();
          try {
            await reader.cancel();
          } catch (cancelErr) {
            // reader.cancel() 자체가 AbortError 를 reject 로 던질 수 있다.
            // 어차피 OVERSIZED 로 던질 것이므로 디버깅 흔적만 남기고 무시.
            if (!this.isAbortError(cancelErr)) {
              this.logger.warn(
                `reader.cancel() unexpected error for url=${url}: ${
                  cancelErr instanceof Error
                    ? cancelErr.message
                    : String(cancelErr)
                }`,
              );
            }
          }
          throw new ThumbnailGenerationError(
            `Image too large (streamed ${total} bytes, max ${ThumbnailService.MAX_DOWNLOAD_BYTES})`,
            'process',
            'OVERSIZED',
          );
        }
        chunks.push(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* 이미 release 된 경우 무시 */
      }
    }
    // chunks 는 ReadableStream 에서 받은 Uint8Array. Node Buffer.concat 은
    // Uint8Array[] 를 그대로 받을 수 있으므로 추가 변환 없이 합친다.
    return Buffer.concat(chunks, total);
  }

  /**
   * fetch / Web Streams 가 던지는 abort 류 에러 판별.
   * - Node18+ 의 Undici 는 `name === 'AbortError'` 또는 `code === 'ABORT_ERR'`
   *   을 사용한다. WHATWG ReadableStream 도 동일 컨벤션.
   * - DOMException 은 직접 `instanceof` 체크가 환경에 따라 흔들려 name 만 본다.
   */
  private isAbortError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { name?: unknown; code?: unknown };
    return e.name === 'AbortError' || e.code === 'ABORT_ERR';
  }

  private async processToWebp(input: Buffer): Promise<Buffer> {
    try {
      return await sharp(input)
        .resize({
          width: ThumbnailService.TARGET_WIDTH,
          withoutEnlargement: true,
        })
        .webp({ quality: ThumbnailService.WEBP_QUALITY })
        .toBuffer();
    } catch (err) {
      // sharp 내부 OOM / decoder crash 등 어떤 throw 도 typed error 로 감싼다.
      // 메시지는 그대로 보존하되 stack 은 cause 로만 전달.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Thumbnail processing failed (sharp): ${msg}`);
      throw new ThumbnailGenerationError(
        `Failed to resize/encode thumbnail: ${msg}`,
        'process',
        'SHARP_ERROR',
        err,
      );
    }
  }

  private async uploadWebp(buffer: Buffer, channelId: number): Promise<string> {
    try {
      const result = await this.uploadService.uploadBuffer({
        buffer,
        mimetype: 'image/webp',
        // 키 자체는 서버가 UUID 로 생성하므로 originalname 은 단지 확장자
        // 힌트와 디버깅 컨텍스트(채널 id)만 담는다.
        originalname: `template-thumb-channel-${channelId}.webp`,
        folder: 'schedule-templates/thumbnails',
      });
      return result.fileUrl;
    } catch (err) {
      this.logger.warn(
        `Thumbnail upload failed for channel=${channelId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new ThumbnailGenerationError(
        `Failed to upload thumbnail for channel ${channelId}`,
        'upload',
        'UPLOAD_ERROR',
        err,
      );
    }
  }
}
