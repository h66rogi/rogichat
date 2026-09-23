import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StreamPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 채팅 명령 권한 정의.
 *
 * - `owner-only`: 채널 소유자만.
 * - `owner-or-manager`: 소유자 또는 isActive=true && permissionKey=true 매니저.
 *
 * permissionKey는 `ChannelManager`의 컬럼명을 그대로 사용 (예: `canManageSettings`,
 * `canManageContent`).
 */
export type RequiredOperatorRole =
  | { kind: 'owner-only' }
  | {
      kind: 'owner-or-manager';
      permissionKey: 'canManageSettings' | 'canManageContent';
    };

export interface ResolvedOperator {
  userId: number;
  channelId: number;
  sessionId: number;
  isOwner: boolean;
}

/**
 * 채팅 명령 발화자가 세션을 조작할 권한이 있는지 검증한다.
 *
 * 흐름:
 * 1. SOOP `(2)`/`(3)` 접미사 정규화 → `UserPlatformVerification` (isVerified=true) 매핑
 * 2. `LiveSession` ACTIVE 검증 → channelId 획득
 * 3. owner 일치 시 즉시 통과
 * 4. role.kind === 'owner-or-manager' 면 ChannelManager 권한 검사
 * 5. 모든 실패는 ForbiddenException / NotFoundException — 호출자가 별도 분기 X
 *
 * 검증 실패에 대해 `null` 반환 대신 throw를 쓰는 이유: dedupe Map cleanup 같은
 * 보상 로직이 try/catch 한 곳에 모이고, 호출 측에서 결과 분기를 빼먹는 사고를
 * 막기 위함.
 */
export async function resolveChannelOperator(
  prisma: PrismaService,
  input: {
    platform: StreamPlatform;
    platformUserId: string;
    sessionId: number;
    role: RequiredOperatorRole;
  },
): Promise<ResolvedOperator> {
  // SOOP 만 동일 유저가 여러 방송 시청 시 채팅에서 `(2)`/`(3)` 같은 1자리 접미사 부여.
  // 다른 플랫폼(CHZZK/CIME/OTHER)에서는 ID 자체에 `(\d)` 가 들어 있을 수 있으므로
  // 무조건 제거하면 다른 사용자 검증 row 와 매칭되어 권한 우회 위험. SOOP 한정.
  const normalizedPlatformUserId =
    input.platform === StreamPlatform.SOOP
      ? input.platformUserId.replace(/\([1-9]\)$/, '')
      : input.platformUserId;

  const verification = await prisma.userPlatformVerification.findFirst({
    where: {
      platform: input.platform,
      platformUserId: normalizedPlatformUserId,
      isVerified: true,
    },
  });
  if (!verification) {
    throw new ForbiddenException();
  }
  const userId = verification.userId;

  const session = await prisma.liveSession.findUnique({
    where: { id: input.sessionId },
    select: { id: true, channelId: true, status: true },
  });
  if (!session || session.status !== 'ACTIVE') {
    throw new NotFoundException();
  }

  const channel = await prisma.channel.findUnique({
    where: { id: session.channelId },
    select: { userId: true },
  });
  if (!channel) {
    throw new NotFoundException();
  }

  const isOwner = channel.userId === userId;
  if (isOwner) {
    return {
      userId,
      channelId: session.channelId,
      sessionId: session.id,
      isOwner: true,
    };
  }

  if (input.role.kind === 'owner-only') {
    throw new ForbiddenException();
  }

  const manager = await prisma.channelManager.findUnique({
    where: {
      channelId_userId: { channelId: session.channelId, userId },
    },
  });
  if (
    manager?.isActive !== true ||
    manager[input.role.permissionKey] !== true
  ) {
    throw new ForbiddenException();
  }

  return {
    userId,
    channelId: session.channelId,
    sessionId: session.id,
    isOwner: false,
  };
}
