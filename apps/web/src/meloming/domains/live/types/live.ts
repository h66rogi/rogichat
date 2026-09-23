export type LiveStatus = "PENDING" | "LIVE" | "ENDED" | "FAILED";

export interface PlaybackResponse {
  publicId: string;
  track: "LL_HLS" | "WEBRTC_AUDIO";
  status: LiveStatus;
  playbackUrl?: string;
  stageArn?: string;
}
