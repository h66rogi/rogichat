import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsInt,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHANNEL_WARDROBE_ASPECT_RATIOS,
  CHANNEL_WARDROBE_DESCRIPTION_MAX_LENGTH,
  CHANNEL_WARDROBE_LABEL_MAX_LENGTH,
  CHANNEL_WARDROBE_TAG_MAX_COUNT,
  CHANNEL_WARDROBE_TAG_MAX_LENGTH,
  DEFAULT_CHANNEL_WARDROBE_ASPECT_RATIO,
} from '../channel-wardrobe.constants';

export class ChannelWardrobeCategoryDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: '의상' })
  name!: string;

  @ApiProperty({
    example: DEFAULT_CHANNEL_WARDROBE_ASPECT_RATIO,
    enum: CHANNEL_WARDROBE_ASPECT_RATIOS,
  })
  defaultAspectRatio!: string;

  @ApiProperty({ example: true })
  isEnabled!: boolean;

  @ApiProperty({ example: 0 })
  order!: number;
}

export class ChannelWardrobeItemDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: 1 })
  categoryId!: number;

  @ApiProperty({ example: '빈티지' })
  title!: string;

  @ApiProperty({ example: 'https://upload.meloming.com/images/example.png' })
  imageUrl!: string;

  @ApiPropertyOptional({ example: '아우터 on/off' })
  description?: string | null;

  @ApiProperty({ example: ['기본', '겨울'], type: [String] })
  tags!: string[];

  @ApiProperty({ example: true })
  isVisible!: boolean;

  @ApiProperty({ example: 0 })
  order!: number;

  @ApiProperty({ example: '2026-05-25T05:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-05-25T05:00:00.000Z' })
  updatedAt!: string;
}

export class ChannelWardrobeResponseDto {
  @ApiProperty({ type: [ChannelWardrobeCategoryDto] })
  categories!: ChannelWardrobeCategoryDto[];

  @ApiProperty({ type: [ChannelWardrobeItemDto] })
  items!: ChannelWardrobeItemDto[];
}

export class CreateChannelWardrobeCategoryDto {
  @ApiProperty({ example: '의상', maxLength: CHANNEL_WARDROBE_LABEL_MAX_LENGTH })
  @IsString()
  @MaxLength(CHANNEL_WARDROBE_LABEL_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    example: DEFAULT_CHANNEL_WARDROBE_ASPECT_RATIO,
    enum: CHANNEL_WARDROBE_ASPECT_RATIOS,
  })
  @IsOptional()
  @IsIn(CHANNEL_WARDROBE_ASPECT_RATIOS)
  defaultAspectRatio?: string;
}

export class UpdateChannelWardrobeCategoryDto {
  @ApiPropertyOptional({
    example: '헤어스타일',
    maxLength: CHANNEL_WARDROBE_LABEL_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CHANNEL_WARDROBE_LABEL_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    example: '16:9',
    enum: CHANNEL_WARDROBE_ASPECT_RATIOS,
  })
  @IsOptional()
  @IsIn(CHANNEL_WARDROBE_ASPECT_RATIOS)
  defaultAspectRatio?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}

export class CreateChannelWardrobeItemDto {
  @ApiProperty({ example: '빈티지', maxLength: CHANNEL_WARDROBE_LABEL_MAX_LENGTH })
  @IsString()
  @MaxLength(CHANNEL_WARDROBE_LABEL_MAX_LENGTH)
  title!: string;

  @ApiProperty({ example: 'https://upload.meloming.com/images/example.png' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  imageUrl!: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({
    example: '<p>아우터 on/off</p>',
    maxLength: CHANNEL_WARDROBE_DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CHANNEL_WARDROBE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    example: ['기본', '겨울'],
    type: [String],
    maxItems: CHANNEL_WARDROBE_TAG_MAX_COUNT,
    maxLength: CHANNEL_WARDROBE_TAG_MAX_LENGTH,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_WARDROBE_TAG_MAX_COUNT)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(CHANNEL_WARDROBE_TAG_MAX_LENGTH, { each: true })
  tags?: string[];
}

export class UpdateChannelWardrobeItemDto {
  @ApiPropertyOptional({
    example: '클래식',
    maxLength: CHANNEL_WARDROBE_LABEL_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CHANNEL_WARDROBE_LABEL_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    example: 'https://upload.meloming.com/images/example.png',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  imageUrl?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({
    example: '<p>긴 머리 버전</p>',
    maxLength: CHANNEL_WARDROBE_DESCRIPTION_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(CHANNEL_WARDROBE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    example: ['긴머리', '스페셜'],
    type: [String],
    maxItems: CHANNEL_WARDROBE_TAG_MAX_COUNT,
    maxLength: CHANNEL_WARDROBE_TAG_MAX_LENGTH,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_WARDROBE_TAG_MAX_COUNT)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(CHANNEL_WARDROBE_TAG_MAX_LENGTH, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}
