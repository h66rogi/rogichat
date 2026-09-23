import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChannelService } from '../channel.service';

@Injectable()
export class ChannelOwnershipGuard implements CanActivate {
  constructor(private readonly channelService: ChannelService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawUserId = request.user?.id;
    if (typeof rawUserId !== 'number') {
      throw new ForbiddenException('로그인이 필요합니다.');
    }
    const userId: number = rawUserId;
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    const identifierParam = params.identifier ?? params.channelId;

    if (typeof identifierParam !== 'string' || identifierParam.length === 0) {
      throw new NotFoundException('채널 식별자가 제공되지 않았습니다.');
    }
    const identifier: string = identifierParam;

    // identifier를 channelId로 변환 (완전히 숫자인 경우만 ID로 처리)
    // webPath는 영어로 시작하므로 완전히 숫자인 경우만 ID로 판단
    if (!/^\d+$/.test(identifier)) {
      throw new ForbiddenException(
        'webPath로는 소유자 검증이 불가능합니다. channelId를 사용해주세요.',
      );
    }
    const channelId = Number.parseInt(identifier, 10);

    // Channel 존재 및 소유권 확인
    const hasOwnership = await this.channelService.validateChannelOwnership(
      channelId,
      userId,
    );

    if (!hasOwnership) {
      throw new ForbiddenException('해당 채널에 대한 접근 권한이 없습니다.');
    }

    request.channelId = channelId;

    return true;
  }
}
