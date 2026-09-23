// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type PlaylistVisibility = "PUBLIC" | "UNLISTED" | "PRIVATE";
export type PlaylistOwnerType = "USER" | "CHANNEL";
export type PostStatus = "VISIBLE" | "HIDDEN" | "DELETED";

// ---------------------------------------------------------------------------
// Domain Types
// ---------------------------------------------------------------------------

export interface PlaylistStat {
  clipCount: number;
  viewCount: number;
  saveCount: number;
}

export interface Playlist {
  id: number;
  shareKey: string;
  ownerType: PlaylistOwnerType;
  userId?: number;
  channelId?: number;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  visibility: PlaylistVisibility;
  status: PostStatus;
  clipsVersion: number;
  createdAt: string;
  updatedAt: string;
  stat?: PlaylistStat;
  userReacted?: boolean;
}

export interface PlaylistClipChannel {
  id: number;
  channelId: number;
  songId: number;
  isPrimary: boolean;
  channel: {
    id: number;
    name: string;
    webPath?: string;
    profileImageUrl?: string;
  };
  song: {
    id: number;
    title: string;
    artist?: { name: string };
  };
}

export interface PlaylistClipItem {
  id: number;
  clipId: number;
  position: number;
  addedAt: string;
  clip: {
    id: number;
    title: string;
    description?: string;
    platform: string;
    videoId?: string;
    videoUrl?: string;
    thumbnailUrl?: string;
    duration?: number;
    status: string;
    contentType?: "SONG_CLIP" | "UPLOADED_CLIP";
    publishToHotClip?: boolean;
    createdAt: string;
    clipChannels: PlaylistClipChannel[];
    stat?: {
      likeCount: number;
      commentCount: number;
      viewCount: number;
    };
  };
}

export interface GetPlaylistClipsResponse {
  items: PlaylistClipItem[];
  nextCursor: number | null;
  playlist: {
    id: number;
    clipsVersion: number;
  };
}

export interface PlaylistClipsQuery {
  take?: number;
  cursorId?: number;
}

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

export const PLAYLIST_SORT_OPTIONS = ["hot", "latest", "saves"] as const;
export type PlaylistSortOption = (typeof PLAYLIST_SORT_OPTIONS)[number];

export interface GetPlaylistsQuery {
  take?: number;
  page?: number;
  cursorId?: number;
  search?: string;
  sort?: PlaylistSortOption;
}

export interface CreatePlaylistBody {
  ownerType: PlaylistOwnerType;
  channelId?: number;
  title: string;
  description?: string;
  visibility?: PlaylistVisibility;
}

export interface UpdatePlaylistBody {
  title?: string;
  description?: string;
  visibility?: PlaylistVisibility;
}

export interface AddClipToPlaylistBody {
  clipId: number;
}

export interface ReorderPlaylistBody {
  clipIds: number[];
  expectedVersion: number;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export interface GetPlaylistsResponse {
  items: Playlist[];
  nextCursor?: number | null;
  total?: number;
}
