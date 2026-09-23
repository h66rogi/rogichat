import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OmakaseLedgerType } from '@prisma/client';
import { CreateSongRequestDto } from '../../song-request/dto/request/create-request.dto';
import { DonationCurrencyPair } from '../../common/validators/donation-currency-pair.validator';

export class OmakaseStatusDto {
  @ApiProperty()
  channelId!: number;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  price!: number;

  @ApiPropertyOptional()
  currencyPrices!: Record<string, number | null> | null;

  @ApiProperty()
  count!: number;
}

export class UpdateOmakaseSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  displayName?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  price?: number;

  @IsOptional()
  @IsObject()
  currencyPrices?: Record<string, number | null> | null;
}

export class OmakaseAdjustDto {
  @IsInt()
  @Min(1)
  liveSessionId!: number;

  @IsInt()
  delta!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class OmakaseSetCountDto {
  @IsInt()
  @Min(1)
  liveSessionId!: number;

  @IsInt()
  @Min(0)
  count!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class OmakaseConsumeDto {
  @IsObject()
  @ValidateNested()
  @Type(() => CreateSongRequestDto)
  request!: CreateSongRequestDto;

  @IsOptional()
  @IsBoolean()
  playNow?: boolean;
}

export class FromChatOmakaseRequestDto {
  @IsInt()
  @Min(1)
  liveSessionId!: number;

  @IsString()
  @MaxLength(128)
  streamMessageId!: string;

  @IsString()
  @MaxLength(1000)
  rawMessage!: string;

  @IsString()
  @MaxLength(64)
  requesterPlatformId!: string;

  @IsString()
  @MaxLength(255)
  requesterNickname!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  donationAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @DonationCurrencyPair()
  donationNativeAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  donationCurrency?: string;
}

export interface OmakaseLedgerResponseDto {
  id: number;
  channelId: number;
  liveSessionId: number | null;
  songRequestId: number | null;
  type: OmakaseLedgerType;
  delta: number;
  balanceAfter: number;
  requesterPlatformId: string | null;
  requesterNickname: string | null;
  rawMessage: string | null;
  donationAmount: number | null;
  donationNativeAmount: number | null;
  donationCurrency: string | null;
  actorUserId: number | null;
  reason: string | null;
  createdAt: Date;
}
