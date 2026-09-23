import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  IsNotEmpty,
  IsEnum,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ManualRequestInsertPosition {
  FRONT = 'FRONT',
  BACK = 'BACK',
  AFTER = 'AFTER',
}

const trimString = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? '' : trimmed;
};

const trimOptionalString = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class CreateManualRequestDto {
  @ApiPropertyOptional({
    description: '노래 ID (노래책 곡 선택 시)',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  songId?: number;

  // reviveFromRequestId가 있으면 원본 곡 정보를 서버가 복사하므로 클라이언트에서
  // 곡명/아티스트를 빈 문자열로 보내도 통과시켜야 한다.
  @ApiProperty({
    description: '아티스트명 (원본). reviveFromRequestId 사용 시 무시됨.',
    example: '아이유',
  })
  @Transform(trimString)
  @ValidateIf((o: CreateManualRequestDto) => o.reviveFromRequestId == null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  rawArtist: string;

  @ApiProperty({
    description: '곡 제목 (원본). reviveFromRequestId 사용 시 무시됨.',
    example: '좋은날',
  })
  @Transform(trimString)
  @ValidateIf((o: CreateManualRequestDto) => o.reviveFromRequestId == null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  rawTitle: string;

  @ApiPropertyOptional({
    description: '신청 메시지',
    example: '이 곡 부탁드려요!',
  })
  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  rawMessage?: string;

  @ApiPropertyOptional({
    description:
      '대기열 삽입 위치. FRONT=다음 재생 위치(맨 앞), BACK=맨 뒤(기본), AFTER=특정 항목 다음. 부활(revive) 기본은 FRONT 권장.',
    enum: ManualRequestInsertPosition,
    default: ManualRequestInsertPosition.BACK,
  })
  @IsOptional()
  @IsEnum(ManualRequestInsertPosition)
  position?: ManualRequestInsertPosition;

  @ApiPropertyOptional({
    description: 'position=AFTER 일 때 직전 항목의 SongRequest ID',
    example: 42,
  })
  @ValidateIf(
    (o: CreateManualRequestDto) =>
      o.position === ManualRequestInsertPosition.AFTER,
  )
  @IsInt()
  @Min(1)
  afterRequestId?: number;

  @ApiPropertyOptional({
    description:
      '부활시킬 기존 SongRequest ID. 같은 세션의 COMPLETED/REJECTED 곡에서 곡 정보(songId/rawArtist/rawTitle/rawMessage)를 복사하여 새 row를 생성한다.',
    example: 42,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  reviveFromRequestId?: number;
}
