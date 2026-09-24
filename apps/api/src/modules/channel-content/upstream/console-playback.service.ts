import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { extractYoutubeVideoId } from './youtube-video-id.util.js';
import type { Transaction } from '../../../infrastructure/database/transactions.js';

interface ConsolePlaybackConfig {
  get<T>(name: string): T | undefined;
}

export interface ResolvedPlayback {
  playbackUrl: string;
  expiresAt: string;
  title?: string;
  duration?: number;
  /** 'cached' = object cache/CDN 경유, 'proxy' = gateway origin live fetch */
  source: 'cached' | 'proxy';
}

@Injectable()
export class ConsolePlaybackService {
  private readonly logger = new Logger(ConsolePlaybackService.name);
  private readonly gatewayBaseUrl: string;
  private readonly cachedNodeUrls: string[];
  private readonly nodeUrls: string[];
  private readonly signSecret: string;
  private readonly ttlSeconds: number;
  private readonly mediaCdnBaseUrl: string;
  private readonly mediaCdnKeyPairId: string;
  private readonly mediaCdnPrivateKey: string;
  private readonly mediaCdnEnabled: boolean;
  constructor(
    private readonly configService: ConsolePlaybackConfig,
    private readonly prisma: Transaction['prisma'],
  ) {
    this.gatewayBaseUrl = (
      this.configService.get<string>('MEDIA_GATEWAY_BASE_URL') ?? ''
    ).replace(/\/$/, '');
    this.cachedNodeUrls = ConsolePlaybackService.parseNodeUrls(
      this.configService.get<string>('MEDIA_GATEWAY_CACHED_NODE_URLS'),
    );
    this.nodeUrls = ConsolePlaybackService.parseNodeUrls(
      this.configService.get<string>('MEDIA_GATEWAY_NODE_URLS'),
    );
    this.signSecret =
      this.configService.get<string>('MEDIA_GATEWAY_SIGN_SECRET') ?? '';
    this.mediaCdnBaseUrl = (
      this.configService.get<string>('MEDIA_CDN_BASE_URL') ?? ''
    ).replace(/\/$/, '');
    this.mediaCdnKeyPairId =
      this.configService.get<string>('MEDIA_CDN_KEY_PAIR_ID') ?? '';
    this.mediaCdnPrivateKey = (
      this.configService.get<string>('MEDIA_CDN_PRIVATE_KEY') ?? ''
    ).replace(/\\n/g, '\n');
    this.mediaCdnEnabled = false;
    if (
      this.mediaCdnBaseUrl &&
      this.mediaCdnKeyPairId &&
      this.mediaCdnPrivateKey
    ) {
      try {
        crypto.createPrivateKey(this.mediaCdnPrivateKey);
        this.mediaCdnEnabled = true;
      } catch {
        this.logger.error(
          'MEDIA_CDN_PRIVATE_KEY is invalid; cache hits will use the gateway fallback.',
        );
      }
    }
    // Kubernetes env values are always strings even though env.config parses
    // this field for the typed config object. ConfigService may still resolve
    // the raw process.env value first, so normalize it at the use site too.
    this.ttlSeconds = Number(
      this.configService.get<number | string>(
        'MEDIA_GATEWAY_URL_TTL_SECONDS',
      ) ?? 1800,
    );
  }

  /**
   * video_id 단위로 VideoCacheEntry 조회 → hit이면 CloudFront signed URL 반환.
   * miss면 온프렘 gateway /play URL을 반환한다. gateway가 같은 노드에서 원본 URL
   * 추출과 다운로드를 수행하고 S3 write-through + callback 등록까지 책임진다.
   *
   * 같은 video_id 는 채널/Song row와 무관하게 1회만 cached. 따라서 songId 파라미터는
   * 더 이상 lookup 에 사용되지 않으며 (호출 시그니처는 호환을 위해 유지) 향후 제거 대상.
   */
  async createPlaybackUrl(
    videoUrl: string,
    _songId?: number,
  ): Promise<ResolvedPlayback> {
    void _songId;
    if (!this.gatewayBaseUrl || !this.signSecret) {
      throw new ServiceUnavailableException(
        'Media gateway 설정이 비어있습니다.',
      );
    }

    const videoId = extractYoutubeVideoId(videoUrl);

    // 1. cache hit path: video_id 기반 lookup (Song row 무관)
    if (videoId) {
      const entry = await this.prisma.videoCacheEntry.findUnique({
        where: { videoId },
        select: { r2Key: true },
      });
      if (entry) {
        // hit timestamp 기록 — fire-and-forget, 실패해도 응답에 영향 없음
        await this.prisma.videoCacheEntry
          .update({
            where: { videoId },
            data: { lastHitAt: new Date() },
          })
          .catch(() => {
            /* lastHitAt 업데이트는 best-effort */
          });
        return this.signCachedUrl(entry.r2Key);
      }
    }

    // 2. cache miss path. Extraction and origin fetch must happen on the same
    //    gateway node because googlevideo URLs can be bound to the extractor IP.
    //    A separate resolver/proxy fallback would reintroduce that failure mode.
    if (!videoId) {
      throw new BadRequestException('지원하지 않는 YouTube 영상 URL입니다.');
    }
    return this.signPlayUrl(videoId);
  }

