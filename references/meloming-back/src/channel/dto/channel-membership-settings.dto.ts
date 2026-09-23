import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ReplaceChannelMembershipPlanEmoticonsDto {
  @ApiProperty({ type: [Number], maxItems: 100, example: [12, 24] })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  emoticonIds!: number[];
}

/** Creator-owned display and web price settings. Platform product mapping and
 * revenue split stay in the administrator-only endpoint. */
export class CreateChannelMembershipPlanDto {
  @ApiProperty({ example: 'basic' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{0,39}$/i)
  code!: string;

  @ApiProperty({ example: '응원 멤버십' })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: '전용 이모티콘과 멤버십 후여르 혜택' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 4900, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  webMonthlyPrice!: number;

  @ApiPropertyOptional({ example: true, default: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateChannelMembershipPlanDto {
  @ApiPropertyOptional({ example: '응원 멤버십' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ example: '전용 이모티콘과 멤버십 후여르 혜택' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 4900, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  webMonthlyPrice?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}
