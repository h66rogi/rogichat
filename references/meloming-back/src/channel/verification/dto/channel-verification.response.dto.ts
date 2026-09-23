import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StreamPlatform,
  ChannelVerificationStatus,
  ChannelVerificationPendingReason,
  ChannelVerificationAction,
  ChannelVerificationActorType,
} from '@prisma/client';

/**
 * 사용자 플랫폼 인증 정보 요약 DTO
 */
export class UserPlatformVerificationSummaryDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ enum: StreamPlatform })
  platform: StreamPlatform;

  @ApiProperty({ example: 'streamer123' })
  platformUserId: string;

  @ApiPropertyOptional({ example: 'streamer123', nullable: true })
  platformChannelId: string | null;

  @ApiProperty({ example: true })
  isVerified: boolean;

  @ApiPropertyOptional({ nullable: true })
  verifiedAt: Date | null;
}

/**
 * 채널 인증 미리보기 응답 DTO
 */
export class ChannelVerificationPreviewDto {
  @ApiProperty({ description: '채널 ID' })
  channelId: number;

  @ApiProperty({
    description: '채널에서 추출된 플랫폼',
    enum: StreamPlatform,
  })
  detectedPlatform: StreamPlatform;

  @ApiPropertyOptional({
    description: '채널 URL에서 추출된 채널 ID',
    nullable: true,
  })
  detectedChannelId: string | null;

  @ApiProperty({ description: '자동 인증 가능 여부' })
  canAutoVerify: boolean;

  @ApiPropertyOptional({
    description: '자동 인증 불가 시 사유',
    nullable: true,
  })
  autoVerifyFailReason: string | null;

  @ApiPropertyOptional({
    description: '매칭된 사용자 플랫폼 인증 정보 (자동 인증 가능 시)',
    type: UserPlatformVerificationSummaryDto,
    nullable: true,
  })
  matchedVerification: UserPlatformVerificationSummaryDto | null;

  @ApiProperty({
    description: '사용자의 모든 플랫폼 인증 목록',
    type: [UserPlatformVerificationSummaryDto],
  })
  availableVerifications: UserPlatformVerificationSummaryDto[];

  @ApiProperty({
    description: '기존 채널 인증 목록 (플랫폼별)',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['SOOP', 'CHZZK', 'CIME', 'OTHER'] },
        status: {
          type: 'string',
          enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'],
        },
      },
    },
  })
  existingVerifications: {
    platform: StreamPlatform;
    status: ChannelVerificationStatus;
  }[];
}

/**
 * 채널 인증 상태 응답 DTO
 */
export class ChannelVerificationDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 123 })
  channelId: number;

  @ApiProperty({ enum: StreamPlatform, example: 'SOOP' })
  platform: StreamPlatform;

  @ApiPropertyOptional({
    description: '플랫폼 채널 ID',
    example: 'streamer123',
    nullable: true,
  })
  platformChannelId: string | null;

  @ApiProperty({
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'],
    example: 'PENDING',
  })
  status: ChannelVerificationStatus;

  @ApiPropertyOptional({
    enum: ['OTHER_PLATFORM', 'AUTO_VERIFY_FAILED'],
    example: 'OTHER_PLATFORM',
    nullable: true,
  })
  pendingReason: ChannelVerificationPendingReason | null;

  @ApiPropertyOptional({
    description: '증빙 이미지 URL',
    nullable: true,
  })
  evidenceImageUrl: string | null;

  @ApiPropertyOptional({
    description: '증빙 설명',
    nullable: true,
  })
  evidenceDescription: string | null;

  @ApiPropertyOptional({
    description: '거절 사유 (거절된 경우)',
    nullable: true,
  })
  rejectionReason: string | null;

  @ApiPropertyOptional({
    description: '심사 완료 일시',
    nullable: true,
  })
  reviewedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * 채널 인증 로그 응답 DTO
 */
export class ChannelVerificationLogDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({
    enum: [
      'SUBMITTED',
      'AUTO_APPROVED',
      'ADMIN_APPROVED',
      'ADMIN_REJECTED',
      'RESUBMITTED',
      'CHANGE_REQUESTED',
      'REVOKED',
    ],
  })
  action: ChannelVerificationAction;

  @ApiPropertyOptional({
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'],
    nullable: true,
  })
  previousStatus: ChannelVerificationStatus | null;

  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'] })
  newStatus: ChannelVerificationStatus;

  @ApiPropertyOptional({ nullable: true })
  actorUserId: number | null;

  @ApiProperty({ enum: ['USER', 'ADMIN', 'SYSTEM'] })
  actorType: ChannelVerificationActorType;

  @ApiPropertyOptional({ nullable: true })
  reason: string | null;

  @ApiProperty()
  createdAt: Date;
}

/**
 * 채널 인증 상세 응답 DTO (로그 포함)
 */
export class ChannelVerificationDetailDto extends ChannelVerificationDto {
  @ApiProperty({ type: [ChannelVerificationLogDto] })
  logs: ChannelVerificationLogDto[];
}
