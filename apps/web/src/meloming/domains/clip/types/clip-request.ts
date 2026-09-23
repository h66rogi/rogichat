import type { ClipPlatform } from "./clip";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type ClipRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

export interface ClipRequestRequester {
  id: number;
  nickname: string;
  profileImageUrl?: string;
}

export interface ClipRequestChannel {
  id: number;
  name: string;
  webPath?: string;
  profileImageUrl?: string;
}

export interface ClipRequestSong {
  id: number;
  title: string;
  artistName?: string;
}

export interface ClipRequestProcessor {
  id: number;
  nickname: string;
}

export interface ClipRequest {
  id: number;
  requester: ClipRequestRequester;
  channel: ClipRequestChannel;
  song: ClipRequestSong;
  title: string;
  description?: string;
  platform: ClipPlatform;
  videoId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  publishToHotClip: boolean;
  status: ClipRequestStatus;
  processedBy?: ClipRequestProcessor;
  processedAt?: string;
  rejectionReason?: string;
  approvedClipId?: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export interface CreateClipRequestBody {
  channelId: number;
  songId: number;
  title: string;
  description?: string;
  platform: ClipPlatform;
  videoId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  publishToHotClip?: boolean;
}

export interface RejectClipRequestBody {
  reason?: string;
}

export interface GetClipRequestsQuery {
  status?: ClipRequestStatus;
  cursorId?: number;
  take?: number;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export interface ChannelClipPermission {
  channelId: number;
  hasPermission: boolean;
  canRequestClip: boolean;
}

export interface GetClipRequestsResponse {
  items: ClipRequest[];
  nextCursor?: number;
  pendingCount?: number;
}
