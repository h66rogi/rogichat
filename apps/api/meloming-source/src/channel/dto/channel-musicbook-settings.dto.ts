import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateChannelMusicbookSettingsDto {
  @ApiProperty({
    description: '노래책에서 난이도 대신 숙련도를 기본 지표로 사용할지 여부',
    example: true,
  })
  @IsBoolean()
  useProficiencyAsPrimary!: boolean;
}

export class ChannelMusicbookSettingsResponseDto {
  @ApiProperty({
    description: '노래책에서 난이도 대신 숙련도를 기본 지표로 사용할지 여부',
    example: false,
  })
  useProficiencyAsPrimary!: boolean;

  @ApiProperty({
    description:
      '사용자가 난이도 대신 숙련도 기본 사용 옵션을 명시적으로 저장했는지 여부',
    example: false,
  })
  hasExplicitUseProficiencyAsPrimary!: boolean;

  @ApiProperty({
    description: '현재 모든 곡에 숙련도가 있어 옵션을 켤 수 있는지 여부',
    example: true,
  })
  canEnableProficiencyAsPrimary!: boolean;

  @ApiProperty({ description: '채널에 등록된 전체 곡 수', example: 120 })
  totalSongs!: number;

  @ApiProperty({
    description: '숙련도가 비어 있거나 1-5 범위를 벗어난 곡 수',
    example: 0,
  })
  songsMissingProficiency!: number;
}

export class CopyDifficultyToProficiencyResponseDto extends ChannelMusicbookSettingsResponseDto {
  @ApiProperty({
    description: '난이도를 숙련도로 복사한 곡 수',
    example: 120,
  })
  updatedCount!: number;
}
