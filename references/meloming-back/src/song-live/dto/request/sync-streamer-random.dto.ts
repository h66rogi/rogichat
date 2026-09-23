import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class SyncStreamerRandomDto {
  @ValidateIf((o) => o.liveSessionId === undefined)
  @IsInt()
  sessionId?: number;

  @ValidateIf((o) => o.sessionId === undefined)
  @IsInt()
  liveSessionId?: number;

  @IsString()
  @MaxLength(128)
  streamMessageId: string;

  @IsOptional()
  @IsString()
  rawMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  requesterPlatformId?: string;

  @IsOptional()
  @IsInt()
  sourceChannelId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  requesterNickname?: string;

  @IsOptional()
  @IsInt()
  donationAmount?: number;

  @IsOptional()
  @IsNumber()
  donationNativeAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  donationCurrency?: string;
}
