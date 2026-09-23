import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 채팅방에서 누구나 칠 수 있는 정보성 명령.
 * 권한 검증 없음, 대신 sessionId 단위 쿨다운으로 스팸 방지.
 */
export class InfoCommandDto {
  @Type(() => Number)
  @IsNumber()
  sessionId: number;

  @IsIn(['help', 'how-to-request'])
  command: 'help' | 'how-to-request';

  @IsString()
  @MaxLength(128)
  streamMessageId: string; // 디스패처 중복 전송 대응 dedup 키

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nickname?: string; // 토스트에 "<닉네임>님이 도움말 요청" 표시용
}
