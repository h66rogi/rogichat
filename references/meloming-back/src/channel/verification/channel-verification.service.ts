import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformService } from '../../platform/platform.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SlackWebhookService } from '../../common/slack/slack-webhook.service';
import { MetricsService } from '../../metrics';
import { NotificationType } from '../../notifications/constants/notification-types';
import {
  ChannelVerification,
  ChannelVerificationStatus,
  ChannelVerificationPendingReason,
  ChannelVerificationAction,
  ChannelVerificationActorType,
  StreamPlatform,
  UserPlatformVerification,
  Prisma,
} from '@prisma/client';
import { CreateChannelVerificationDto } from './dto/channel-verification.request.dto';
import {
  ChannelVerificationPreviewDto,
  UserPlatformVerificationSummaryDto,
} from './dto/channel-verification.response.dto';
import {
  AdminChannelVerificationListQueryDto,
  ReviewDecision,
} from './admin/dto/admin-channel-verification.dto';
import { checkAutoVerify } from './utils/auto-verify.util';
import { PlatformKind } from '../../platform/dto/platform.dto';

@Injectable()
export class ChannelVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformService: PlatformService,
    private readonly notificationsService: NotificationsService,
    private readonly slackWebhookService: SlackWebhookService,
    private readonly metricsService: MetricsService,
  ) {}

  private readonly logger = new Logger(ChannelVerificationService.name);

  /**
   * 인증된 (platform, platformChannelId) 와 identityKey 가 일치하는 콘텐츠 주최자(Organizer)를
   * 이 채널에 연결한다. content 도메인과 identityKey(공유 키)로 느슨하게 결합.
   * 격리: 매핑 실패가 인증 흐름을 막지 않도록 try/catch + 로깅(silent 아님). updateMany 라 idempotent.
   */
  private async linkOrganizersToChannel(
    channelId: number,
    platform: StreamPlatform,
    platformChannelId: string | null,
  ): Promise<void> {
    if (!platformChannelId) return;
    // organizer 정체성은 SOOP/CHZZK/CIME 채널만 (YOUTUBE/MELOMING/OTHER 는 콘텐츠 주최자 식별자 아님)
    if (
      platform !== StreamPlatform.SOOP &&
      platform !== StreamPlatform.CHZZK &&
      platform !== StreamPlatform.CIME
    ) {
      return;
    }
    const identityKey = `${platform}:${platformChannelId}`;
    try {
      const { count } = await this.prisma.organizer.updateMany({
        where: { identityKey, channelId: null },
        data: { channelId },
      });
      if (count > 0) {
        this.logger.log(
          `[organizer-link] ${identityKey} -> channel ${channelId} (${count}건)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[organizer-link] 실패 (${identityKey} -> channel ${channelId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 인증 해제(REVOKED) 시 해당 identityKey organizer 의 channelId 를 끊어 orphan 복귀.
   * 격리: 실패해도 해제 흐름 무영향(로깅).
   */
  private async unlinkOrganizersFromChannel(
    channelId: number,
    platform: StreamPlatform,
    platformChannelId: string | null,
  ): Promise<void> {
    if (!platformChannelId) return;
    if (
      platform !== StreamPlatform.SOOP &&
      platform !== StreamPlatform.CHZZK &&
      platform !== StreamPlatform.CIME
    ) {
      return;
    }
    const identityKey = `${platform}:${platformChannelId}`;
    try {
      const { count } = await this.prisma.organizer.updateMany({
        where: { identityKey, channelId },
        data: { channelId: null },
      });
      if (count > 0) {
        this.logger.log(
          `[organizer-unlink] ${identityKey} from channel ${channelId} (${count}건)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[organizer-unlink] 실패 (${identityKey}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 채널 인증 미리보기 (자동 매칭 결과 확인)
   */
  async previewVerification(
    channelId: number,
    userId: number,
    platform?: StreamPlatform,
  ): Promise<ChannelVerificationPreviewDto> {
    // 1. 채널 존재 및 소유권 확인
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, userId: true, platformUrl: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    if (channel.userId !== userId) {
      throw new ForbiddenException('채널 소유자만 조회할 수 있습니다.');
    }

    // 2. 플랫폼 및 채널 ID 파싱 (platformUrl이 없으면 OTHER로 간주)
    // 단축 URL(chzzk.id, chzzk.me) 지원을 위해 비동기 메서드 사용
    const detectedPlatform = channel.platformUrl
      ? this.toStreamPlatform(
          this.platformService.resolvePlatform(channel.platformUrl),
        )
      : StreamPlatform.OTHER;
    const detectedChannelId = channel.platformUrl
      ? (await this.platformService.resolveChannelIdAsync(
          channel.platformUrl,
        )) || null
      : null;

    // 3. 사용자의 모든 플랫폼 인증 목록 조회
    const userVerifications =
      await this.prisma.userPlatformVerification.findMany({
        where: { userId, isVerified: true },
      });

    const availableVerifications: UserPlatformVerificationSummaryDto[] =
      userVerifications.map((v) => ({
        id: v.id,
        platform: v.platform,
        platformUserId: v.platformUserId,
        platformChannelId: v.platformChannelId,
        isVerified: v.isVerified,
        verifiedAt: v.verifiedAt,
      }));

    // 4. 자동 매칭 시도
    // platform 파라미터가 지정된 경우 해당 플랫폼으로 자동 인증 검사
    const checkPlatform = platform ?? detectedPlatform;
    let canAutoVerify = false;
    let autoVerifyFailReason: string | null = null;
    let matchedVerification: UserPlatformVerificationSummaryDto | null = null;

    if (checkPlatform !== 'OTHER') {
      const platformVerification = userVerifications.find(
        (v) => v.platform === checkPlatform,
      );

      const result = checkAutoVerify(
        checkPlatform,
        detectedChannelId,
        platformVerification || null,
      );

      canAutoVerify = result.canAutoVerify;
      autoVerifyFailReason = result.reason || null;

      if (canAutoVerify && platformVerification) {
        matchedVerification = {
          id: platformVerification.id,
          platform: platformVerification.platform,
          platformUserId: platformVerification.platformUserId,
          platformChannelId: platformVerification.platformChannelId,
          isVerified: platformVerification.isVerified,
          verifiedAt: platformVerification.verifiedAt,
        };
      }
    } else {
      autoVerifyFailReason = 'OTHER 플랫폼은 자동 인증이 불가능합니다.';
    }

    // 5. 기존 인증 상태 확인 (REVOKED 제외)
    const existingVerificationRecords =
      await this.prisma.channelVerification.findMany({
        where: {
          channelId,
          status: { not: ChannelVerificationStatus.REVOKED },
        },
        select: { platform: true, status: true },
      });

    return {
      channelId,
      detectedPlatform,
      detectedChannelId,
      canAutoVerify,
      autoVerifyFailReason,
      matchedVerification,
      availableVerifications,
      existingVerifications: existingVerificationRecords.map((v) => ({
        platform: v.platform,
        status: v.status,
      })),
    };
  }

  /**
   * 채널 인증 신청 (최초 또는 변경)
   */
  async createVerification(
    channelId: number,
    userId: number,
    dto: CreateChannelVerificationDto,
  ): Promise<ChannelVerification> {
    // 1. 채널 존재 및 소유권 확인
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, userId: true, platformUrl: true, name: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    if (channel.userId !== userId) {
      throw new ForbiddenException('채널 소유자만 인증을 신청할 수 있습니다.');
    }

    // 수동 인증(증빙 이미지 제공) 여부 확인
    const isManualPlatformVerification =
      dto.evidenceImageUrl && dto.evidenceDescription;

    // platformUrl 필수 확인 (수동 인증 시에는 예외)
    if (!channel.platformUrl && !isManualPlatformVerification) {
      throw new BadRequestException(
        '채널 인증을 신청하려면 먼저 방송 플랫폼 URL을 설정해야 합니다.',
      );
    }

    // 2. 채널 URL에서 플랫폼 및 채널 ID 파싱 (기본값)
    // platformUrl이 없는 경우 (기타 플랫폼) 기본값 사용
    // 단축 URL(chzzk.id, chzzk.me) 지원을 위해 비동기 메서드 사용
    const urlPlatform = channel.platformUrl
      ? this.toStreamPlatform(
          this.platformService.resolvePlatform(channel.platformUrl),
        )
      : StreamPlatform.OTHER;
    const extractedChannelId = channel.platformUrl
      ? await this.platformService.resolveChannelIdAsync(channel.platformUrl)
      : null;

    // 3. 채널 URL이 CIME(ci.me)인데 요청이 OTHER 수동 증빙인 조합은 거부.
    // 심사 시 OTHER→CIME 재분류가 발생하면서 @@unique([channelId, platform]) 제약과 충돌하여
    // 500이 발생하는 구조적 결함을 데이터 생성 시점에 차단한다. CIME 채널은 OAuth 인증 경로를 사용해야 한다.
    if (
      urlPlatform === StreamPlatform.CIME &&
      dto.platform === StreamPlatform.OTHER &&
      !dto.userPlatformVerificationId
    ) {
      throw new BadRequestException(
        '채널 URL이 CIME(ci.me) 플랫폼입니다. 기타(OTHER) 증빙 인증은 허용되지 않으며, CIME OAuth 플랫폼 인증을 먼저 완료한 뒤 채널 인증을 신청해 주세요.',
      );
    }

    // 4. 사용자 플랫폼 인증 정보 조회
    let userVerification: UserPlatformVerification | null = null;

    if (dto.userPlatformVerificationId) {
      // 명시적으로 지정된 경우: 사용자가 선택한 플랫폼 인증 사용
      userVerification = await this.prisma.userPlatformVerification.findFirst({
        where: {
          id: dto.userPlatformVerificationId,
          userId,
          isVerified: true,
        },
      });

      if (!userVerification) {
        throw new BadRequestException(
          '유효하지 않은 플랫폼 인증 정보입니다. 본인의 인증된 플랫폼 정보만 사용할 수 있습니다.',
        );
      }
    } else if (urlPlatform !== 'OTHER') {
      // 자동 매칭: 채널 플랫폼에 맞는 인증 정보 조회
      userVerification = await this.prisma.userPlatformVerification.findUnique({
        where: { userId_platform: { userId, platform: urlPlatform } },
      });
    }

    // 사용할 플랫폼 결정 우선순위:
    // 1) 명시적 플랫폼 인증 정보(userPlatformVerificationId)
    // 2) 요청 바디의 platform (수동 심사에서 CIME/OTHER 구분용)
    // 3) 채널 URL에서 추출한 플랫폼
    const platform = userVerification?.platform ?? dto.platform ?? urlPlatform;

    // 5. 자동 검증 시도 (SOOP/CHZZK/CIME)
    // 자동 인증은 채널 URL의 플랫폼과 인증 플랫폼이 일치할 때만 가능
    let autoVerifyResult: {
      canAutoVerify: boolean;
      reason?: string;
      platform?: StreamPlatform;
      platformChannelId?: string | null;
    } = { canAutoVerify: false };

    if (platform !== 'OTHER' && platform === urlPlatform) {
      // 플랫폼이 일치할 때만 자동 인증 시도
      autoVerifyResult = checkAutoVerify(
        platform,
        extractedChannelId,
        userVerification,
      );
    } else if (platform !== urlPlatform) {
      // 플랫폼 불일치: 자동 인증 불가, 수동 심사 필요
      autoVerifyResult = {
        canAutoVerify: false,
        reason: `선택한 플랫폼(${platform})이 채널 URL의 플랫폼(${urlPlatform})과 다릅니다. 수동 심사가 필요합니다.`,
      };
    }

    // 5. 중복 바인딩 체크: 동일 (platform, platformChannelId)가 다른 채널에서 APPROVED 상태인지 확인
    const platformChannelId =
      userVerification?.platformChannelId ?? extractedChannelId ?? null;

    // 5-6. 중복 바인딩 체크와 기존 인증 확인을 병렬로 실행
    const [duplicateBinding, existingVerification] = await Promise.all([
      platformChannelId
        ? this.prisma.channelVerification.findFirst({
            where: {
              platform,
              platformChannelId,
              status: ChannelVerificationStatus.APPROVED,
              channelId: { not: channelId },
            },
          })
        : Promise.resolve(null),
      this.prisma.channelVerification.findUnique({
        where: {
          channelId_platform: { channelId, platform },
        },
      }),
    ]);

    if (duplicateBinding) {
      throw new BadRequestException(
        `해당 플랫폼 채널(${platformChannelId})은 이미 다른 채널에서 인증되었습니다.`,
      );
    }

    // 같은 채널+플랫폼에 PENDING 상태 존재 시 에러
    if (existingVerification?.status === ChannelVerificationStatus.PENDING) {
      throw new BadRequestException(
        '이미 해당 플랫폼의 인증 신청이 진행 중입니다.',
      );
    }

    // 7. 인증 레코드 생성
    const isResubmit =
      existingVerification?.status === ChannelVerificationStatus.REJECTED;
    const isChangeRequest =
      existingVerification?.status === ChannelVerificationStatus.APPROVED;

    const newStatus = autoVerifyResult.canAutoVerify
      ? ChannelVerificationStatus.APPROVED
      : ChannelVerificationStatus.PENDING;

    const pendingReason = autoVerifyResult.canAutoVerify
      ? null
      : platform === 'OTHER'
        ? ChannelVerificationPendingReason.OTHER_PLATFORM
        : ChannelVerificationPendingReason.AUTO_VERIFY_FAILED;

    const verificationData = {
      userId,
      platform,
      platformChannelId,
      status: newStatus,
      pendingReason,
      evidenceImageUrl: dto.evidenceImageUrl || null,
      evidenceDescription: dto.evidenceDescription || null,
      rejectionReason: null,
      reviewedAt: autoVerifyResult.canAutoVerify ? new Date() : null,
      reviewedByUserId: null,
    };

    let verification: ChannelVerification;

    if (existingVerification) {
      // 기존 레코드 삭제(로그 cascade) 후 새로 생성 (APPROVED/REJECTED/REVOKED 공통)
      verification = await this.prisma.$transaction(async (tx) => {
        await tx.channelVerification.delete({
          where: {
            channelId_platform: { channelId, platform },
          },
        });
        return tx.channelVerification.create({
          data: {
            channelId,
            ...verificationData,
          },
        });
      });
    } else {
      // 새 레코드 생성
      verification = await this.prisma.channelVerification.create({
        data: {
          channelId,
          ...verificationData,
        },
      });
    }

    // 8. Prometheus metric: channel verification submission
    this.metricsService.channelVerificationSubmissionsTotal.inc({
      platform: dto.platform ?? platform,
    });

    // 8-1. 자동 승인 시 채널 platformUrl 표준화 + organizer 자동 연결
    if (autoVerifyResult.canAutoVerify) {
      await this.updateChannelPlatformUrl(
        channelId,
        platform,
        platformChannelId,
      );
      await this.linkOrganizersToChannel(
        channelId,
        platform,
        platformChannelId,
      );
    }

    // 9. 로그 기록
    let action: ChannelVerificationAction;
    if (autoVerifyResult.canAutoVerify) {
      action = ChannelVerificationAction.AUTO_APPROVED;
    } else if (isChangeRequest) {
      action = ChannelVerificationAction.CHANGE_REQUESTED;
    } else if (isResubmit) {
      action = ChannelVerificationAction.RESUBMITTED;
    } else {
      action = ChannelVerificationAction.SUBMITTED;
    }

    await this.prisma.channelVerificationLog.create({
      data: {
        channelVerificationId: verification.id,
        action,
        previousStatus: existingVerification?.status || null,
        newStatus,
        actorUserId: userId,
        actorType: autoVerifyResult.canAutoVerify
          ? ChannelVerificationActorType.SYSTEM
          : ChannelVerificationActorType.USER,
        reason: autoVerifyResult.canAutoVerify
          ? '플랫폼 인증 정보와 채널 URL이 일치하여 자동 승인되었습니다.'
          : autoVerifyResult.reason || null,
      },
    });

    // 10. 알림 발송
    await this.sendVerificationNotification(
      userId,
      channel.name,
      autoVerifyResult.canAutoVerify
        ? NotificationType.CHANNEL_VERIFICATION_AUTO_APPROVED
        : isChangeRequest
          ? NotificationType.CHANNEL_VERIFICATION_CHANGE_REQUESTED
          : NotificationType.CHANNEL_VERIFICATION_SUBMITTED,
    );

    // 11. PENDING 상태인 경우 슬랙 알림 발송 (관리자 심사 필요)
    if (newStatus === ChannelVerificationStatus.PENDING) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, nickname: true, email: true, phone: true },
      });

      await this.slackWebhookService.sendChannelVerificationPendingAlert({
        verificationId: verification.id,
        channelId: channel.id,
        channelName: channel.name,
        platform,
        platformChannelId,
        pendingReason: pendingReason || undefined,
        evidenceImageUrl: dto.evidenceImageUrl || undefined,
        submittedAt: new Date(),
        user: user
          ? {
              id: user.id,
              nickname: user.nickname,
              email: user.email,
              phone: user.phone,
            }
          : undefined,
      });
    }

    return verification;
  }

  /**
   * 채널 인증 상태 조회 (활성 인증 목록, REVOKED 제외)
   */
  async getVerifications(channelId: number, userId: number) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true, platformUrl: true },
    });

    if (!channel) {
      throw new NotFoundException('채널을 찾을 수 없습니다.');
    }

    if (channel.userId !== userId) {
      throw new ForbiddenException(
        '채널 소유자만 인증 상태를 조회할 수 있습니다.',
      );
    }

    const verifications = await this.prisma.channelVerification.findMany({
      where: {
        channelId,
        status: { not: ChannelVerificationStatus.REVOKED },
      },
    });

    if (verifications.length === 0) {
      return [];
    }

    return verifications.map((verification) => ({
      ...verification,
      platform: this.resolveDisplayPlatform(
        verification.platform,
        channel.platformUrl,
      ),
    }));
  }

  /**
   * 채널 인증 해제 (REVOKED)
   */
  async revokeVerification(
    channelId: number,
    userId: number,
    platform: StreamPlatform,
  ): Promise<void> {
    const verification = await this.prisma.channelVerification.findUnique({
      where: {
        channelId_platform: { channelId, platform },
      },
    });

    if (!verification) {
      throw new NotFoundException('해당 플랫폼의 인증을 찾을 수 없습니다.');
    }

    if (verification.userId !== userId) {
      throw new ForbiddenException('채널 소유자만 인증을 해제할 수 있습니다.');
    }

    if (verification.status === ChannelVerificationStatus.REVOKED) {
      throw new BadRequestException('이미 해제된 인증입니다.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.channelVerificationLog.create({
        data: {
          channelVerificationId: verification.id,
          action: ChannelVerificationAction.REVOKED,
          previousStatus: verification.status,
          newStatus: ChannelVerificationStatus.REVOKED,
          actorUserId: userId,
          actorType: ChannelVerificationActorType.USER,
          reason: '사용자가 인증을 해제했습니다.',
        },
      });

      await tx.channelVerification.update({
        where: {
          channelId_platform: { channelId, platform },
        },
        data: { status: ChannelVerificationStatus.REVOKED },
      });
    });

    // 인증 해제 시 organizer 연결 끊기 (orphan 복귀, 격리)
    await this.unlinkOrganizersFromChannel(
      channelId,
      platform,
      verification.platformChannelId,
    );
  }

  // ===== 관리자 API =====

  /**
   * [관리자] 채널 인증 목록 조회
   */
  async listVerificationsAdmin(query: AdminChannelVerificationListQueryDto) {
    const { status, platform, page = 1, pageSize = 20 } = query;

    const where: Prisma.ChannelVerificationWhereInput = {};
    if (status) {
      where.status = status;
    } else {
      // 상태 필터 미지정 시 REVOKED 제외
      where.status = { not: ChannelVerificationStatus.REVOKED };
    }
    if (platform) where.platform = platform;

    const [items, total] = await Promise.all([
      this.prisma.channelVerification.findMany({
        where,
        include: {
          channel: {
            select: { id: true, name: true, webPath: true, platformUrl: true },
          },
          user: { select: { id: true, nickname: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.channelVerification.count({ where }),
    ]);

    const normalizedItems = items.map((item) => ({
      ...item,
      platform: this.resolveDisplayPlatform(
        item.platform,
        item.channel.platformUrl,
      ),
    }));

    return {
      items: normalizedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * [관리자] 채널 인증 상세 조회
   */
  async getVerificationDetailAdmin(verificationId: number) {
    const verification = await this.prisma.channelVerification.findUnique({
      where: { id: verificationId },
      include: {
        channel: {
          select: { id: true, name: true, webPath: true, platformUrl: true },
        },
        user: { select: { id: true, nickname: true, email: true } },
        reviewedByUser: { select: { id: true, nickname: true } },
        logs: {
          include: {
            actorUser: { select: { id: true, nickname: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!verification) {
      throw new NotFoundException('인증 신청을 찾을 수 없습니다.');
    }

    const displayPlatform = this.resolveDisplayPlatform(
      verification.platform,
      verification.channel.platformUrl,
    );

    if (displayPlatform === verification.platform) {
      return verification;
    }

    return {
      ...verification,
      platform: displayPlatform,
    };
  }

  /**
   * [관리자] 채널 인증 심사
   */
  async reviewVerificationAdmin(
    verificationId: number,
    adminUserId: number,
    decision: ReviewDecision,
    rejectionReason?: string,
    platformUrl?: string,
  ) {
    const verification = await this.prisma.channelVerification.findUnique({
      where: { id: verificationId },
      include: {
        channel: { select: { name: true, platformUrl: true } },
        user: { select: { id: true } },
      },
    });

    if (!verification) {
      throw new NotFoundException('인증 신청을 찾을 수 없습니다.');
    }

    if (verification.status !== 'PENDING') {
      throw new BadRequestException('대기 중인 신청만 심사할 수 있습니다.');
    }

    if (decision === ReviewDecision.REJECT && !rejectionReason) {
      throw new BadRequestException('거절 시 거절 사유를 입력해야 합니다.');
    }

    const effectivePlatform = this.resolveDisplayPlatform(
      verification.platform,
      verification.channel.platformUrl,
    );

    const newStatus =
      decision === ReviewDecision.APPROVE
        ? ChannelVerificationStatus.APPROVED
        : ChannelVerificationStatus.REJECTED;

    const action =
      decision === ReviewDecision.APPROVE
        ? ChannelVerificationAction.ADMIN_APPROVED
        : ChannelVerificationAction.ADMIN_REJECTED;

    // APPROVE만 platform 재분류를 수행한다. REJECT는 저장 platform을 유지해
    // 거절 자체가 @@unique 충돌로 막히는 상황을 방지한다.
    const platformToStore =
      decision === ReviewDecision.APPROVE
        ? effectivePlatform
        : verification.platform;

    // 트랜잭션으로 업데이트
    let updated: ChannelVerification;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        // APPROVE로 platform이 바뀌는 경우만 (channelId, platformToStore) 유일 제약 충돌을 선검사.
        if (
          decision === ReviewDecision.APPROVE &&
          platformToStore !== verification.platform
        ) {
          const conflicting = await tx.channelVerification.findUnique({
            where: {
              channelId_platform: {
                channelId: verification.channelId,
                platform: platformToStore,
              },
            },
            select: { id: true, status: true },
          });

          if (conflicting && conflicting.id !== verificationId) {
            if (conflicting.status === ChannelVerificationStatus.REVOKED) {
              // 해제된 레코드는 충돌 해소 목적으로 삭제 (cascade로 로그 동반 삭제).
              // 경합으로 이미 삭제된 경우(P2025)는 무시하고 진행한다.
              try {
                await tx.channelVerification.delete({
                  where: { id: conflicting.id },
                });
              } catch (error) {
                if (
                  !(
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === 'P2025'
                  )
                ) {
                  throw error;
                }
              }
            } else {
              throw new ConflictException(
                `동일 채널에 이미 활성 ${platformToStore} 인증(id=${conflicting.id}, status=${conflicting.status})이 존재하여 심사를 진행할 수 없습니다.`,
              );
            }
          }
        }

        // 동시 심사 경합 방지: status=PENDING 조건을 DB WHERE로 내려 원자 업데이트.
        // updateMany는 업데이트된 행만 세므로 count=0이면 이미 다른 세션이 심사했다.
        const { count } = await tx.channelVerification.updateMany({
          where: {
            id: verificationId,
            status: ChannelVerificationStatus.PENDING,
          },
          data: {
            platform: platformToStore,
            status: newStatus,
            reviewedAt: new Date(),
            reviewedByUserId: adminUserId,
            rejectionReason:
              decision === ReviewDecision.REJECT ? rejectionReason : null,
          },
        });

        if (count === 0) {
          throw new ConflictException(
            '다른 세션에서 이미 심사가 완료되어 중복 처리를 방지했습니다.',
          );
        }

        const updatedVerification =
          await tx.channelVerification.findUniqueOrThrow({
            where: { id: verificationId },
          });

        await tx.channelVerificationLog.create({
          data: {
            channelVerificationId: verificationId,
            action,
            previousStatus: verification.status,
            newStatus,
            actorUserId: adminUserId,
            actorType: ChannelVerificationActorType.ADMIN,
            reason: rejectionReason || null,
          },
        });

        // 승인 시 채널 platformUrl 설정
        if (decision === ReviewDecision.APPROVE) {
          // OTHER 플랫폼: 관리자가 입력한 URL 사용 (없으면 null 유지)
          // SOOP/CHZZK/CIME: 표준화된 URL 생성 (없으면 관리자 입력값 fallback)
          const standardizedUrl = this.getStandardizedPlatformUrl(
            effectivePlatform,
            verification.platformChannelId,
          );
          const urlToSet =
            effectivePlatform === 'OTHER'
              ? platformUrl || null
              : (standardizedUrl ?? platformUrl ?? null);

          if (urlToSet !== undefined) {
            await tx.channel.update({
              where: { id: verification.channelId },
              data: { platformUrl: urlToSet },
            });
          }
        }

        return updatedVerification;
      });
    } catch (error) {
      // 선검사로 대부분 걸러지지만, 경쟁 조건 대비 P2002를 409로 변환하는 보루.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          '동일 채널에 이미 같은 플랫폼 인증이 존재하여 심사를 진행할 수 없습니다.',
        );
      }
      throw error;
    }

    // 승인 시 콘텐츠 주최자(organizer) 자동 연결 (격리 — 실패해도 심사 결과 유지)
    if (decision === ReviewDecision.APPROVE) {
      await this.linkOrganizersToChannel(
        verification.channelId,
        effectivePlatform,
        verification.platformChannelId,
      );
    }

    // Prometheus metric: channel verification review
    this.metricsService.channelVerificationReviewsTotal.inc({
      platform: verification.platform,
      decision,
    });

    // 알림 발송
    await this.sendVerificationNotification(
      verification.user.id,
      verification.channel.name,
      decision === ReviewDecision.APPROVE
        ? NotificationType.CHANNEL_VERIFICATION_APPROVED
        : NotificationType.CHANNEL_VERIFICATION_REJECTED,
      rejectionReason,
    );

    return updated;
  }

  /**
   * [관리자] 채널 인증 로그 조회
   */
  async getVerificationLogsAdmin(verificationId: number) {
    const verification = await this.prisma.channelVerification.findUnique({
      where: { id: verificationId },
      select: { id: true },
    });

    if (!verification) {
      throw new NotFoundException('인증 신청을 찾을 수 없습니다.');
    }

    return this.prisma.channelVerificationLog.findMany({
      where: { channelVerificationId: verificationId },
      include: {
        actorUser: { select: { id: true, nickname: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ===== Private Methods =====

  /**
   * 플랫폼별 표준화된 URL 생성
   */
  private getStandardizedPlatformUrl(
    platform: StreamPlatform,
    channelId: string | null,
  ): string | null {
    if (!channelId) return null;

    switch (platform) {
      case 'SOOP':
        return `https://www.sooplive.co.kr/station/${channelId}`;
      case 'CHZZK':
        return `https://chzzk.naver.com/${channelId}`;
      case 'CIME':
        return `https://ci.me/@${channelId}`;
      case 'OTHER':
      default:
        return null;
    }
  }

  /**
   * 채널의 platformUrl을 표준화된 형식으로 업데이트
   */
  private async updateChannelPlatformUrl(
    channelId: number,
    platform: StreamPlatform,
    platformChannelId: string | null,
  ): Promise<void> {
    const standardizedUrl = this.getStandardizedPlatformUrl(
      platform,
      platformChannelId,
    );

    if (standardizedUrl) {
      await this.prisma.channel.update({
        where: { id: channelId },
        data: { platformUrl: standardizedUrl },
      });
    }
  }

  private async sendVerificationNotification(
    userId: number,
    channelName: string,
    type: NotificationType,
    rejectionReason?: string,
  ) {
    const messages: Record<NotificationType, { title: string; body: string }> =
      {
        [NotificationType.CHANNEL_VERIFICATION_SUBMITTED]: {
          title: '채널 인증 신청 완료',
          body: `${channelName} 채널의 인증 신청이 접수되었습니다. 관리자 심사 후 결과를 알려드리겠습니다.`,
        },
        [NotificationType.CHANNEL_VERIFICATION_AUTO_APPROVED]: {
          title: '채널 인증 자동 승인',
          body: `${channelName} 채널이 플랫폼 인증 정보와 일치하여 자동으로 인증되었습니다.`,
        },
        [NotificationType.CHANNEL_VERIFICATION_APPROVED]: {
          title: '채널 인증 승인',
          body: `${channelName} 채널의 인증이 승인되었습니다.`,
        },
        [NotificationType.CHANNEL_VERIFICATION_REJECTED]: {
          title: '채널 인증 거절',
          body: `${channelName} 채널의 인증이 거절되었습니다.${rejectionReason ? ` 사유: ${rejectionReason}` : ''}`,
        },
        [NotificationType.CHANNEL_VERIFICATION_CHANGE_REQUESTED]: {
          title: '채널 인증 변경 신청',
          body: `${channelName} 채널의 인증 변경 신청이 접수되었습니다. 관리자 심사 후 결과를 알려드리겠습니다.`,
        },
      } as Record<NotificationType, { title: string; body: string }>;

    const message = messages[type];
    if (!message) return;

    await this.notificationsService.sendToUser(
      userId,
      {
        type,
        title: message.title,
        body: message.body,
        data: {
          channelName,
          statusLabel: this.getVerificationStatusLabel(type),
          rejectionReason: rejectionReason ?? null,
        },
      },
      { saveInApp: true },
    );
  }

  private getVerificationStatusLabel(type: NotificationType): string {
    switch (type) {
      case NotificationType.CHANNEL_VERIFICATION_SUBMITTED:
        return '신청 접수';
      case NotificationType.CHANNEL_VERIFICATION_AUTO_APPROVED:
        return '자동 승인';
      case NotificationType.CHANNEL_VERIFICATION_APPROVED:
        return '승인';
      case NotificationType.CHANNEL_VERIFICATION_REJECTED:
        return '거절';
      case NotificationType.CHANNEL_VERIFICATION_CHANGE_REQUESTED:
        return '변경 신청 접수';
      default:
        return '처리 완료';
    }
  }

  private toStreamPlatform(platform: PlatformKind): StreamPlatform {
    if (platform === 'SOOP') return StreamPlatform.SOOP;
    if (platform === 'CHZZK') return StreamPlatform.CHZZK;
    if (platform === 'CIME') return StreamPlatform.CIME;
    return StreamPlatform.OTHER;
  }

  private resolveDisplayPlatform(
    platform: StreamPlatform,
    platformUrl: string | null | undefined,
  ): StreamPlatform {
    if (platform !== StreamPlatform.OTHER || !platformUrl) {
      return platform;
    }

    const detected = this.toStreamPlatform(
      this.platformService.resolvePlatform(platformUrl),
    );

    return detected === StreamPlatform.CIME ? StreamPlatform.CIME : platform;
  }
}
