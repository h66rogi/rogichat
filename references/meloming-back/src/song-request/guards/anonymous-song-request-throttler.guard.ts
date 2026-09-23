import {
  Injectable,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import { getAnonymousClientIp } from '../../common/utils/ip.utils';

/**
 * 비로그인(익명) 신청곡 POST 요청만 대상으로 rate-limit을 걸고,
 * 로그인 유저는 throttle을 skip한다.
 *
 * 429 에러는 단순 Too Many Requests 문자열이 아니라 프론트가 구체적 안내 모달을
 * 띄울 수 있도록 구조화된 페이로드를 반환한다:
 *   { statusCode, code, message, retryAfterSeconds, limit, windowSeconds, throttlerName }
 */
@Injectable()
export class AnonymousSongRequestThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (await super.shouldSkip(context)) return true;
    const req = context.switchToHttp().getRequest();
    // 로그인 유저는 throttle 대상 아님 — 익명 신청 경로만 방어
    return typeof req?.user?.id === 'number';
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = getAnonymousClientIp(req as any) ?? 'unknown';
    return `anon-song-request:${ip}`;
  }

  protected async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const windowSeconds = Math.ceil(detail.ttl / 1000);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((detail.timeToBlockExpire || detail.timeToExpire) / 1000),
    );
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'ANONYMOUS_RATE_LIMIT',
        message: '익명 신청이 너무 빈번합니다. 잠시 후 다시 시도해 주세요.',
        retryAfterSeconds,
        limit: detail.limit,
        windowSeconds,
        throttlerName: detail.key?.split('-').slice(-2).join('-') ?? null,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
