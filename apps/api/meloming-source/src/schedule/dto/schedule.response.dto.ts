import { ApiProperty } from '@nestjs/swagger';

export type ScheduleVisibility = 'PUBLIC' | 'PRIVATE';

export type ScheduleStatus = 'LIVE' | 'COLLAB' | 'OFF' | 'ETC' | 'TBD';

export class ScheduleAuthorDto {
  @ApiProperty({ example: 42 }) id!: number;
  @ApiProperty({ example: '초뜨' }) nickname!: string;
  @ApiProperty({ required: false, example: 'https://image.cdn/profile.png' })
  profileImageUrl?: string | null;
}

export class ScheduleChannelDto {
  @ApiProperty({ example: 123 }) id!: number;
  @ApiProperty({ example: '채널 이름' }) name!: string;
  @ApiProperty({ required: false, example: 'https://image.cdn/profile.png' })
  profileImageUrl?: string | null;
  @ApiProperty({ example: 'example-channel' }) webPath?: string | null;
  @ApiProperty({
    description: '채널 소유자의 프로 구독 활성 상태',
    example: true,
  })
  isOwnerProSubscriber?: boolean;
  @ApiProperty({
    description: '채널 소유자의 앰배서더 여부',
    example: true,
  })
  isOwnerAmbassador?: boolean;
}

export class ScheduleResponseDto {
  @ApiProperty({ example: 100 }) id!: number;
  @ApiProperty({ example: 1 }) channelId!: number;
  @ApiProperty({ example: 'chzzk' }) channelWebPath?: string | null;
  @ApiProperty({ type: ScheduleChannelDto }) channel?: ScheduleChannelDto;
  @ApiProperty({ type: ScheduleAuthorDto }) author!: ScheduleAuthorDto;
  @ApiProperty({ example: '정기 방송' }) title!: string;
  @ApiProperty({ required: false, example: '이번 주 컨텐츠 안내' }) content?:
    | string
    | null;
  @ApiProperty({ example: '2025-11-01T12:00:00Z' }) startAt!: string;
  @ApiProperty({ required: false, example: '2025-11-01T14:00:00Z' }) endAt?:
    | string
    | null;
  @ApiProperty({ example: false }) allDay!: boolean;
  @ApiProperty({ example: false }) isCanceled!: boolean;
  @ApiProperty({ example: 'PUBLIC' }) visibility!: ScheduleVisibility;
  @ApiProperty({
    example: 'TBD',
    enum: ['LIVE', 'COLLAB', 'OFF', 'ETC', 'TBD'],
  })
  status!: ScheduleStatus;
  @ApiProperty({ required: false, example: '온라인' }) location?: string | null;
  @ApiProperty({ required: false, example: 'https://chzzk.naver.com/live/...' })
  externalUrl?: string | null;
  @ApiProperty({ example: '2025-10-27T07:00:00Z' }) createdAt!: string;
  @ApiProperty({ example: '2025-10-27T07:10:00Z' }) updatedAt!: string;
}

export class ScheduleListResponseDto {
  @ApiProperty({ type: [ScheduleResponseDto] })
  items!: ScheduleResponseDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) limit!: number;
  @ApiProperty({ example: 123 }) total!: number;
}
