// Common types for Now Playing components

export interface NowPlayingData {
  id: number;
  songId?: number | null;
  title: string;
  artist: string;
  albumArt?: string;
  requester?: string;
  isDonation?: boolean;
  donationAmount?: number;
  isHomework?: boolean;
  /** 랜덤 신청 여부 (현재 재생 중인 곡이 랜덤 신청으로 추가된 경우). */
  isRandom?: boolean;
  availableChannels?: Array<{ channelName: string }>;
}

export interface PlaybackProgress {
  currentTime: number;
  duration: number;
  state: string;
  percentage: number;
}

export interface NowPlayingProps {
  nowPlaying: NowPlayingData | null;
  playbackProgress: PlaybackProgress;
  isConnected: boolean;
  isJoined: boolean;
  connectionStatus: string;
  options?: Record<string, unknown>;
  /** When true, disable CSS transitions/animations on progress UI. */
  reducedMotion?: boolean;
}

// Time formatting utility
export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function shouldShowPlaybackProgress(progress: PlaybackProgress): boolean {
  if (!progress || !Number.isFinite(progress.duration) || progress.duration <= 0) {
    return false;
  }
  const state = String(progress.state || '').toLowerCase();
  return state !== 'unstarted' && state !== 'ended';
}
