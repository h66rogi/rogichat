// Export overlay types
export * from './overlay';

// Widget-specific types
export interface QueueItem {
  id: number;
  position: number;
  title: string;
  artist: string;
  isDonation?: boolean;
  donationAmount?: number;
  isHomework?: boolean;
  /** 랜덤 신청 (백엔드가 노래책에서 1곡 자동 추출). 일반 신청과 구분 표시용. */
  isRandom?: boolean;
  albumArt?: string;
}

export interface NowPlayingData {
  id: number;
  title: string;
  artist: string;
  albumArt?: string;
  isDonation?: boolean;
  donationAmount?: number;
  isHomework?: boolean;
  /** 랜덤 신청 여부 (현재 재생 중인 곡이 랜덤 신청으로 추가된 경우). */
  isRandom?: boolean;
}
