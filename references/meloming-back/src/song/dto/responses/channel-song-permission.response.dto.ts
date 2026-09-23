import { ApiProperty } from '@nestjs/swagger';

export class ChannelSongPermissionResponseDto {
  @ApiProperty({ description: '채널 ID' })
  channelId: number;

  @ApiProperty({ description: '노래 직접 등록 권한 여부' })
  hasPermission: boolean;

  @ApiProperty({ description: '노래 신청 가능 여부' })
  canRequestSong: boolean;
}
