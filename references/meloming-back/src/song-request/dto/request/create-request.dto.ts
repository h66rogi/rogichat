import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsInt,
  Min,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DonationCurrencyPair } from '../../../common/validators/donation-currency-pair.validator';
import { SongRequestSource, SongRequestType } from '@prisma/client';

export enum SongRequestInsertPosition {
  FRONT = 'FRONT',
  BACK = 'BACK',
  AFTER = 'AFTER',
}

export class CreateSongRequestDto {
  @ApiProperty({
    description: '라이브 세션 ID',
    example: 1,
  })
  @IsNumber()
  liveSessionId: number;

  @ApiProperty({
    description: '노래 ID (선택 사항, 매칭된 노래가 있을 경우)',
    example: 1,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  songId?: number;

  @ApiPropertyOptional({
    description:
      'Sync Live Session에서 이 신청이 기준으로 삼는 참여 채널 ID. 공개 웹 신청 시 해당 채널 노래책의 곡으로 검증된다.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  sourceChannelId?: number;

  @ApiProperty({
    description: '아티스트명 (원본)',
    example: '아이유',
  })
  @IsString()
  @MaxLength(255)
  rawArtist: string;

  @ApiProperty({
    description: '곡 제목 (원본)',
    example: '좋은날',
  })
  @IsString()
  @MaxLength(255)
  rawTitle: string;

  @ApiProperty({
    description: '신청 메시지',
    example: '좋은날 불러주세요!',
    required: false,
  })
  @IsOptional()
  @IsString()
  rawMessage?: string;

  @ApiPropertyOptional({
    description:
      '신청자 플랫폼 ID (내부 디스패처 전용). 공개 웹/앱 경로에서는 서버가 로그인 유저 ID 또는 IP 해시로 재구성하므로 클라이언트 값은 무시됨.',
    example: 'chzzk_12345',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  requesterPlatformId?: string;

  @ApiPropertyOptional({
    description:
      '신청자 닉네임 (내부 디스패처 전용). 공개 웹/앱 경로에서는 서버가 로그인 유저 또는 익명 닉네임으로 재구성하므로 클라이언트 값은 무시됨.',
    example: '음악러버',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  requesterNickname?: string;

  @ApiPropertyOptional({
    description:
      '익명 신청 시 시청자가 입력한 닉네임. 비로그인 + 채널의 allowAnonymous=true 인 경우에만 사용. 서버는 "익명 (웹신청) {입력값}" 형태로 저장.',
    example: '노래러버',
    minLength: 1,
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  anonymousNickname?: string;

  @ApiProperty({
    description: '신청 소스',
    example: 'CHAT',
    enum: SongRequestSource,
    default: 'CHAT',
  })
  @IsOptional()
  @IsEnum(SongRequestSource)
  source?: SongRequestSource;

  @ApiPropertyOptional({
    description:
      '신청 타입. RANDOM 이면 songId 없이 채널 노래책에서 임의 1곡을 추출해 신청. 이때 rawTitle/rawArtist 값이 있으면 카테고리명 또는 가수명 필터로 사용한다. NORMAL 은 기존 동작.',
    enum: SongRequestType,
    default: 'NORMAL',
  })
  @IsOptional()
  @IsEnum(SongRequestType)
  requestType?: SongRequestType;

  @ApiProperty({
    description:
      '후원 금액 (KRW 스냅샷). donationNativeAmount+donationCurrency와 함께 제공되면 native 값이 우선 사용됨',
    example: 5000,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  donationAmount?: number;

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

  @ApiPropertyOptional({
    description:
      '대기열 삽입 위치 (운영자/MANUAL 경로 전용). FRONT=다음 재생 위치(맨 앞), BACK=맨 뒤(기본), AFTER=특정 항목 다음. 일반 사용자 신청 경로에서는 무시되고 항상 BACK으로 처리된다.',
    enum: SongRequestInsertPosition,
    default: SongRequestInsertPosition.BACK,
  })
  @IsOptional()
  @IsEnum(SongRequestInsertPosition)
  position?: SongRequestInsertPosition;

  @ApiPropertyOptional({
    description:
      'position=AFTER 일 때 직전 항목의 SongRequest ID (운영자/MANUAL 경로 전용)',
    example: 42,
  })
  @ValidateIf(
    (o: CreateSongRequestDto) => o.position === SongRequestInsertPosition.AFTER,
  )
  @IsInt()
  @Min(1)
  afterRequestId?: number;
}
