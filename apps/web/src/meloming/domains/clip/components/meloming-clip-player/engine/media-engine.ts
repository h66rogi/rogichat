export interface VideoQuality {
  level: number;
  height: number;
  bitrate: number;
}

/**
 * 엔진 dispatch key — clip / live 도메인 모두가 같은 엔진 스택을 공유할 때 사용.
 *
 * Clip 도메인의 `ClipMediaType` 과 일부 값이 겹치지만 (DIRECT_FILE), Clip aggregate
 * 의 invariant (유한 duration VOD) 와 어긋나는 값 (`HLS_LIVE`) 을 `ClipMediaType` 에
 * 두지 않기 위해 별도 타입으로 분리.
 */
export type EngineKind = "DIRECT_FILE" | "HLS_LIVE";

export interface MediaEngine {
  attach(video: HTMLVideoElement, src: string, opts?: { autoplay?: boolean }): Promise<void>;
  detach(): void;
  getQualities?(): VideoQuality[];
  /** -1 = ABR(자동), 0+ = 강제 level. setQuality 미구현 엔진은 자동 선택만 지원. */
  setQuality?(levelIndex: number): void;
  /** -1 = ABR(자동). getCurrentLevel 미구현 엔진은 자동 가정. */
  getCurrentLevel?(): number;
  /**
   * 가용 quality 목록 / 현재 level 변경 통지. 호출 즉시 현재 상태로 1회 발화한 뒤
   * 변경마다 다시 발화. 반환값은 unsubscribe 함수.
   * 미구현 엔진 (Mp4Engine) 은 옵셔널이라 호출자가 fallback 으로 무시.
   */
  onQualityChange?(
    callback: (qualities: VideoQuality[], currentLevel: number) => void,
  ): () => void;
  isLive?(): boolean;
  getLatency?(): number;
  /**
   * 라이브 스트림의 최신 edge 위치로 즉시 점프. VOD 엔진은 미구현 (no-op).
   * Twitch 의 "LIVE 인디케이터 클릭" UX 와 같은 동작 — 백그라운드 탭에서 돌아왔을 때
   * 또는 catch-up 누락분 건너뛰고 latest 로 이동. paused 였다면 자동 재생.
   */
  seekToLive?(): void;
  /**
   * 라이브 시청 정지 — fragment 다운로드 중단 + video.pause(). instance 는 유지하므로
   * start() 로 즉시 재진입 가능. VOD 엔진은 미구현 (no-op).
   */
  stop?(): void;
  /**
   * 라이브 시청 재진입 — fragment 다운로드 재개 + seekToLive + video.play().
   * VOD 엔진은 미구현 (no-op).
   */
  start?(): void;
}
