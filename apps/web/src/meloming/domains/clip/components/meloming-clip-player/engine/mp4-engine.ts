import type { MediaEngine } from "./media-engine";

export class Mp4Engine implements MediaEngine {
  private video: HTMLVideoElement | null = null;

  async attach(
    video: HTMLVideoElement,
    src: string,
    opts?: { autoplay?: boolean }
  ): Promise<void> {
    if (this.video) {
      this.detach();
    }
    this.video = video;
    video.src = src;
    video.load();
    if (opts?.autoplay) {
      try {
        await video.play();
      } catch (err) {
        if ((err as DOMException)?.name === "NotAllowedError") {
          // autoplay policy — caller (Mute autoplay retry 또는 PlayOverlay) 에서 처리
          return;
        }
        throw err;
      }
    }
  }

  detach(): void {
    if (!this.video) return;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video = null;
  }
}
