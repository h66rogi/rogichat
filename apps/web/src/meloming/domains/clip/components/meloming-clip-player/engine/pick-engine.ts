import { HlsEngine } from "./hls-engine";
import type { EngineKind, MediaEngine } from "./media-engine";
import { Mp4Engine } from "./mp4-engine";

interface PickEngineInput {
  engineKind?: EngineKind;
  url: string;
}

/**
 * 지원 engineKind:
 *   - DIRECT_FILE : Mp4Engine (HTML5 <video> 직접 재생, mp4/webm)
 *   - HLS_LIVE    : HlsEngine  (Low-Latency HLS 라이브 스트림, .m3u8)
 *
 * EMBED (iframe) 는 engine 영역 밖이라 호출자가 분기 후 다른 컴포넌트를 마운트.
 */
export function pickEngine({ engineKind }: PickEngineInput): MediaEngine {
  if (engineKind === "HLS_LIVE") {
    return new HlsEngine();
  }
  return new Mp4Engine();
}
