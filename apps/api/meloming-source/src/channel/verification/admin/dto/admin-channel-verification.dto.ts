import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  StreamPlatform,
  ChannelVerificationStatus,
  ChannelVerificationPendingReason,
} from '@prisma/client';
import { ChannelVerificationDto } from '../../dto/channel-verification.response.dto';

// ===== Request DTOs =====

export enum ReviewDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

/**
 * 관리자 심사 요청 DTO
 */
export class AdminReviewChannelVerificationDto {
  @ApiProperty({
    enum: ReviewDecision,
    description: '심사 결정 (APPROVE: 승인, REJECT: 거절)',
    example: 'APPROVE',
  })
  @IsEnum(ReviewDecision)
  decision: ReviewDecision;

  @ApiPropertyOptional({
    description: '거절 사유 (REJECT 시 필수)',
    example: '제출된 증빙 자료가 채널 소유권을 증명하기에 불충분합니다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rejectionReason?: string;

  @ApiPropertyOptional({
    description:
      '플랫폼 URL (OTHER/CIME 수동 심사 승인 시 관리자가 직접 입력 가능)',
    example: 'https://www.twitch.tv/example_channel',
  })
  @IsOptional()
  @ValidateIf((o) => !!o.platformUrl)
  @IsUrl()
  platformUrl?: string;
}

/**
 * 관리자 목록 조회 쿼리 DTO
 */
export class AdminChannelVerificationListQueryDto {
  @ApiPropertyOptional({
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'],
    description: '인증 상태 필터',
  })
  @IsOptional()
  @IsEnum(ChannelVerificationStatus)
  status?: ChannelVerificationStatus;

  @ApiPropertyOptional({
    enum: ['SOOP', 'CHZZK', 'CIME', 'OTHER'],
    description: '플랫폼 필터',
  })
  @IsOptional()
  @IsEnum(StreamPlatform)
  platform?: StreamPlatform;

  @ApiPropertyOptional({
    description: '페이지 번호 (1부터 시작)',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: '페이지당 항목 수',
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}

// ===== Response DTOs =====

/**
 * 관리자용 채널 인증 목록 아이템 DTO
 */
export class AdminChannelVerificationListItemDto extends ChannelVerificationDto {
  @ApiProperty({ description: '채널 정보' })
  channel: {
    id: number;
    name: string;
    webPath: string;
    platformUrl: string | null;
  };

  @ApiProperty({ description: '신청자 정보' })
  user: {
    id: number;
    nickname: string;
    email: string;
  };
}

/**
 * 관리자용 채널 인증 목록 응답 DTO
 */
export class AdminChannelVerificationListResponseDto {
  @ApiProperty({ type: [AdminChannelVerificationListItemDto] })
  items: AdminChannelVerificationListItemDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 5 })
  totalPages: number;
}

/**
 * 관리자용 채널 인증 상세 DTO
 */
export class AdminChannelVerificationDetailDto extends AdminChannelVerificationListItemDto {
  @ApiPropertyOptional({ description: '심사자 정보', nullable: true })
  reviewedByUser: {
    id: number;
    nickname: string;
  } | null;

  @ApiProperty({
    type: 'array',
    description: '인증 로그 목록',
  })
  logs: Array<{
    id: number;
    action: string;
    previousStatus: ChannelVerificationStatus | null;
    newStatus: ChannelVerificationStatus;
    actorUserId: number | null;
    actorType: string;
    reason: string | null;
    createdAt: Date;
    actorUser: { id: number; nickname: string } | null;
  }>;
}
