import { ApiProperty } from '@nestjs/swagger';
import { ScheduleVisibility, StreamPlatform } from '@prisma/client';

/**
 * 채널 owner / canManageContent 매니저용 셋리스트 관리 응답 DTO.
 *
 * 공개 DTO (`PublicSetlistSummaryDto`) 와 거의 동일하지만 visibility 필드를 포함한다.
 * 관리 페이지의 비공개 토글 표시에 사용.
 */
export class ManageSetlistSummaryDto {
  @ApiProperty({ description: '세션 ID' })
  sessionId!: number;

  @ApiProperty({
    description: '방송 플랫폼',
    enum: StreamPlatform,
    nullable: true,
  })
  platform!: StreamPlatform | null;

  @ApiProperty({ description: '플랫폼 채널 ID', nullable: true })
  platformChannelId!: string | null;

  @ApiProperty({ description: '세션 시작 시각 (ISO8601)' })
  startedAt!: string;

  @ApiProperty({ description: '세션 종료 시각 (ISO8601)', nullable: true })
  endedAt!: string | null;

  @ApiProperty({ description: '재생 완료된 곡 수' })
  completedCount!: number;

  @ApiProperty({ description: '세션 진행 시간 (분)', nullable: true })
  durationMinutes!: number | null;

  @ApiProperty({
    description: '카드 미리보기용 앨범아트 URL 목록 (최대 6장)',
    type: [String],
  })
  albumArtPreviews!: string[];

  @ApiProperty({
    description: '셋리스트 가시성 (PUBLIC / PRIVATE)',
    enum: ScheduleVisibility,
  })
  visibility!: ScheduleVisibility;
}

export class ManageSetlistsResponseDto {
  @ApiProperty({
    description: '세션별 셋리스트 요약 (PUBLIC + PRIVATE 모두 포함)',
    type: [ManageSetlistSummaryDto],
  })
  setlists!: ManageSetlistSummaryDto[];

  @ApiProperty({ description: '셋리스트 보유 세션 총 수' })
  total!: number;

  @ApiProperty({ description: '현재 페이지' })
  page!: number;

  @ApiProperty({ description: '페이지 크기' })
  limit!: number;

  @ApiProperty({ description: '전체 페이지 수' })
  totalPages!: number;
}
