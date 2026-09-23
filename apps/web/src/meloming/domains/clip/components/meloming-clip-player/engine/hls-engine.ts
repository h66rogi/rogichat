import type { MediaEngine, VideoQuality } from "./media-engine";

const MAX_RETRIES = 3;

/**
 * video element 가 metadata 까지 로드되기를 기다린다. timeoutMs 안에 도달하지 못해도
 * resolve — 그 후 video.play() 가 실패하면 외부 ERROR handler 가 처리.
 */
function waitForPlayable(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 1 /* HAVE_METADATA */) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onResolve);
      clearTimeout(timer);
    };
    const onResolve = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(onResolve, timeoutMs);
    video.addEventListener("loadedmetadata", onResolve);
  });
}

export interface HlsEngineFatalError {
  /** "NETWORK_ERROR" | "MEDIA_ERROR" | "OTHER" | "NATIVE_ERROR" */
  type: string;
  details: string;
}

export type HlsLatencyMode = "low" | "normal";

export interface HlsEngineOptions {
  /**
   * fatal error 회복 한계 (재시도 카운터 초과) 도달 시 호출.
   * 호출자는 사용자에게 에러 노출 + 새로고침 유도 UI 를 제공해야 함.
   *
   * 이 콜백이 없으면 한계 도달 시 silent 로 destroy 되어 사용자가 검은 화면만 보게
   * 되므로 라이브 시청 컴포넌트는 반드시 등록해야 한다.
   */
  onFatalError?: (error: HlsEngineFatalError) => void;
  /**
   * 지연 모드.
   *   - "low"    : lowLatencyMode + liveSyncDurationCount 2 (~2-4초, LL-HLS partial 활용)
   *   - "normal" : lowLatencyMode 비활성 + liveSyncDurationCount 6 (~12-15초, 안정성 우선)
   * 기본 "low". 변경 시 hls.js instance 재생성이 필요하므로 호출자가 engine 을 새로
   * 만든다 (HlsEngineOptions 는 readonly).
   */
  latencyMode?: HlsLatencyMode;
}

/**
 * Low-Latency HLS 라이브 엔진.
 *
 * 엔진 선택 우선순위:
 * - hls.js 가 지원되는 환경(Chrome/Firefox/Edge, macOS Safari 14+ MSE) : hls.js 사용.
 *   levels/currentLevel/seekToLive API 가 정상 동작해 화질 picker / latest edge 점프 노출.
 * - hls.js 미지원 (iOS 16 이하 등) + native HLS 지원 : video.src 로 native HLS fallback.
 *   Safari native HLS 는 levels API 가 없어 화질 picker 가 숨겨지는 한계.
 *
 * 라이브 스트림 특성:
 * - lowLatencyMode + liveSyncDurationCount 3 (LL-HLS partial segment 활용)
 * - NETWORK_ERROR / MEDIA_ERROR fatal 시 자동 recover (각 카테고리 최대 3회, exponential
 *   backoff). 한계 초과 시 destroy + onFatalError 콜백 호출 → 사용자에게 명시적 에러 표시.
 * - 그 외 fatal 은 즉시 destroy + onFatalError 호출.
 * - MANIFEST_PARSED 도달 시 카운터 리셋 (장기 끊김 후 회복 케이스 지원).
 *
 * attach 중 dynamic import 가 진행 중일 때 detach 가 호출되면 `aborted` flag 로 후속
 * hls.js 인스턴스 생성을 차단해 leak 방지.
 */
export class HlsEngine implements MediaEngine {
  private video: HTMLVideoElement | null = null;
  private hls: import("hls.js").default | null = null;
  private aborted = false;
  private networkRetries = 0;
  private mediaRetries = 0;
  private nativeErrorHandler: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: HlsEngineOptions;
  private qualitySubscribers = new Set<
    (qualities: VideoQuality[], currentLevel: number) => void
  >();
  private cachedQualities: VideoQuality[] = [];
  private cachedCurrentLevel = -1;

  constructor(options: HlsEngineOptions = {}) {
    this.options = options;
  }

  private notifyQualityChange(): void {
    for (const cb of this.qualitySubscribers) {
      cb(this.cachedQualities, this.cachedCurrentLevel);
    }
  }

