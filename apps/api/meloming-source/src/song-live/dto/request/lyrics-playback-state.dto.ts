import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum LyricsPlaybackSource {
  VIDEO = 'video',
  MANUAL = 'manual',
}

/**
 * 가사 sync state 통합 anchor DTO.
 *
 * 모델: video / manual 모두 동일한 anchor + 보간식 사용.
 *   - 재생 중: anchorAt 시점에 곡이 anchorMs 위치에 있었음. 이후 wall-clock 으로
 *     `anchorMs + (now - anchorAt) * playbackRate` 로 진행.
 *   - 정지: anchorAt = null. anchorMs 가 곧 현재 위치.
 *   - intent change(play/pause/seek/song change/rate change) 시에만 publish.
 *     평상시 publish 0회 → backend 부하 ↓ + overlay sync 정확도 ↑.
 */
export class LyricsPlaybackStateDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  songRequestId?: number | null;

  @IsEnum(LyricsPlaybackSource)
  playbackSource: LyricsPlaybackSource;

  /** anchor 시점의 곡 진행 시각 (ms). 정지 상태면 현재 위치 그 자체. */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  anchorMs: number;

  /**
   * anchor 시점의 wall-clock (ISO 8601). null = 정지 상태(anchorMs 그대로).
   * 재생 중이면 클라이언트는 `anchorMs + (Date.now() - parse(anchorAt)) * playbackRate`
   * 로 보간한다.
   */
  @IsOptional()
  @IsISO8601()
  anchorAt?: string | null;

  /** 재생 속도 배율. 기본 1.0. */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.25)
  @Max(4)
  playbackRate: number;

  /**
   * 곡 총 길이 (ms). nowsong widget progress bar 표시용.
   * 0 이면 "알 수 없음" — bar 숨김 처리.
   */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  durationMs: number;

  /** 사용자 보정값 (ms). 영상-종속 — song_video_preferences 와 동기화. */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-60000)
  @Max(60000)
  offsetMs: number;

  /** echo loop 방지용 client UUID. */
  @IsString()
  @MaxLength(64)
  clientInstanceId: string;
}
