import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO: 플랫폼(채널) 식별자로 조회한 채널 기본 정보
 *
 * Public(no-auth) 응답이므로 PII(소유자 이메일, 매니저, 토큰 등)는 절대 포함하지 않는다.
 */
export class ChannelByPlatformResponseDto {
  @ApiProperty({ description: '멜로밍 채널 ID', example: 123 })
  channelId: number;

  @ApiProperty({ description: '채널명', example: '아리사' })
  name: string;

  @ApiProperty({ description: '채널 webPath', example: 'arisa' })
  webPath: string;

  @ApiProperty({
    description: '프로필 이미지 URL',
    nullable: true,
    example: 'https://...',
  })
  profileImageUrl: string | null;

  @ApiProperty({
    description: '테마 컬러 (HEX)',
    nullable: true,
    example: '#3B82F6',
  })
  themeColor: string | null;

  @ApiProperty({
    description: '방송 플랫폼 URL',
    nullable: true,
    example: 'https://chzzk.naver.com/...',
  })
  platformUrl: string | null;
}