  // ───────── private ─────────

  /**
   * /play?vid=...&exp=...&sig=... URL 생성. 게이트웨이가 자체 yt-dlp 추출 +
   * 같은 IP fetch + R2 write-through + callback 책임.
   *
   * Node-specific URL: hash(video_id) 로 N 개 노드 중 하나를 골라, 같은 video_id
   * 는 항상 같은 노드로 가도록 한다. 게이트웨이는 노드 단위로 (origin → R2)
   * singleflight 를 돌리기 때문에, 동일 video_id 를 같은 노드로 보내야 dedupe
   * 가 의미 있게 동작한다. nodeUrls 가 비어있으면 main multivalue base URL 로
   * fallback (singleflight 효과는 사실상 없어짐).
   */
  private signPlayUrl(videoId: string): ResolvedPlayback {
    const baseUrl = this.selectGatewayNodeUrl(videoId);
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const canonical = ConsolePlaybackService.buildCanonical('GET', '/play', {
      exp: String(exp),
      vid: videoId,
    });
    const sig = crypto
      .createHmac('sha256', this.signSecret)
      .update(canonical)
      .digest('hex');
    const query = new URLSearchParams({ vid: videoId, exp: String(exp), sig });
    return {
      playbackUrl: `${baseUrl}/play?${query.toString()}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      // 새 endpoint 지만 frontend `source` 분기 단순화를 위해 'proxy' 재사용
      // (cache hit = 'cached', miss = 'proxy' 의 의미는 그대로).
      source: 'proxy',
    };
  }

  private selectGatewayNodeUrl(videoId: string): string {
    if (this.nodeUrls.length === 0) return this.gatewayBaseUrl;
    const firstByte = crypto.createHash('sha256').update(videoId).digest()[0]!;
    return this.nodeUrls[firstByte % this.nodeUrls.length];
  }

  private signCachedUrl(key: string): ResolvedPlayback {
    if (this.mediaCdnEnabled) {
      try {
        return this.signCloudFrontUrl(key);
      } catch {
        this.logger.error(
          'CloudFront URL signing failed; cache hit will use the gateway fallback.',
        );
      }
    }

    // Migration/rollback fallback: retain the previous signed gateway path
    // until the CloudFront key group and backend secret are both available.
    const baseUrl = this.selectCachedGatewayNodeUrl(key);
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const canonical = ConsolePlaybackService.buildCanonical(
      'GET',
      `/cached/${key}`,
      { exp: String(exp), key },
    );
    const sig = crypto
      .createHmac('sha256', this.signSecret)
      .update(canonical)
      .digest('hex');
    const query = new URLSearchParams({ exp: String(exp), sig });
    // path 인코딩: slash는 보존 (gateway는 path:path 매처 사용)
    const encodedKey = key
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    return {
      playbackUrl: `${baseUrl}/cached/${encodedKey}?${query.toString()}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      source: 'cached',
    };
  }

  private signCloudFrontUrl(key: string): ResolvedPlayback {
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const resourceUrl = `${this.mediaCdnBaseUrl}/${encodedKey}`;
    const policy = JSON.stringify({
      Statement: [
        {
          Resource: resourceUrl,
          Condition: {
            DateLessThan: { 'AWS:EpochTime': exp },
          },
        },
      ],
    });
    const signature = crypto
      .sign('RSA-SHA256', Buffer.from(policy, 'utf8'), this.mediaCdnPrivateKey)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/=/g, '_')
      .replace(/\//g, '~');
    const query = [
      `Expires=${exp}`,
      `Signature=${signature}`,
      `Key-Pair-Id=${encodeURIComponent(this.mediaCdnKeyPairId)}`,
      'Hash-Algorithm=SHA256',
    ].join('&');
    return {
      playbackUrl: `${resourceUrl}?${query}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      source: 'cached',
    };
  }

  private selectCachedGatewayNodeUrl(key: string): string {
    if (this.cachedNodeUrls.length === 0) return this.gatewayBaseUrl;
    const firstByte = crypto.createHash('sha256').update(key).digest()[0]!;
    return this.cachedNodeUrls[firstByte % this.cachedNodeUrls.length];
  }

  // ───────── static utils (재사용 + 테스트 가능) ─────────

  /**
   * Resolve the gateway node-URL list from `MEDIA_GATEWAY_NODE_URLS` (CSV).
   * Returns [] when nothing is configured — `selectGatewayNodeUrl` then
   * falls back to `MEDIA_GATEWAY_BASE_URL`.
   */
  static parseNodeUrls(csv: string | undefined): string[] {
    return (csv ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter((s) => s.length > 0);
  }

  static buildCanonical(
    method: string,
    path: string,
    params: Record<string, string>,
  ): string {
    const parts = [`method=${method.toUpperCase()}`, `path=${path}`];
    for (const key of Object.keys(params).sort()) {
      parts.push(`${key}=${params[key]}`);
    }
    return parts.join('&');
  }
}
