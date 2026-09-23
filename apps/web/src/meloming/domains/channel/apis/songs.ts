import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  Song,
  GetSongsChannelIdentifierResponse,
  PostSongsChannelIdentifierRequestBody,
  PatchSongsChannelIdentifierSongIdRequestBody,
  GetSongsAlbumArtSearchResponse,
  PostSongsAlbumArtBulkSearchRequestBody,
  PostSongsAlbumArtBulkSearchResponse,
  PostSongsChannelIdentifierBulkRequestBody,
  PostSongsChannelIdentifierBulkResponse,
  SongAutocompleteResponse,
  SongArtistSuggestResponse,
} from "@/meloming/domains/channel/types/song";
import type { SheetMusicType } from "@/meloming/domains/channel/components/sheet-music/utils/detectSheetMusicType";
import type { SheetMusicSlot } from "@/meloming/domains/channel/types/song";
import type {
  SpotifySearchRequest,
  SpotifySearchResponse,
} from "@/meloming/domains/channel/types/spotify";
import type {
  SerperVideoSearchRequest,
  SerperVideoSearchResponse,
  SerperWebSearchRequest,
  SerperWebSearchResponse,
} from "@/meloming/domains/channel/types/serper";
import type {
  ImageSearchRequest,
  ImageSearchResponse,
} from "@/meloming/domains/channel/types/image-search";

/**
 * 특정 사용자의 공개 노래 목록을 가져옵니다.
 * @param username - 사용자 이름
 * @param params - 검색 및 페이지네이션 파라미터
 * @returns 노래 목록과 총 개수
 */
