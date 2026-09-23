import {
  LiveSessionStatus,
  StreamPlatform,
  KaraokePlaybackMode,
  KaraokeVideoType,
  ScheduleVisibility,
} from '@prisma/client';

/**
 * 라이브 세션 응답 DTO
 */
export class SessionResponseDto {
  id: number;
  channelId: number;
  userId: number;
  platform: StreamPlatform | null;
  platformChannelId: string | null;
  status: LiveSessionStatus;
  visibility: ScheduleVisibility;
  overlayToken: string;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  settings?: {
    id: number;
    requestEnabled: boolean;
    paused: boolean;
    requestCommand: string;
    maxQueueSize: number;
    donationPriorityEnabled: boolean;
    enforceDonationMinimumPrice: boolean;
    requireSongMatch: boolean;
    karaokePlaybackMode: KaraokePlaybackMode;
    karaokeVideoType: KaraokeVideoType;
  };
}

/**
 * 라이브 세션 목록 응답 DTO
 */
export class SessionListResponseDto {
  sessions: SessionResponseDto[];
  total: number;
}
