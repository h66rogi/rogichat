import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SongRequestStatus } from '@prisma/client';

export class UpdateSongRequestStatusDto {
  @ApiProperty({
    description: '신청곡 상태',
    example: 'ACCEPTED',
    enum: SongRequestStatus,
  })
  @IsEnum(SongRequestStatus)
  status: SongRequestStatus;

  @ApiProperty({
    description: '거절 사유 (REJECTED 상태일 경우)',
    example: '이미 불렀던 곡입니다',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  rejectionReason?: string;
}
