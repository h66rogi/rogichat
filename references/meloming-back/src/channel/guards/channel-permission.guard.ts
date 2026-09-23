import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CHANNEL_PERMISSION_SCOPE_KEY,
  ChannelPermissionScope,
} from './channel-permission.decorator';
import { ChannelService } from '../channel.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelManagerPermissions } from '../types/manager-permissions.type';

@Injectable()
export class ChannelPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly channelService: ChannelService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawUserId = request.user?.id;
    if (typeof rawUserId !== 'number') {
      throw new ForbiddenException('로그인이 필요합니다.');
    }
    const userId: number = rawUserId;

    const scope = this.reflector.get<ChannelPermissionScope>(
      CHANNEL_PERMISSION_SCOPE_KEY,
      context.getHandler(),
    );
    if (!scope) return true; // 스코프 미지정 시 통과

    const params = (request.params ?? {}) as Record<string, string | undefined>;
    let channelId: number | undefined;
    const identifierParam = params.channelId ?? params.identifier ?? params.id;
    if (typeof identifierParam === 'string' && identifierParam.length > 0) {
      const identifier: string = identifierParam;
      // 완전히 숫자로만 구성된 경우에만 ID로 처리
      if (/^\d+$/.test(identifier)) {
        channelId = Number.parseInt(identifier, 10);
      } else {
        const channel = await this.channelService.findByWebPath(identifier);
        channelId = channel.id;
      }
    }

    // 게스트북 전용: entryId 또는 replyId로부터 channelId 추론
    if (!channelId && scope === 'guestbook') {
      const entryIdParam = params.entryId;
      const replyIdParam = params.replyId;
      if (typeof entryIdParam === 'string') {
        const entryId = Number.parseInt(entryIdParam, 10);
        if (!Number.isNaN(entryId)) {
          const entry = await this.prisma.channelGuestbookEntry.findUnique({
            where: { id: entryId },
            select: { channelId: true, userId: true },
          });
          if (entry) {
            channelId = entry.channelId;
            // 작성자(author) 허용
            if (entry.userId === userId) return true;
          }
        }
      }
      if (!channelId && typeof replyIdParam === 'string') {
        const replyId = Number.parseInt(replyIdParam, 10);
        if (!Number.isNaN(replyId)) {
          const reply = await this.prisma.channelGuestbookReply.findUnique({
            where: { id: replyId },
            select: { userId: true, entry: { select: { channelId: true } } },
          });
          if (reply) {
            channelId = reply.entry.channelId;
            // 작성자(author) 허용
            if (reply.userId === userId) return true;
          }
        }
      }
    }

    if (!channelId) {
      throw new ForbiddenException('채널 식별자가 필요합니다.');
    }

    // Admin/Owner 통과
    const isAdmin = Boolean(request.user?.isAdmin);
    if (isAdmin) return true;

    const isOwner = await this.channelService.validateChannelOwnership(
      channelId,
      userId,
    );
    if (isOwner) return true;

    // 매니저 스코프 검사
    const manager = await this.channelService.getManagerPermissions(
      channelId,
      userId,
    );
    if (
      manager?.isActive &&
      ((scope === 'content' && manager.canManageContent) ||
        (scope === 'settings' && manager.canManageSettings) ||
        (scope === 'profile' && manager.canManageProfile) ||
        (scope === 'guestbook' && manager.canManageGuestbook) ||
        (scope === 'customization' && manager.canManageCustomization) ||
        (scope === 'emoticons' && manager.canManageEmoticons) ||
        (scope === 'overlay' &&
          (manager.canManageSettings || manager.canManageCustomization)))
    ) {
      return true;
    }

    throw new ForbiddenException('해당 채널에 대한 접근 권한이 없습니다.');
  }
}
