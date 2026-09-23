import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class CheckTransferTargetDto {
  @ApiProperty({ description: '위임 대상자의 이메일' })
  @IsEmail()
  email!: string;
}

export class RequestTransferDto {
  @ApiProperty({ description: '채널을 이전받을 대상자의 사용자 ID' })
  @IsInt()
  targetUserId!: number;

  @ApiProperty({ required: false, description: '신청자가 남기는 메모' })
  @IsOptional()
  @IsString()
  noteFromRequester?: string;
}

export class AcceptTransferDto {
  @ApiProperty({
    type: [String],
    required: false,
    description: '증빙 이미지 URL 배열',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceImages?: string[];

  @ApiProperty({ description: '약관 동의' })
  @IsBoolean()
  consentAgreeTerms!: boolean;

  @ApiProperty({ description: '이전 동의' })
  @IsBoolean()
  consentAgreeTransfer!: boolean;

  @ApiProperty({ description: '개인정보 처리 동의' })
  @IsBoolean()
  consentAgreePrivacy!: boolean;

  @ApiProperty({ required: false, description: '수신자가 남기는 메모' })
  @IsOptional()
  @IsString()
  noteFromTarget?: string;
}