  async attach(
    video: HTMLVideoElement,
    src: string,
    opts?: { autoplay?: boolean },
  ): Promise<void> {
    if (this.video) this.detach();
    this.aborted = false;
    this.networkRetries = 0;
    this.mediaRetries = 0;
    this.video = video;

    const canNative = video.canPlayType("application/vnd.apple.mpegurl") !== "";
    const HlsCtor = (await import("hls.js")).default;
    if (this.aborted) return;
    const useHlsJs = HlsCtor.isSupported();

    if (!useHlsJs && canNative) {
      const errorHandler = () => {
        const message = video.error?.message ?? "unknown native HLS error";
        this.options.onFatalError?.({ type: "NATIVE_ERROR", details: message });
      };
      video.addEventListener("error", errorHandler);
      this.nativeErrorHandler = errorHandler;
      video.src = src;
      video.load();
    } else if (useHlsJs) {
      const isLow = this.options.latencyMode !== "normal";
      const hls = new HlsCtor({
        lowLatencyMode: isLow,
        backBufferLength: 30,
        liveSyncDurationCount: isLow ? 2 : 6,
        enableWorker: true,
      });
      this.hls = hls;
      hls.attachMedia(video);
      hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(src);
      });
      hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
        // 회복 케이스: 장기 끊김 후 manifest 다시 받으면 카운터 리셋
        this.networkRetries = 0;
        this.mediaRetries = 0;
        this.cachedQualities = hls.levels.map((lvl, idx) => ({
          level: idx,
          height: lvl.height,
          bitrate: lvl.bitrate,
        }));
        this.cachedCurrentLevel = hls.currentLevel;
        this.notifyQualityChange();
      });
      hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_evt, data) => {
        this.cachedCurrentLevel = data.level;
        this.notifyQualityChange();
      });
      hls.on(HlsCtor.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
          if (this.networkRetries >= MAX_RETRIES) {
            this.fatalAbort("NETWORK_ERROR", data.details ?? "unknown");
            return;
          }
          const delay = 1000 * 2 ** this.networkRetries;
          this.networkRetries += 1;
          this.retryTimer = setTimeout(() => {
            if (this.hls && !this.aborted) hls.startLoad();
          }, delay);
        } else if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          if (this.mediaRetries >= MAX_RETRIES) {
            this.fatalAbort("MEDIA_ERROR", data.details ?? "unknown");
            return;
          }
          this.mediaRetries += 1;
          hls.recoverMediaError();
        } else {
          this.fatalAbort(data.type, data.details ?? "unknown");
        }
      });
    } else {
      throw new Error("이 브라우저는 HLS 재생을 지원하지 않습니다.");
    }

    if (this.aborted) return;
    if (opts?.autoplay) {
      // source 가 metadata 까지 로드되기를 기다린 뒤 play() — race 회피.
      // 첫-로드 시 video.src 설정 / hls.js manifest 파싱 보다 빨리 play() 가 호출되면
      // Safari 의 "Failed to load because no supported source was found" 발생.
      await waitForPlayable(video, 2000);
      if (this.aborted) return;
      try {
        await video.play();
      } catch (err) {
        if ((err as DOMException)?.name === "NotAllowedError") {
          // autoplay policy — caller 에서 mute autoplay retry / PlayOverlay 로 처리
          return;
        }
        throw err;
      }
    }
  }

  detach(): void {
    this.aborted = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch (_) {
        // already destroyed — hls.js internal state 가 이미 정리된 케이스
      }
      this.hls = null;
    }
    if (this.video) {
      if (this.nativeErrorHandler) {
        this.video.removeEventListener("error", this.nativeErrorHandler);
        this.nativeErrorHandler = null;
      }
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      this.video = null;
    }
    this.qualitySubscribers.clear();
    this.cachedQualities = [];
    this.cachedCurrentLevel = -1;
  }

  isLive(): boolean {
    return true;
  }

  getQualities(): VideoQuality[] {
    return this.cachedQualities;
  }

  getCurrentLevel(): number {
    return this.cachedCurrentLevel;
  }

  setQuality(levelIndex: number): void {
    if (!this.hls) return;
    // -1 = ABR(자동), 0+ = 강제 level. hls.js 동일 의미.
    this.hls.currentLevel = levelIndex;
  }

  seekToLive(): void {
    const video = this.video;
    if (!video) return;
    let targetTime: number | null = null;
    if (this.hls && typeof this.hls.liveSyncPosition === "number") {
      targetTime = this.hls.liveSyncPosition;
    } else if (video.seekable.length > 0) {
      targetTime = video.seekable.end(video.seekable.length - 1);
    }
    if (targetTime !== null && Number.isFinite(targetTime)) {
      // 현재 위치와 0.5초 이상 차이날 때만 currentTime 변경 — 같은 위치에 currentTime
      // 재할당하면 일부 브라우저가 seeking 으로 인식해 짧은 버퍼링 발생.
      if (Math.abs(video.currentTime - targetTime) > 0.5) {
        video.currentTime = targetTime;
      }
    }
    // paused 였다면 재생 — LIVE 배지 클릭 후에도 정지 상태에 머무는 케이스 방지
    if (video.paused) {
      void video.play().catch(() => {
        // autoplay/네트워크 정책 거부 — 외부 PlayOverlay 가 처리하도록 swallow
      });
    }
  }

  stop(): void {
    if (this.hls) {
      try {
        this.hls.stopLoad();
      } catch (_) {
        // instance 가 이미 destroy 됐으면 무시
      }
    }
    if (this.video) {
      this.video.pause();
    }
  }

  start(): void {
    if (this.hls) {
      try {
        this.hls.startLoad();
      } catch (_) {
        // already started or destroyed
      }
    }
    // backbuffer 가 stale 가능 — latest edge 로 sync + play 시도
    this.seekToLive();
  }

  onQualityChange(
    callback: (qualities: VideoQuality[], currentLevel: number) => void,
  ): () => void {
    this.qualitySubscribers.add(callback);
    // 현재 상태 즉시 1회 발화
    callback(this.cachedQualities, this.cachedCurrentLevel);
    return () => {
      this.qualitySubscribers.delete(callback);
    };
  }

  private fatalAbort(type: string, details: string): void {
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch (_) {
        // already destroyed
      }
      this.hls = null;
    }
    this.options.onFatalError?.({ type, details });
  }
}
