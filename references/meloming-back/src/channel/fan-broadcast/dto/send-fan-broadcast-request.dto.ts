import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendFanBroadcastRequestDto {
  @ApiProperty({
    example: '오늘 8시 방송 시작!',
    description: '알림 제목 (최대 30자)',
    maxLength: 30,
  })
  @IsString()
  @MinLength(1, { message: '제목을 입력해주세요.' })
  @MaxLength(30, { message: '제목은 최대 30자까지 입력 가능합니다.' })
  title!: string;

  @ApiProperty({
    example: '팬 여러분 기다리셨습니다! 오랜만에 방송 켭니다 🎤',
    description: '알림 본문 (최대 80자)',
    maxLength: 80,
  })
  @IsString()
  @MinLength(1, { message: '본문을 입력해주세요.' })
  @MaxLength(80, { message: '본문은 최대 80자까지 입력 가능합니다.' })
  body!: string;

  @ApiProperty({
    required: false,
    example: 'https://chzzk.naver.com/live/abc123',
    description: '선택 이동 URL (미지정 시 해당 채널 페이지로 이동)',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true }, { message: '유효한 URL이어야 합니다.' })
  @MaxLength(500)
  url?: string;
}
