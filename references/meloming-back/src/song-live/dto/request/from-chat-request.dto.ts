import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SongRequestSource, SongRequestType } from '@prisma/client';
import { DonationCurrencyPair } from '../../../common/validators/donation-currency-pair.validator';

export class FromChatSongRequestDto {
  @IsNumber()
  liveSessionId: number;

  @ApiPropertyOptional({
    description:
      '싱크 전용 세션에서 실제 채팅/후원이 발생한 참가 채널 ID. 일반 세션에서는 무시됩니다.',
  })
  @IsOptional()
  @IsNumber()
  sourceChannelId?: number;

  @IsString()
  @MaxLength(128)
  streamMessageId: string; // 멱등성 키: "chat:{platform}:{channelId}:{redisId}"

  @IsString()
  @MaxLength(255)
  rawArtist: string;

  @IsString()
  @MaxLength(255)
  rawTitle: string;

  @IsString()
  @MaxLength(1000)
  rawMessage: string;

  @IsString()
  @MaxLength(64)
  requesterPlatformId: string;

  @IsString()
  @MaxLength(255)
  requesterNickname: string;

  @IsEnum(SongRequestSource)
  source: SongRequestSource; // 'CHAT' | 'DONATION'

  @ApiPropertyOptional({
    description:
      '신청 타입. RANDOM 이면 dispatcher 가 랜덤 명령어를 파싱한 케이스 — 백엔드가 채널 노래책에서 1곡을 추출. rawArtist/rawTitle 은 풀백용 표기.',
    enum: SongRequestType,
    default: 'NORMAL',
  })
  @IsOptional()
  @IsEnum(SongRequestType)
  requestType?: SongRequestType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  donationAmount?: number; // KRW 스냅샷

  @ApiPropertyOptional({
    description:
      '네이티브 재화 수량 (예: 별풍선 2개). donationCurrency와 함께 전달해야 함',
    example: 2,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @DonationCurrencyPair()
  donationNativeAmount?: number;

  @ApiPropertyOptional({
    description:
      '후원 재화 키 (SOOP_BALLOON/CHZZK_CHEESE/CIME_BEAM). donationNativeAmount와 함께 전달해야 함',
    example: 'SOOP_BALLOON',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  donationCurrency?: string;
}
