import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHANNEL_CUSTOM_MENU_ITEM_TYPES,
  CHANNEL_FEATURE_KEYS,
} from '../channel-feature-settings.constants';

export class ChannelFeatureSettingDto {
  @ApiProperty({ enum: CHANNEL_FEATURE_KEYS, example: 'musicbook' })
  @IsIn(CHANNEL_FEATURE_KEYS)
  key!: string;

  @ApiProperty({ example: '노래책', maxLength: 24 })
  @IsString()
  @MaxLength(24)
  label!: string;

  @ApiPropertyOptional({ example: '노래책', maxLength: 24 })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  defaultLabel?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isEnabled!: boolean;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  order!: number;
}

export class ChannelCustomMenuItemDto {
  @ApiProperty({ example: 'rules', maxLength: 40 })
  @IsString()
  @MaxLength(40)
  id!: string;

  @ApiProperty({ enum: CHANNEL_CUSTOM_MENU_ITEM_TYPES, example: 'page' })
  @IsIn(CHANNEL_CUSTOM_MENU_ITEM_TYPES)
  type!: string;

  @ApiProperty({ example: 'rules', maxLength: 80 })
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,2}$/)
  path!: string;

  @ApiProperty({ example: '방송 규칙', maxLength: 24 })
  @IsString()
  @MaxLength(24)
  label!: string;

  @ApiPropertyOptional({ example: '방송 규칙', maxLength: 24 })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  defaultLabel?: string;

  @ApiPropertyOptional({
    example: 'ShieldCheck',
    maxLength: 64,
    description: 'Lucide React icon component name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Z][A-Za-z0-9]{0,63}$/)
  iconName?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isEnabled!: boolean;

  @ApiProperty({ example: 14 })
  @IsInt()
  @Min(0)
  order!: number;

  @ApiPropertyOptional({ example: '<h2>방송 규칙</h2>' })
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  contentHtml?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  commentsEnabled?: boolean;

  @ApiPropertyOptional({ example: 123 })
  @IsOptional()
  @IsInt()
  @Min(1)
  boardId?: number;
}

export class ChannelFeatureSettingsResponseDto {
  @ApiProperty({ type: [ChannelFeatureSettingDto] })
  items!: ChannelFeatureSettingDto[];

  @ApiPropertyOptional({ type: [ChannelCustomMenuItemDto] })
  customItems?: ChannelCustomMenuItemDto[];
}

export class UpdateChannelFeatureSettingsDto {
  @ApiProperty({ type: [ChannelFeatureSettingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CHANNEL_FEATURE_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => ChannelFeatureSettingDto)
  items!: ChannelFeatureSettingDto[];

  @ApiPropertyOptional({ type: [ChannelCustomMenuItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChannelCustomMenuItemDto)
  customItems?: ChannelCustomMenuItemDto[];
}

export class ChannelCustomPageCommentAuthorDto {
  @ApiProperty({ example: 123 })
  id!: number;

  @ApiProperty({ example: '멜로밍' })
  nickname!: string;

  @ApiPropertyOptional({
    example: 'https://example.com/profile.png',
    nullable: true,
  })
  profileImageUrl!: string | null;
}

export class ChannelCustomPageCommentDto {
  @ApiProperty({ example: '9f9d51bc-70ef-49cf-9a9f-d797e7156d48' })
  id!: string;

  @ApiProperty({ example: '방송 규칙 확인했습니다.' })
  content!: string;

  @ApiProperty({ type: ChannelCustomPageCommentAuthorDto })
  author!: ChannelCustomPageCommentAuthorDto;

  @ApiProperty({ example: '2026-05-26T08:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-05-26T08:30:00.000Z' })
  updatedAt!: string;

  @ApiProperty({ example: false })
  isEdited!: boolean;

  @ApiProperty({ example: true })
  canEdit!: boolean;

  @ApiProperty({ example: true })
  canDelete!: boolean;
}

export class ChannelCustomPageCommentsResponseDto {
  @ApiProperty({ example: true })
  commentsEnabled!: boolean;

  @ApiProperty({ type: [ChannelCustomPageCommentDto] })
  items!: ChannelCustomPageCommentDto[];
}

export class CreateChannelCustomPageCommentDto {
  @ApiProperty({ example: '방송 규칙 확인했습니다.', maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;
}

export class UpdateChannelCustomPageCommentDto {
  @ApiProperty({ example: '방송 규칙 다시 확인했습니다.', maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;
}
