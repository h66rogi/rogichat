import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ScheduleVisibility } from '@prisma/client';

/**
 * 셋리스트 (LiveSession) 가시성 토글 request DTO.
 *
 * `LiveSession.visibility` 필드를 업데이트한다. PUBLIC 이면 채널 셋리스트 페이지 / 캘린더에 노출,
 * PRIVATE 이면 owner 의 setlist 관리 페이지에서만 보임.
 */
export class UpdateSetlistVisibilityDto {
  @ApiProperty({
    description: '셋리스트 가시성 (PUBLIC / PRIVATE)',
    enum: ScheduleVisibility,
    example: ScheduleVisibility.PRIVATE,
  })
  @IsEnum(ScheduleVisibility)
  visibility!: ScheduleVisibility;
}
