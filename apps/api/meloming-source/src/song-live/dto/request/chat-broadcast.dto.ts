import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ChatBroadcastDto {
  @IsNumber()
  channelId: number;

  @IsString()
  @MaxLength(20)
  platform: string;

  @IsString()
  @MaxLength(64)
  userId: string;

  @IsString()
  @MaxLength(255)
  nickname: string;

  @IsString()
  @MaxLength(2000)
  message: string;

  @IsEnum(['chat', 'donation'])
  type: 'chat' | 'donation';

  @IsOptional()
  @IsNumber()
  @Min(0)
  donationAmount?: number;

  @ApiPropertyOptional({
    description: '네이티브 재화 수량',
    example: 2,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  donationNativeAmount?: number;

  @ApiPropertyOptional({
    description: '후원 재화 키',
    example: 'SOOP_BALLOON',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  donationCurrency?: string;

  @IsDateString()
  timestamp: string;
}
