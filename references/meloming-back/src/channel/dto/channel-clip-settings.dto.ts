import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ChannelClipSettingsResponseDto {
  @ApiProperty({ description: '채널 ID' })
  channelId!: number;

  @ApiProperty({
    description:
      'recording-worker session-wide agent 가 추출한 high/medium confidence 클립 자동 게시 여부',
  })
  autoClipEnabled!: boolean;
}

export class ChannelClipSettingsUpdateDto {
  @ApiProperty({
    description:
      'true 로 설정하면 confidence ∈ {high, medium} + labelMismatch=false 클립이 채널 페이지에 자동 게시되고, 채널 owner 와 신청자에게 in-app/push/email 알림이 발송됩니다.',
  })
  @IsBoolean()
  autoClipEnabled!: boolean;
}
