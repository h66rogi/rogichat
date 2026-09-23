import { ApiProperty } from '@nestjs/swagger';

export class FanBroadcastHistoryItemDto {
  @ApiProperty({
    example: 'fanbroadcast_5_100_1714085600000',
    description: '발송 그룹 식별자 (Notification.data.broadcastId)',
  })
  broadcastId!: string;

  @ApiProperty({ example: '오늘 8시 방송 시작!' })
  title!: string;

  @ApiProperty({ example: '팬 여러분 기다리셨습니다!' })
  body!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: '/channel/test_channel',
  })
  url!: string | null;

  @ApiProperty({
    example: '2026-04-25T11:30:00.000Z',
    description: '최초 적재된 Notification 의 createdAt',
  })
  sentAt!: string;

  @ApiProperty({ example: 156, description: '발송 대상 (인앱 저장된 row 수)' })
  recipientCount!: number;

  @ApiProperty({ example: 84, description: '읽은(readAt non-null) 수신자 수' })
  readCount!: number;
}

export class FanBroadcastHistoryResponseDto {
  @ApiProperty({ type: [FanBroadcastHistoryItemDto] })
  items!: FanBroadcastHistoryItemDto[];
}
