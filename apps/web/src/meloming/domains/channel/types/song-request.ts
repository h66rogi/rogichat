// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type SongAddRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

export interface SongAddRequestRequester {
  id: number;
  nickname: string;
  profileImageUrl?: string;
}

export interface SongAddRequestChannel {
  id: number;
  name: string;
  webPath?: string;
  profileImageUrl?: string;
}

export interface SongAddRequestProcessor {
  id: number;
  nickname: string;
}

export interface SongAddRequestApprovedSong {
  id: number;
  title: string;
}

export interface SongAddRequest {
  id: number;
  requester: SongAddRequestRequester;
  channel: SongAddRequestChannel;
  title: string;
  artistName: string;
  albumArt?: string;
  karaokeUrl?: string;
  coverUrl?: string;
  originalUrl?: string;
  difficulty?: number;
  proficiency?: number;
  songKey?: string;
  bpm?: number;
  lyricsLink?: string;
  lyricsText?: string;
  categoryNames?: string[];
  status: SongAddRequestStatus;
  processedBy?: SongAddRequestProcessor;
  processedAt?: string;
  rejectionReason?: string;
  approvedSong?: SongAddRequestApprovedSong;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export interface CreateSongAddRequestBody {
  channelId: number;
  title: string;
  artistName: string;
  albumArt?: string;
  karaokeUrl?: string;
  coverUrl?: string;
  originalUrl?: string;
  difficulty?: number;
  proficiency?: number;
  songKey?: string;
  bpm?: number;
  lyricsLink?: string;
  lyricsText?: string;
  categoryNames?: string[];
  autoSearchAlbumArt?: boolean;
}

export interface RejectSongAddRequestBody {
  reason?: string;
}

export interface ApproveSongAddRequestBody {
  title?: string;
  artistName?: string;
  albumArt?: string;
  karaokeUrl?: string;
  coverUrl?: string;
  originalUrl?: string;
  difficulty?: number;
  proficiency?: number;
  songKey?: string;
  bpm?: number;
  lyricsLink?: string;
  lyricsText?: string;
  categoryNames?: string[];
}

export interface GetSongAddRequestsQuery {
  status?: SongAddRequestStatus;
  cursorId?: number;
  take?: number;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export interface ChannelSongPermission {
  channelId: number;
  hasPermission: boolean;
  canRequestSong: boolean;
}

export interface GetSongAddRequestsResponse {
  items: SongAddRequest[];
  nextCursor?: number;
  pendingCount?: number;
}
