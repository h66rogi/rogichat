import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { StreamPlatform } from '@prisma/client';

/**
 * 채널 인증 신청 요청 DTO
 * - SOOP/CHZZK: userPlatformVerificationId로 명시적 선택 또는 자동 매칭
 * - CIME/OTHER: 수동 심사(증빙 자료) 권장
 */
export class CreateChannelVerificationDto {
  @ApiPropertyOptional({
    enum: StreamPlatform,
    description:
      '요청 플랫폼 (선택). 수동 심사에서 CIME/OTHER 구분이 필요할 때 사용합니다.',
    example: 'CIME',
  })
  @IsOptional()
  @IsEnum(StreamPlatform)
  platform?: StreamPlatform;

  @ApiPropertyOptional({
    description:
      '사용자 플랫폼 인증 ID (선택사항). 지정하면 해당 인증 정보와 비교합니다. ' +
      '미지정 시 채널 URL에서 추출한 플랫폼에 맞는 인증 정보를 자동으로 찾습니다.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  userPlatformVerificationId?: number;

  @ApiPropertyOptional({
    description: '증빙 이미지 URL (CIME/OTHER 플랫폼인 경우 권장)',
    example: 'https://example.com/evidence.png',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  evidenceImageUrl?: string;

  @ApiPropertyOptional({
    description: '인증 설명 (CIME/OTHER 플랫폼인 경우 작성 권장)',
    example: '해당 플랫폼에서 활동 중인 스트리머입니다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  evidenceDescription?: string;
}

/**
 * 채널 인증 미리보기 쿼리 DTO
 */
export class PreviewVerificationQueryDto {
  @ApiPropertyOptional({ description: '프리뷰할 플랫폼', enum: StreamPlatform })
  @IsOptional()
  @IsEnum(StreamPlatform)
  platform?: StreamPlatform;
}