export async function getSongsChannelIdentifier(
  identifier: string,
  params: {
    page?: number;
    limit?: number;
    sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
    categoryId?: string;
    artistId?: string;
    categoryIds?: string;
    artistIds?: string;
    difficulties?: string;
    proficiencies?: string;
    search?: string;
    difficulty?: number;
    proficiency?: number;
  } = {}
): Promise<GetSongsChannelIdentifierResponse> {
  const {
    page = 1,
    limit = 30,
    sortBy = "newest",
    categoryId,
    artistId,
    categoryIds,
    artistIds,
    difficulties,
    proficiencies,
    search,
    difficulty,
    proficiency,
  } = params;

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortBy,
  });
  if (categoryIds || artistIds || difficulties || proficiencies) {
    queryParams.append("version", "v2");
  }
  if (categoryId) queryParams.append("categoryId", categoryId);
  if (artistId) queryParams.append("artistId", artistId);
  if (categoryIds) queryParams.append("categoryIds", categoryIds);
  if (artistIds) queryParams.append("artistIds", artistIds);
  if (difficulties) queryParams.append("difficulties", difficulties);
  if (proficiencies) queryParams.append("proficiencies", proficiencies);
  if (search) queryParams.append("search", search);
  if (typeof difficulty === "number")
    queryParams.append("difficulty", String(difficulty));
  if (typeof proficiency === "number")
    queryParams.append("proficiency", String(proficiency));

  const response = await apiClient.get<GetSongsChannelIdentifierResponse>(
    `/songs/channel/${identifier}?${queryParams.toString()}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 모든 공개 노래 목록을 가져옵니다.
 * @param params - 검색 및 페이지네이션 파라미터
 * @returns 노래 목록과 총 개수
 */
export async function getSongsSearch(
  params: {
    page?: number;
    limit?: number;
    sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
    categoryId?: string;
    artistId?: string;
    search?: string;
    difficulty?: number;
    proficiency?: number;
  } = {}
): Promise<GetSongsChannelIdentifierResponse> {
  const {
    page = 1,
    limit = 30,
    sortBy = "newest",
    categoryId,
    artistId,
    search,
    difficulty,
    proficiency,
  } = params;

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortBy,
  });
  if (categoryId) queryParams.append("categoryId", categoryId);
  if (artistId) queryParams.append("artistId", artistId);
  if (search) queryParams.append("search", search);
  if (typeof difficulty === "number")
    queryParams.append("difficulty", String(difficulty));
  if (typeof proficiency === "number")
    queryParams.append("proficiency", String(proficiency));

  const response = await apiClient.get<GetSongsChannelIdentifierResponse>(
    `/songs/search?${queryParams.toString()}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * 채널 식별자와 곡 ID로 곡 상세 정보를 가져옵니다.
 * @param identifier - 채널 주소 (예: 사용자 webPath)
 * @param songId - 곡 ID
 * @returns 곡 상세
 */
export async function getSongsChannelIdentifierSongId(
  identifier: string,
  songId: number
): Promise<Song> {
  const response = await apiClient.get<Song>(
    `/songs/channel/${identifier}/${songId}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * Get /songs/album-art/search
 * 앨범 아트 단건 검색 (Spotify 등 외부 소스 연동)
 */
export async function getSongsAlbumArtSearch(
  keyword: string
): Promise<GetSongsAlbumArtSearchResponse> {
  const params = new URLSearchParams({ title: keyword, artist: keyword });
  const response = await apiClient.get<GetSongsAlbumArtSearchResponse>(
    `/songs/album-art/search?${params.toString()}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /songs/album-art/bulk-search
 * 앨범 아트 일괄 검색
 */
export async function postSongsAlbumArtBulkSearch(
  body: PostSongsAlbumArtBulkSearchRequestBody
): Promise<PostSongsAlbumArtBulkSearchResponse> {
  const response = await apiClient.post<PostSongsAlbumArtBulkSearchResponse>(
    `/songs/album-art/bulk-search`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /v1/spotify/search
 * Spotify 검색 (앨범 아트/타이틀/아티스트 등)
 */
export async function postSpotifySearch(
  body: SpotifySearchRequest
): Promise<SpotifySearchResponse> {
  const response = await apiClient.post<SpotifySearchResponse>(
    `/spotify/search`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /v1/serper/search
 * DuckDuckGo/SearXNG 연관 이미지 검색.
 * URL은 기존 앱과의 백엔드 호환성을 위해 유지한다.
 */
export async function postImageSearch(
  body: ImageSearchRequest
): Promise<ImageSearchResponse> {
  const response = await apiClient.post<ImageSearchResponse>(
    `/serper/search`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /v1/serper/search-video
 * Serper YouTube 영상 검색 (원곡/MR/커버 URL 자동 채우기 용)
 */
export async function postSerperSearchVideo(
  body: SerperVideoSearchRequest
): Promise<SerperVideoSearchResponse> {
  const response = await apiClient.post<SerperVideoSearchResponse>(
    `/serper/search-video`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /v1/console-api/serper/search-video
 *
 * 리모콘(팝업·관리 양쪽)에서 호출하는 콘솔 경로 YouTube 영상 검색.
 * 백엔드에서 `num` 상한 20 강제 + JWT/콘솔 토큰 양쪽 허용.
 */
export async function postConsoleSerperSearchVideo(
  body: SerperVideoSearchRequest
): Promise<SerperVideoSearchResponse> {
  const response = await apiClient.post<SerperVideoSearchResponse>(
    `/console-api/serper/search-video`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /v1/console-api/songs/channel/{identifier}/{songId}
 *
 * 리모콘 전용 Song 메타데이터 부분 갱신. 허용 필드:
 *  - karaokeUrl: 노래방/MR 영상 URL
 *  - preferredPitchSemitones: 콘솔 키 조절 저장값 (-12..+12, null 로 초기화 가능)
 *  - preferredLyricsOffsetMs: 콘솔 가사 sync 보정값 (-60000..+60000ms, null 로 초기화)
 *
 * 팝업 콘솔에서는 interceptor 가 `?token=` 을 자동 첨부하고,
 * 관리 콘솔에서는 JWT 쿠키로 인증됨.
 *
 * karaokeUrl 변경 시 백엔드가 preferredPitchSemitones 를 초기화하고,
 * preferredLyricsOffsetMs 는 해당 영상의 저장값으로 복원한다.
 * 동일 요청에 preferredLyricsOffsetMs 가 같이 들어오면 사용자가 명시한 값이 우선.
 */
export async function patchConsoleSongMetadata(
  identifier: string,
  songId: number,
  patch: {
    karaokeUrl?: string;
    preferredPitchSemitones?: number | null;
    preferredLyricsOffsetMs?: number | null;
  }
): Promise<{
  id: number;
  karaokeUrl: string | null;
  preferredPitchSemitones: number | null;
  preferredLyricsOffsetMs: number | null;
}> {
  const response = await apiClient.patch<{
    id: number;
    karaokeUrl: string | null;
    preferredPitchSemitones: number | null;
    preferredLyricsOffsetMs: number | null;
  }>(
    `/console-api/songs/channel/${identifier}/${songId}`,
    patch,
    { withCredentials: true }
  );
  return response.data;
}

export const SONG_MR_VIDEO_MAX_BYTES = 5 * 1024 * 1024 * 1024;

interface SongMrVideoMultipartInitResponse {
  key: string;
  uploadId: string;
  partSizeBytes: number;
  maxSizeBytes: number;
  concurrency: number;
}

interface SongMrVideoMultipartPartUrlResponse {
  partNumber: number;
  url: string;
}

export interface SongMrVideoResponse {
  id: number;
  mrVideoUrl: string | null;
  mrVideoKey: string | null;
  fileSizeBytes?: number | null;
}

export async function uploadSongMrVideo(
  identifier: string,
  songId: number,
  file: File,
  options?: {
    onProgress?: (percent: number) => void;
  }
): Promise<SongMrVideoResponse> {
  if (!file.type.startsWith("video/")) {
    throw new Error("영상 파일만 업로드할 수 있습니다.");
  }
  if (file.size > SONG_MR_VIDEO_MAX_BYTES) {
    throw new Error("MR 영상은 최대 5GB까지 업로드할 수 있습니다.");
  }

  const basePath = `/songs/channel/${identifier}/${songId}/mr-video/multipart`;
  const init = await apiClient.post<SongMrVideoMultipartInitResponse>(
    `${basePath}/init`,
    {
      fileName: file.name || "mr-video",
      contentType: file.type || "video/mp4",
      fileSizeBytes: file.size,
    },
    { withCredentials: true }
  );
  const upload = init.data;

  try {
    const uploadedParts = await uploadSongMrVideoParts(file, upload, basePath, options);
    const complete = await apiClient.post<SongMrVideoResponse>(
      `${basePath}/complete`,
      {
        key: upload.key,
        uploadId: upload.uploadId,
        fileSizeBytes: file.size,
        parts: uploadedParts,
      },
      { withCredentials: true }
    );
    options?.onProgress?.(100);
    return complete.data;
  } catch (error) {
    await apiClient
      .post(
        `${basePath}/abort`,
        { key: upload.key, uploadId: upload.uploadId },
        { withCredentials: true }
      )
      .catch(() => undefined);
    throw error;
  }
}

async function uploadSongMrVideoParts(
  file: File,
  upload: SongMrVideoMultipartInitResponse,
  basePath: string,
  options?: { onProgress?: (percent: number) => void }
): Promise<{ partNumber: number; etag: string }[]> {
  const results: { partNumber: number; etag: string }[] = [];
  const partCount = Math.ceil(file.size / upload.partSizeBytes);
  const concurrency = Math.max(1, Math.min(upload.concurrency || 4, partCount));
  let nextIndex = 0;
  let uploadedBytes = 0;

  async function worker() {
    while (nextIndex < partCount) {
      const partNumber = nextIndex + 1;
      nextIndex += 1;
      const start = (partNumber - 1) * upload.partSizeBytes;
      const end = Math.min(start + upload.partSizeBytes, file.size);
      const signed = await apiClient.post<SongMrVideoMultipartPartUrlResponse>(
        `${basePath}/part-url`,
        {
          key: upload.key,
          uploadId: upload.uploadId,
          partNumber,
        },
        { withCredentials: true }
      );
      if (signed.data.partNumber !== partNumber) {
        throw new Error(`파트 ${partNumber} 업로드 URL 응답이 일치하지 않습니다.`);
      }

      const response = await fetch(signed.data.url, {
        method: "PUT",
        body: file.slice(start, end),
      });
      if (!response.ok) {
        throw new Error(`파트 ${partNumber} 업로드에 실패했습니다.`);
      }
      const etag = response.headers.get("ETag");
      if (!etag) {
        throw new Error("S3 업로드 응답에서 ETag를 확인할 수 없습니다.");
      }
      uploadedBytes += end - start;
      options?.onProgress?.(Math.min(99, Math.round((uploadedBytes / file.size) * 100)));
      results.push({ partNumber, etag });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results.sort((a, b) => a.partNumber - b.partNumber);
}

export async function deleteSongMrVideo(
  identifier: string,
  songId: number
): Promise<SongMrVideoResponse> {
  const response = await apiClient.delete<SongMrVideoResponse>(
    `/songs/channel/${identifier}/${songId}/mr-video`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /v1/serper/search-web
 * Serper 일반 웹 검색 (가사 링크 등 텍스트 검색 용)
 */
export async function postSerperSearchWeb(
  body: SerperWebSearchRequest
): Promise<SerperWebSearchResponse> {
  const response = await apiClient.post<SerperWebSearchResponse>(
    `/serper/search-web`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * Post /songs/channel/{identifier}
 * 단일 노래 생성
 */
export async function postSongsChannelIdentifier(
  identifier: string,
  body: PostSongsChannelIdentifierRequestBody
): Promise<Song> {
  const response = await apiClient.post<Song>(
    `/songs/channel/${identifier}`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * Patch /songs/channel/{identifier}/{songId}
 * 단일 노래 수정
 */
export async function patchSongsChannelIdentifierSongId(
  identifier: string,
  songId: number,
  body: PatchSongsChannelIdentifierSongIdRequestBody
): Promise<Song> {
  const response = await apiClient.patch<Song>(
    `/songs/channel/${identifier}/${songId}`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * Post /songs/channel/{channelId}
 * 채널 ID 기반 단일 노래 생성 (소유자 검증 용)
 */
export async function postSongsChannelChannelId(
  channelId: number,
  body: PostSongsChannelIdentifierRequestBody
): Promise<Song> {
  const response = await apiClient.post<Song>(
    `/songs/channel/${channelId}`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * Patch /songs/channel/{channelId}/{songId}
 * 채널 ID 기반 단일 노래 수정 (소유자 검증 용)
 */
export async function patchSongsChannelChannelIdSongId(
  channelId: number,
  songId: number,
  body: PatchSongsChannelIdentifierSongIdRequestBody
): Promise<Song> {
  const response = await apiClient.patch<Song>(
    `/songs/channel/${channelId}/${songId}`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /songs/channel/{channelId}/bulk
 * 채널 ID 기반 노래 일괄 생성
 */
export async function postSongsChannelChannelIdBulk(
  channelId: number,
  body: PostSongsChannelIdentifierBulkRequestBody
): Promise<PostSongsChannelIdentifierBulkResponse> {
  const response = await apiClient.post<PostSongsChannelIdentifierBulkResponse>(
    `/songs/channel/${channelId}/bulk`,
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * Delete /songs/channel/{channelId}/{songId}
 * 채널 ID 기반 단일 노래 삭제 (소유자 검증 용)
 */
export async function deleteSongsChannelChannelIdSongId(
  channelId: number,
  songId: number
): Promise<void> {
  await apiClient.delete(`/songs/channel/${channelId}/${songId}`, {
    withCredentials: true,
  });
}

/**
 * DELETE /songs/channel/{channelId}/bulk
 * 채널 ID 기반 노래 일괄 삭제
 */
export async function deleteSongsChannelChannelIdBulk(
  channelId: number,
  ids: number[]
): Promise<void> {
  await apiClient.delete(`/songs/channel/${channelId}/bulk`, {
    data: { ids },
    withCredentials: true,
  });
}

/**
 * GET /songs/channel/{channelId}/{songId}/affected-clips
 * 노래 삭제 시 함께 삭제될 클립 수 미리보기
 */
export async function getSongAffectedClips(
  channelId: number,
  songId: number
): Promise<{ orphanClipCount: number }> {
  const { data } = await apiClient.get(
    `/songs/channel/${channelId}/${songId}/affected-clips`,
    { withCredentials: true }
  );
  return data;
}

/**
 * POST /songs/channel/{channelId}/affected-clips
 * 노래 벌크 삭제 시 함께 삭제될 클립 수 미리보기
 */
export async function getSongBulkAffectedClips(
  channelId: number,
  ids: number[]
): Promise<{ orphanClipCount: number }> {
  const { data } = await apiClient.post(
    `/songs/channel/${channelId}/affected-clips`,
    { ids },
    { withCredentials: true }
  );
  return data;
}

/**
 * PATCH /songs/channel/{channelId}/bulk
 * 채널 ID 기반 노래 일괄 수정
 */
export interface BulkUpdateSongItem {
  id: number;
  artistId?: number;
  artistName?: string;
  categoryIds?: number[];
  categoryNames?: string[];
  difficulty?: number;
  proficiency?: number;
  price?: number | null;
  currencyPrices?: Record<string, number | null> | null;
}

export interface BulkUpdateSongsResponse {
  success: boolean;
  updatedCount: number;
  updatedIds: number[];
}

export async function patchSongsChannelChannelIdBulk(
  channelId: number,
  songs: BulkUpdateSongItem[]
): Promise<BulkUpdateSongsResponse> {
  const response = await apiClient.patch<BulkUpdateSongsResponse>(
    `/songs/channel/${channelId}/bulk`,
    { songs },
    { withCredentials: true }
  );
  return response.data;
}

export async function getSongsChannelIdentifierRandom(
  identifier: string,
  params: { count?: number; categoryIds?: string } = {}
): Promise<GetSongsChannelIdentifierResponse> {
  const { count = 5, categoryIds } = params;
  const queryParams = new URLSearchParams({ count: String(count) });
  const normalizedCategoryIds = categoryIds?.trim();
  if (normalizedCategoryIds) {
    queryParams.set("categoryIds", normalizedCategoryIds);
  }
  const response = await apiClient.get<GetSongsChannelIdentifierResponse>(
    `/songs/channel/${identifier}/random?${queryParams.toString()}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /songs/favorites/by-channel/{channelId}
 * 채널별 내가 즐겨찾기한 노래 조회
 */
export async function getSongsFavoritesByChannelId(
  channelId: number,
  params: {
    page?: number;
    limit?: number;
    sortBy?: "newest" | "oldest" | "title" | "artist" | "likes_desc";
  } = {}
): Promise<GetSongsChannelIdentifierResponse> {
  const { page = 1, limit = 30, sortBy = "newest" } = params;

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortBy,
  });

  const response = await apiClient.get<GetSongsChannelIdentifierResponse>(
    `/songs/favorites/by-channel/${channelId}?${queryParams.toString()}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /songs/channel/{identifier}/export/csv
 * 채널의 노래 목록을 CSV로 내보내기
 */
export async function exportSongsToCSV(identifier: string): Promise<Blob> {
  const response = await apiClient.get(
    `/songs/channel/${identifier}/export/csv`,
    {
      responseType: "blob",
      withCredentials: true,
    }
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// Song Suggest API (Fuzzy Search)
// ---------------------------------------------------------------------------

export interface SongSuggestion {
  id: number;
  channelId: number;
  title: string;
  artistName: string;
  score: number;
}

export interface SongSuggestResponse {
  suggestions: SongSuggestion[];
}

/**
 * GET /songs/channel/{identifier}/suggest
 * 클립 제목으로 노래 추천 (Fuzzy Search)
 */
export async function getSongSuggestions(
  identifier: string,
  text: string,
  limit: number = 5
): Promise<SongSuggestResponse> {
  const params = new URLSearchParams({
    text,
    limit: String(limit),
  });
  const response = await apiClient.get<SongSuggestResponse>(
    `/songs/channel/${identifier}/suggest?${params.toString()}`
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// Song Autocomplete / Artist Suggest API
// ---------------------------------------------------------------------------

/**
 * GET /songs/channel/{identifier}/autocomplete
 * 노래 제목 자동완성
 */
export async function getSongTitleAutocomplete(
  identifier: string,
  params: { query?: string; limit?: number; scope?: "channel" | "global" } = {}
): Promise<SongAutocompleteResponse> {
  const queryParams = new URLSearchParams();
  if (params.query) queryParams.append("query", params.query);
  if (params.limit) queryParams.append("limit", String(params.limit));
  if (params.scope) queryParams.append("scope", params.scope);
  const suffix = queryParams.toString();
  const response = await apiClient.get<SongAutocompleteResponse>(
    `/songs/channel/${identifier}/autocomplete${suffix ? `?${suffix}` : ""}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /songs/channel/{identifier}/artist-suggest
 * 노래 제목 기반 아티스트 추천
 */
export async function getSongArtistSuggestions(
  identifier: string,
  title: string,
  limit: number = 5,
  scope?: "channel" | "global"
): Promise<SongArtistSuggestResponse> {
  const queryParams = new URLSearchParams({
    title,
    limit: String(limit),
  });
  if (scope) queryParams.append("scope", scope);
  const response = await apiClient.get<SongArtistSuggestResponse>(
    `/songs/channel/${identifier}/artist-suggest?${queryParams.toString()}`,
    { withCredentials: true }
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// Sheet Music API (channel-scoped endpoints, Round 2 migration)
// ---------------------------------------------------------------------------

export const SHEET_MUSIC_UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Sheet music upload 응답. 백엔드가 MIME + magic-byte 검증 + .mxl → .musicxml
 * 정규화 후 R2에 업로드하고, Song row의 primary sheet music 필드도 함께 갱신한다.
 */
export interface SheetMusicUploadResponse {
  url: string;
  type: SheetMusicType;
  fileName: string;
  fileSize: number;
}

/**
 * POST /v1/songs/channel/{identifier}/{songId}/sheet-music
 *
 * 곡의 primary 악보 파일 업로드 (multipart 'file', 최대 30MB).
 * 백엔드에서 MIME + magic-byte 검증 + .mxl → .musicxml 정규화 후 R2 업로드 +
 * Song row 의 sheetMusicUrl/sheetMusicType 갱신을 원자적으로 수행한다.
 *
 * channel content 권한 필요. 응답 URL/type 은 DB 에 이미 반영되어 있으므로
 * parent 에서는 별도 PATCH 없이 invalidateQueries 만 호출하면 된다.
 *
 * Round 4 M5 (Codex UX review):
 * - per-request timeout 120초(2분) — 30MB 파일 + 느린 네트워크 대응. axios 기본
 *   apiClient timeout 10s 는 업로드에서 너무 짧아 실패했음.
 * - onProgress callback 연결 — axios onUploadProgress 를 퍼센트로 변환하여 UI
 *   progress bar 가 실시간 반영되도록 함. progressEvent.total 이 없으면(서버가
 *   Content-Length 미제공 등) undefined 를 전달해 호출부가 indeterminate 로 표시.
 */
export async function postSongsChannelIdentifierSongIdSheetMusic(
  identifier: string,
  songId: number,
  file: File,
  options?: {
    onProgress?: (percent: number | undefined) => void;
    signal?: AbortSignal;
  }
): Promise<SheetMusicUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiClient.post<SheetMusicUploadResponse>(
    `/songs/channel/${identifier}/${songId}/sheet-music`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      withCredentials: true,
      timeout: SHEET_MUSIC_UPLOAD_TIMEOUT_MS,
      timeoutErrorMessage: `sheet_music_upload_timeout_${SHEET_MUSIC_UPLOAD_TIMEOUT_MS}`,
      signal: options?.signal,
      onUploadProgress: options?.onProgress
        ? (progressEvent) => {
            const total = progressEvent.total;
            if (!total || total <= 0) {
              options.onProgress?.(undefined);
              return;
            }
            const percent = Math.min(
              100,
              Math.round((progressEvent.loaded / total) * 100)
            );
            options.onProgress?.(percent);
          }
        : undefined,
    }
  );
  return response.data;
}

/**
 * DELETE /v1/songs/channel/{identifier}/{songId}/sheet-music
 *
 * 곡의 모든 악보 슬롯 삭제 (legacy 단일 contract 호환). channel content 권한 필요.
 * Phase 2C 에서 제거 예정 — Phase 2 신 contract 는 deleteSheetMusicSlotById 사용.
 */
export async function deleteSongsChannelIdentifierSongIdSheetMusic(
  identifier: string,
  songId: number
): Promise<{ deleted: true }> {
  const response = await apiClient.delete<{ deleted: true }>(
    `/songs/channel/${identifier}/${songId}/sheet-music`,
    { withCredentials: true }
  );
  return response.data;
}

// ────────────────────────────────────────────────────────────────────────
// Phase 2 — multi-slot APIs
// ────────────────────────────────────────────────────────────────────────

/**
 * GET /v1/songs/channel/{identifier}/{songId}/sheet-music
 *
 * 슬롯 작업 후 명시 refetch 용. song detail 의 sheetMusics 필드와 동일.
 */
export async function getSongsChannelIdentifierSongIdSheetMusic(
  identifier: string,
  songId: number
): Promise<SheetMusicSlot[]> {
  const response = await apiClient.get<SheetMusicSlot[]>(
    `/songs/channel/${identifier}/${songId}/sheet-music`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /v1/songs/channel/{identifier}/{songId}/sheet-music/append
 *
 * 새 슬롯을 곡 끝에 추가. 곡당 최대 10개. MUSICXML 은 단일 강제 (기존 MUSICXML
 * 슬롯이 있으면 교체). PDF / Image 는 다중 가능, 혼용 OK.
 */
export async function appendSongsChannelIdentifierSongIdSheetMusic(
  identifier: string,
  songId: number,
  file: File,
  options?: {
    onProgress?: (percent: number | undefined) => void;
    signal?: AbortSignal;
  }
): Promise<SheetMusicSlot> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiClient.post<SheetMusicSlot>(
    `/songs/channel/${identifier}/${songId}/sheet-music/append`,
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      withCredentials: true,
      timeout: SHEET_MUSIC_UPLOAD_TIMEOUT_MS,
      timeoutErrorMessage: `sheet_music_upload_timeout_${SHEET_MUSIC_UPLOAD_TIMEOUT_MS}`,
      signal: options?.signal,
      onUploadProgress: options?.onProgress
        ? (progressEvent) => {
            const total = progressEvent.total;
            if (!total || total <= 0) {
              options.onProgress?.(undefined);
              return;
            }
            const percent = Math.min(
              100,
              Math.round((progressEvent.loaded / total) * 100)
            );
            options.onProgress?.(percent);
          }
        : undefined,
    }
  );
  return response.data;
}

/**
 * DELETE /v1/songs/channel/{identifier}/{songId}/sheet-music/{sheetMusicId}
 *
 * 특정 슬롯 1개 삭제. 남은 슬롯의 sortOrder 는 그대로 유지 (gap 허용).
 */
export async function deleteSongsChannelIdentifierSongIdSheetMusicSlot(
  identifier: string,
  songId: number,
  sheetMusicId: number
): Promise<{ deleted: true }> {
  const response = await apiClient.delete<{ deleted: true }>(
    `/songs/channel/${identifier}/${songId}/sheet-music/${sheetMusicId}`,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * PATCH /v1/songs/channel/{identifier}/{songId}/sheet-music/reorder
 *
 * orderedIds 배열에 따라 sortOrder 0..N-1 일괄 갱신. 입력 집합이 곡의 슬롯과
 * 정확히 일치해야 한다 (개수/멤버).
 */
export async function patchSongsChannelIdentifierSongIdSheetMusicReorder(
  identifier: string,
  songId: number,
  orderedIds: number[]
): Promise<SheetMusicSlot[]> {
  const response = await apiClient.patch<SheetMusicSlot[]>(
    `/songs/channel/${identifier}/${songId}/sheet-music/reorder`,
    { orderedIds },
    { withCredentials: true }
  );
  return response.data;
}
