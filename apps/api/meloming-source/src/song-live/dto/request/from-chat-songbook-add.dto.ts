import { IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { StreamPlatform } from '@prisma/client';

/**
 * dispatcher v2 가 채팅에서 `!노래책추가 곡명` 등을 파싱한 뒤 backend로 전송하는 페이로드.
 *
 * 권한 검증은 controller 가 chat-permission.helper 로 수행 (owner-only).
 * 매칭 실패 / 이미 등록 / 권한 없음 등은 outcome 토스트로 사용자에 통보.
 */
export class FromChatSongbookAddDto {
  @IsEnum(StreamPlatform)
  platform: StreamPlatform;

  @IsString()
  @MaxLength(64)
  platformUserId: string;

  @Type(() => Number)
  @IsInt()
  sessionId: number;

  /** `!노래책추가` 등 prefix 제거된 곡 query. dispatcher 가 파싱해 전달. */
  @IsString()
  @MaxLength(200)
  query: string;

  /** 원본 메시지 — 디버그/feedback toast 표시용. */
  @IsString()
  @MaxLength(500)
  rawMessage: string;

  /** 채팅 dispatcher 가 구성한 고유 키 (dedup). */
  @IsString()
  @MaxLength(128)
  streamMessageId: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  nickname?: string;
}
