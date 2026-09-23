"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { songsKeys } from "@/meloming/domains/channel/hooks/use-songs";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { globalSongKeys } from "@/meloming/domains/global-song/hooks/use-global-song";
import { useQueryClient } from "@tanstack/react-query";
import {
  postSongsChannelChannelId,
  postSongsChannelIdentifierSongIdSheetMusic,
  type SheetMusicUploadResponse,
} from "@/meloming/domains/channel/apis/songs";
import { quickAddGlobalSong } from "@/meloming/domains/channel/apis/global-songs";
import type { Song } from "@/meloming/domains/channel/types/song";
import type { SongFormValues } from "./song-form.schema";
import { SongFormV2 } from "./song-form-v2";
import { useCreateClip } from "@/meloming/domains/clip/hooks/use-clips";
import { sanitizeCurrencyPriceMap } from "@/meloming/domains/channel/utils/sanitize-currency-price-map";
import {
  useCreateClipRequest,
  useChannelClipPermission,
} from "@/meloming/domains/clip/hooks/use-clip-requests";
import type { ClipPendingData } from "@/meloming/domains/clip/types/clip";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  getApiErrorStatus,
  getClipPendingSummary,
  getErrorName,
  getFileSummary,
  getSongFormSummary,
  type SongbookAnalyticsProperties,
} from "./songbook-analytics";

/**
 * Optimistic prepend: 새로 생성된 song 을 publicUser list 캐시의 *호환되는*
 * 변종에만 끼워넣는다. backend SongCacheService.clearChannelSongCaches 가
 * fire-and-forget 으로 ~13초간 SCAN 무효화 진행 중인 동안 invalidate +
 * refetch 하면 backend Redis cache hit 으로 stale list 가 돌아와 새 노래가
 * 사라지는 문제를 회피.
 *
 * 호환 판정 (predicate):
 * - random / search / categoryId / artistId / difficulty / proficiency / sortBy != "newest"
 *   조건이 붙은 query 는 prepend 가 잘못된 위치/조건으로 들어가므로 SKIP.
 * - paginated 는 page === 1 (또는 undefined) 인 cache 만 prepend.
 * - infinite 는 첫 page 에만 prepend.
 *
 * 데이터 무결성:
 * - 같은 song.id 가 이미 있으면 dedupe (재시도/race).
 * - total 필드 +1, limit 있으면 trim (나머지 항목은 다음 자연 refetch 시 회복).
 *
 * Layer 1 (explicit key tracking) 적용 후엔 backend 무효화가 빨라져 이
 * helper 자체가 불필요해질 수 있다.
 */
function shouldPrependToQueryKey(key: readonly unknown[]): boolean {
  // key shape:
  //   ["songs","public",username,role,params]                  (paginated)
  //   ["songs","public",username,role,"infinite",params]       (infinite)
  //   ["songs","public",username,role,"random",count,catKey]   (random)
  //   ["songs","public",username]              (prefix only — no actual data)
  //   ["songs","public",username,role]         (by role — no actual data)
  if (!Array.isArray(key) || key.length < 5) return false;
  if (key[4] === "random") return false;

  const isInfinite = key[4] === "infinite";
  const params = isInfinite ? key[5] : key[4];
  if (!params || typeof params !== "object") return false;
  const p = params as Record<string, unknown>;

  if (p.sortBy !== undefined && p.sortBy !== "newest") return false;
  if (p.search) return false;
  if (p.categoryId) return false;
  if (p.artistId) return false;
  if (p.difficulty !== undefined && p.difficulty !== null) return false;
  if (p.proficiency !== undefined && p.proficiency !== null) return false;

  // paginated: page=1 또는 undefined 인 cache 만 prepend (다른 페이지엔 새 곡이
  // 들어갈 자리 없음). infinite 는 첫 page array 자체에 prepend.
  if (!isInfinite) {
    const page = p.page;
    if (page !== undefined && page !== 1) return false;
  }
  return true;
}

function prependSongToListCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  identifier: string,
  song: Awaited<ReturnType<typeof postSongsChannelChannelId>>,
) {
  queryClient.setQueriesData(
    {
      queryKey: songsKeys.publicUser(identifier),
      predicate: (query) => shouldPrependToQueryKey(query.queryKey),
    },
    (old: unknown) => {
      if (!old || typeof old !== "object") return old;
      const cache = old as {
        songs?: Array<{ id?: number } & Record<string, unknown>>;
        total?: number;
        limit?: number;
        pages?: Array<
          {
            songs?: Array<{ id?: number } & Record<string, unknown>>;
            total?: number;
            limit?: number;
          } & Record<string, unknown>
        >;
      };

      // paginated list: { songs, total, limit, ... }
      if (Array.isArray(cache.songs)) {
        if (cache.songs.some((s) => s?.id === song.id)) return old;
        const limit =
          typeof cache.limit === "number" && cache.limit > 0 ? cache.limit : undefined;
        const newSongs = [song, ...cache.songs];
        const trimmed = limit ? newSongs.slice(0, limit) : newSongs;
        return {
          ...cache,
          songs: trimmed,
          total:
            typeof cache.total === "number" ? cache.total + 1 : cache.total,
        };
      }

      // infinite: { pages: [{ songs, total, limit }, ...], pageParams: [...] }
      if (Array.isArray(cache.pages) && cache.pages.length > 0) {
        const [first, ...rest] = cache.pages;
        if (first && Array.isArray(first.songs)) {
          if (first.songs.some((s) => s?.id === song.id)) return old;
          const limit =
            typeof first.limit === "number" && first.limit > 0
              ? first.limit
              : undefined;
          const newSongs = [song, ...first.songs];
          const trimmed = limit ? newSongs.slice(0, limit) : newSongs;
          return {
            ...cache,
            pages: [
              {
                ...first,
                songs: trimmed,
                total:
                  typeof first.total === "number"
                    ? first.total + 1
                    : first.total,
              },
              ...rest,
            ],
          };
        }
      }
      return old;
    },
  );
}

type AddSongManualContentProps = {
  /** 등록 완료 시 호출되는 콜백. 제공하지 않으면 노래책 페이지로 이동 */
  onSuccess?: () => void;
  /** 저장하고 계속하기 버튼 숨김 (모달에서 사용) */
  hideSaveAndContinue?: boolean;
  /** 외부에서 channelIdentifier를 직접 전달 (모달에서 사용) */
  channelIdentifier?: string;
  /** 외부에서 channelId를 직접 전달 (모달에서 사용) */
  channelIdProp?: number;
  /**
   * GlobalSong 페이지에서 진입할 때 전달. 있으면 submit 시 quick-add API로
   * 가서 Song.globalSongId 매핑이 즉시 박힌다. 없으면 기존 free-form 경로.
   */
  globalSongId?: number;
  /** prefill — 폼 initialValues로 흘러간다. 사용자는 수정 가능. */
  prefillTitle?: string;
  prefillArtistName?: string;
  prefillAlbumArt?: string | null;
};

export function AddSongManualContent({
  onSuccess,
  hideSaveAndContinue = false,
  channelIdentifier: channelIdentifierProp,
  channelIdProp,
  globalSongId,
  prefillTitle,
  prefillArtistName,
  prefillAlbumArt,
}: AddSongManualContentProps = {}) {
  const params = useParams();
  const user = params?.user as string | undefined;

  // Props로 전달받은 값이 있으면 사용, 없으면 URL에서 추출
  const identifierFromUrl = user || "";
  const identifier = channelIdentifierProp ?? identifierFromUrl;

  // channelId가 props로 전달되면 useChannel 스킵
  const { data: publicUser } = useChannel(identifier, {
    enabled: channelIdProp === undefined && identifier.length > 0,
  });
  const channelId = channelIdProp ?? publicUser?.id ?? 0;

  const queryClient = useQueryClient();
  const router = useRouter();

  // 클립 추가 상태
  const [clipPendingData, setClipPendingData] = useState<ClipPendingData | null>(null);

  // 악보 임시 파일 (신규 곡 생성 흐름).
  // song POST 성공 후 반환된 songId 로 sheet music upload 를 순차 실행한다.
  const [pendingSheetMusicFile, setPendingSheetMusicFile] = useState<File | null>(null);

  // I1: 재진입 가드. RHF isSubmitting 외에 부모 레이어에서도 ref 가드를 둬서
  // 더블클릭/Enter 연타로 동시 mutate 가 발생하지 않도록 한다 (이중 안전망).
  const isSubmittingRef = useRef(false);
  const pageViewEventKeyRef = useRef("");
  const clipPermissionEventKeyRef = useRef("");
  const formDirtyCapturedRef = useRef(false);
  const pendingSheetMusicEventKeyRef = useRef("");
  const clipPendingEventKeyRef = useRef("");

  // M3: unsaved guard. form dirty 또는 pending sheet music file 이 있으면
  // 새로고침/탭 닫기 시 브라우저 confirm 표시.
  // (App Router 의 client-side navigation 은 표준 hook 이 없어 외부 이탈만 가드)
  const [isFormDirty, setIsFormDirty] = useState(false);
  const hasUnsavedWork = isFormDirty || pendingSheetMusicFile !== null;
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 일부 브라우저는 returnValue 를 빈 문자열로라도 세팅해야 confirm 표시.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedWork]);

  // 클립 권한 체크
  const { data: clipPermission } = useChannelClipPermission(
    channelId || undefined,
    { enabled: channelId > 0 }
  );

  // 클립 생성/요청 mutation
  const createClipMutation = useCreateClip();
  const createClipRequestMutation = useCreateClipRequest();

  const manualBaseProperties = useMemo(
    () => ({
      channel_id: channelId || null,
      channel_ready: channelId > 0,
      has_channel_identifier: Boolean(identifier),
      source_mode:
        globalSongId !== undefined ? "global_song_prefill" : "manual_entry",
      global_song_id: globalSongId ?? null,
      hide_save_and_continue: hideSaveAndContinue,
      has_prefill_title: prefillTitle !== undefined,
      has_prefill_artist: prefillArtistName !== undefined,
      has_prefill_album_art: Boolean(prefillAlbumArt),
      pending_sheet_music_selected: pendingSheetMusicFile !== null,
      clip_pending: clipPendingData !== null,
      clip_permission_loaded: Boolean(clipPermission),
      clip_has_direct_permission: Boolean(clipPermission?.hasPermission),
      clip_can_request: Boolean(clipPermission?.canRequestClip),
    }),
    [
      channelId,
      clipPendingData,
      clipPermission,
      globalSongId,
      hideSaveAndContinue,
      identifier,
      pendingSheetMusicFile,
      prefillAlbumArt,
      prefillArtistName,
      prefillTitle,
    ]
  );

  useEffect(() => {
    const eventKey = `${identifier}:${channelId || "pending"}:${globalSongId ?? "manual"}`;
    if (pageViewEventKeyRef.current === eventKey) return;
    pageViewEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_manual_add_viewed", {
      ...manualBaseProperties,
    });
  }, [channelId, globalSongId, identifier, manualBaseProperties]);

  useEffect(() => {
    if (!clipPermission || channelId <= 0) return;
    const eventKey = [
      channelId,
      clipPermission.hasPermission,
      clipPermission.canRequestClip,
    ].join(":");
    if (clipPermissionEventKeyRef.current === eventKey) return;
    clipPermissionEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_manual_clip_permission_loaded", {
      ...manualBaseProperties,
    });
  }, [channelId, clipPermission, manualBaseProperties]);

  const buildSubmitProperties = (
    values: SongFormValues,
    action: "save" | "save_and_continue",
    extra: SongbookAnalyticsProperties = {}
  ) => ({
    ...manualBaseProperties,
    ...getSongFormSummary(values),
    ...getClipPendingSummary(clipPendingData),
    ...getFileSummary(pendingSheetMusicFile),
    submit_action: action,
    ...extra,
  });

  const handleSuccess = () => {
    if (onSuccess) {
      onSuccess();
    } else {
      router.push(`/channel/${identifier}/musicbook`);
    }
  };

  // 클립 생성 처리 함수
  const handleClipCreation = async (
    createdSongId: number,
    pendingData: ClipPendingData
  ): Promise<{ success: boolean; isRequest?: boolean }> => {
    const clipPayload = {
      title: pendingData.resolvedData.title,
      platform: pendingData.resolvedData.platform,
      videoId: pendingData.resolvedData.videoId,
      thumbnailUrl: pendingData.resolvedData.thumbnailUrl,
      duration: pendingData.resolvedData.duration,
      description: pendingData.resolvedData.description,
      publishToHotClip: pendingData.publishToHotClip,
    };

    try {
      if (clipPermission?.hasPermission) {
        await createClipMutation.mutateAsync({
          ...clipPayload,
          channels: [{ channelId, songId: createdSongId }],
        });
        return { success: true };
      } else if (clipPermission?.canRequestClip) {
        await createClipRequestMutation.mutateAsync({
          ...clipPayload,
          channelId,
          songId: createdSongId,
        });
        return { success: true, isRequest: true };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  };

  // GlobalSong 페이지에서 진입한 경우 quick-add API로 가서 Song.globalSongId
  // 매핑이 즉시 박히도록 한다. 그 외엔 기존 free-form createSong.
  // identity 필드(title/artist)는 quick-add 모드에서도 polite 하게 함께 보내지만
  // 백엔드는 canonical GlobalSong row를 source of truth로 사용한다.
  const createSongOrQuickAdd = async (
    channelIdNum: number,
    values: SongFormValues
  ): Promise<Song> => {
    const currencyPrices = sanitizeCurrencyPriceMap(values.currencyPrices);
    const numericPrice =
      values.price !== undefined && values.price !== ""
        ? Number(values.price)
        : undefined;
    const numericBpm = values.bpm ? Number(values.bpm) : undefined;
    const autoSearchAlbumArt = values.albumArt ? undefined : true;

    if (globalSongId !== undefined) {
      const { song } = await quickAddGlobalSong(channelIdNum, {
        globalSongId,
        categoryNames: values.categoryNames,
        albumArt: values.albumArt || undefined,
        autoSearchAlbumArt,
        karaokeUrl: values.karaokeUrl || undefined,
        coverUrl: values.coverUrl || undefined,
        originalUrl: values.originalUrl || undefined,
        difficulty: values.difficulty || undefined,
        proficiency: values.proficiency || undefined,
        songKey: values.songKey || undefined,
        bpm: numericBpm,
        lyricsLink: values.lyricsLink || undefined,
        lyricsText: values.lyricsText || undefined,
        description: values.description || undefined,
        price: numericPrice,
        currencyPrices,
      });
      return song as Song;
    }

    return postSongsChannelChannelId(channelIdNum, {
      title: values.title,
      artistName: values.artistName,
      categoryNames: values.categoryNames,
      albumArt: values.albumArt || undefined,
      karaokeUrl: values.karaokeUrl || undefined,
      coverUrl: values.coverUrl || undefined,
      originalUrl: values.originalUrl || undefined,
      difficulty: values.difficulty || undefined,
      proficiency: values.proficiency || undefined,
      songKey: values.songKey || undefined,
      bpm: numericBpm,
      lyricsLink: values.lyricsLink || undefined,
      lyricsText: values.lyricsText || undefined,
      description: values.description || undefined,
      autoSearchAlbumArt,
      price: numericPrice,
      currencyPrices,
    });
  };

  // pending sheet music 업로드. song POST 성공 직후 호출.
  // 반환값:
  // - { ok: true, sheet?: SheetMusicUploadResponse } — sheet 가 있으면 url/type 동봉.
  //   prepend 시 song.sheetMusicUrl/Type 을 채우는 데 사용.
  // - { ok: false, reason } — 부분 성공 토스트 분기.
  const uploadPendingSheetMusic = async (
    createdSongId: number
  ): Promise<
    | { ok: true; sheet?: SheetMusicUploadResponse }
    | { ok: false; reason: string }
  > => {
    if (!pendingSheetMusicFile) return { ok: true };
    try {
      const sheet = await postSongsChannelIdentifierSongIdSheetMusic(
        identifier,
        createdSongId,
        pendingSheetMusicFile
      );
      return { ok: true, sheet };
    } catch (e) {
      return {
        ok: false,
        reason: extractApiErrorMessage(e, "악보 업로드에 실패했습니다."),
      };
    }
  };

  // prefill 데이터가 하나라도 있으면 SongFormV2의 defaultValues에 흘려보낸다.
  // 사용자는 폼에서 자유롭게 수정 가능하지만, quick-add 모드에서는 백엔드가
  // canonical GlobalSong row를 사용하므로 title/artistName 변경은 무시된다.
  const initialValues =
    prefillTitle !== undefined ||
    prefillArtistName !== undefined ||
    prefillAlbumArt !== undefined
      ? {
          title: prefillTitle ?? "",
          artistName: prefillArtistName ?? "",
          albumArt: prefillAlbumArt ?? "",
        }
      : undefined;

  return (
    <SongFormV2
      identifier={identifier}
      channelId={channelId}
      initialValues={initialValues}
      submitLabel="저장"
	      enableClipAdd={true}
	      onClipPendingChange={(data) => {
	        const nextKey = data
	          ? [
	              data.resolvedData.platform,
	              data.resolvedData.duration ?? "unknown",
	              data.publishToHotClip,
	            ].join(":")
	          : "removed";
	        if (clipPendingEventKeyRef.current !== nextKey) {
	          clipPendingEventKeyRef.current = nextKey;
	          captureIntentEvent(
	            data
	              ? "channel_songbook_manual_clip_pending_added"
	              : "channel_songbook_manual_clip_pending_removed",
	            {
	              ...manualBaseProperties,
	              ...getClipPendingSummary(data),
	            }
	          );
	        }
	        setClipPendingData(data);
	      }}
	      pendingSheetMusicFile={pendingSheetMusicFile}
	      onPendingSheetMusicFileChange={(file) => {
	        const fileSummary = getFileSummary(file);
	        const eventKey = file
	          ? [
	              fileSummary.file_extension,
	              fileSummary.file_size_bucket,
	              fileSummary.file_mime_type,
	            ].join(":")
	          : "removed";
	        if (pendingSheetMusicEventKeyRef.current !== eventKey) {
	          pendingSheetMusicEventKeyRef.current = eventKey;
	          captureIntentEvent(
	            file
	              ? "channel_songbook_manual_sheet_music_file_selected"
	              : "channel_songbook_manual_sheet_music_file_removed",
	            {
	              ...manualBaseProperties,
	              ...fileSummary,
	            }
	          );
	        }
	        setPendingSheetMusicFile(file);
	      }}
	      onDirtyChange={(dirty) => {
	        setIsFormDirty(dirty);
	        if (dirty && !formDirtyCapturedRef.current) {
	          formDirtyCapturedRef.current = true;
	          captureIntentEvent("channel_songbook_manual_form_dirty_started", {
	            ...manualBaseProperties,
	          });
	        }
	      }}
	      onSubmit={async (values) => {
	        captureIntentEvent("channel_songbook_manual_save_clicked", {
	          ...buildSubmitProperties(values, "save"),
	        });
	        if (!channelId) {
	          captureIntentEvent(
	            "channel_songbook_manual_save_blocked_channel_unready",
	            {
	              ...buildSubmitProperties(values, "save"),
	            }
	          );
	          toast.error(
	            "채널 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요."
	          );
	          return;
	        }
	        // I1: 재진입 가드.
	        if (isSubmittingRef.current) {
	          captureIntentEvent(
	            "channel_songbook_manual_save_blocked_duplicate_submit",
	            {
	              ...buildSubmitProperties(values, "save"),
	            }
	          );
	          return;
	        }
	        isSubmittingRef.current = true;
	        try {
	          // 1. 노래 생성 — globalSongId 유무에 따라 quick-add / 일반 createSong 분기
	          captureIntentEvent("channel_songbook_manual_save_song_create_submitted", {
	            ...buildSubmitProperties(values, "save"),
	          });
	          const createdSong = await createSongOrQuickAdd(channelId, values);
	          captureIntentEvent("channel_songbook_manual_save_song_create_succeeded", {
	            ...buildSubmitProperties(values, "save", {
	              song_id: createdSong.id,
	            }),
	          });

	          // 2. 악보 업로드 (사용자가 선택했을 때만). song 성공 + sheet 실패는 부분 성공.
	          //    실패 시 pendingSheetMusicFile 은 의도적으로 유지(=재시도 가능).
	          if (pendingSheetMusicFile) {
	            captureIntentEvent(
	              "channel_songbook_manual_save_sheet_music_upload_submitted",
	              {
	                ...buildSubmitProperties(values, "save", {
	                  song_id: createdSong.id,
	                }),
	              }
	            );
	          } else {
	            captureIntentEvent(
	              "channel_songbook_manual_save_sheet_music_upload_skipped",
	              {
	                ...buildSubmitProperties(values, "save", {
	                  song_id: createdSong.id,
	                }),
	              }
	            );
	          }
	          const sheetResult = await uploadPendingSheetMusic(createdSong.id);
	          if (sheetResult.ok) {
	            captureIntentEvent(
	              sheetResult.sheet
	                ? "channel_songbook_manual_save_sheet_music_upload_succeeded"
	                : "channel_songbook_manual_save_sheet_music_upload_not_needed",
	              {
	                ...buildSubmitProperties(values, "save", {
	                  song_id: createdSong.id,
	                  sheet_music_uploaded: Boolean(sheetResult.sheet),
	                  sheet_music_type: sheetResult.sheet?.type ?? null,
	                }),
	              }
	            );
	            setPendingSheetMusicFile(null);
	          } else {
	            captureIntentEvent(
	              "channel_songbook_manual_save_sheet_music_upload_failed",
	              {
	                ...buildSubmitProperties(values, "save", {
	                  song_id: createdSong.id,
	                }),
	              }
	            );
	          }

	          // 3. 클립 추가 예정이면 클립도 생성
	          let clipResult: Awaited<ReturnType<typeof handleClipCreation>> | null =
	            null;
	          if (clipPendingData) {
	            captureIntentEvent("channel_songbook_manual_save_clip_attach_submitted", {
	              ...buildSubmitProperties(values, "save", {
	                song_id: createdSong.id,
	              }),
	            });
	            clipResult = await handleClipCreation(
	              createdSong.id,
	              clipPendingData
	            );
	            captureIntentEvent(
	              clipResult.success
	                ? clipResult.isRequest
	                  ? "channel_songbook_manual_save_clip_request_succeeded"
	                  : "channel_songbook_manual_save_clip_create_succeeded"
	                : "channel_songbook_manual_save_clip_attach_failed",
	              {
	                ...buildSubmitProperties(values, "save", {
	                  song_id: createdSong.id,
	                  clip_result_is_request: Boolean(clipResult.isRequest),
	                }),
	              }
	            );
	            setClipPendingData(null);
	          } else {
	            captureIntentEvent("channel_songbook_manual_save_clip_attach_skipped", {
	              ...buildSubmitProperties(values, "save", {
	                song_id: createdSong.id,
	              }),
	            });
	          }

          // 4. 토스트 분기. 악보 실패는 별도 warning + "편집하러 가기" action 으로
          //    회복 동선을 끊지 않는다.
          if (!sheetResult.ok) {
            toast.warning(
              `노래는 저장되었지만 악보 업로드에 실패했습니다. (${sheetResult.reason})`,
              {
                duration: 8000,
                action: {
                  label: "편집하러 가기",
                  onClick: () => {
                    router.push(
                      `/channel/${identifier}/manage/songs?editId=${createdSong.id}`
                    );
                  },
                },
              }
            );
          }
          if (clipResult) {
            if (clipResult.success) {
              if (clipResult.isRequest) {
                toast.success(
                  "노래 추가 완료! 클립은 관리자 승인 후 등록됩니다."
                );
              } else {
                toast.success("노래와 클립이 함께 추가되었습니다!");
              }
            } else {
              toast.warning(
                "노래는 추가되었지만 클립 추가에 실패했습니다."
              );
            }
          } else if (sheetResult.ok) {
            toast.success("노래 추가 완료", {
              description: "새 노래가 성공적으로 추가되었습니다.",
            });
          }

          // 5. 캐시 갱신 및 이동.
          //    sheet 업로드 실패면 자동 navigation 은 건너뛴다 (사용자가 회복 행동을
          //    선택할 수 있도록). 토스트의 "편집하러 가기" 또는 페이지에 머물러서
          //    재시도 가능.
          //    백엔드 캐시는 fire-and-forget 으로 ~13초간 stale 이라 invalidate 대신
          //    optimistic prepend (helper 주석 참고). sheet 가 같이 업로드된
          //    경우엔 url/type 도 함께 박아 새 곡의 악보 표시가 자연 refetch 전에도
          //    정확하도록 한다.
          const songForCache =
            sheetResult.ok && sheetResult.sheet
              ? {
                  ...createdSong,
                  sheetMusicUrl: sheetResult.sheet.url,
                  sheetMusicType: sheetResult.sheet.type,
                }
              : createdSong;
          prependSongToListCaches(queryClient, identifier, songForCache);
          // GlobalSong 도메인 cache 무효화. SongCard 의 "노래책에 추가" 버튼
          // (useMyRegisteredGlobalSongIds) 과 /song/:id 의 "이미 등록" 표시
          // (useGlobalSongMyRegistrations) 가 즉시 재평가되도록 한다. quick-add
          // (globalSongId 있음) 는 백엔드가 매핑을 동기로 박고, free-form 은
          // SONG_CREATED 이벤트로 사후 매칭하므로 prefix 무효화 한 번이 둘 다
          // 커버. detail/clips/byArtist/search 의 channelCount 정합성도 같이.
	          queryClient.invalidateQueries({ queryKey: globalSongKeys.all });
	          if (sheetResult.ok) {
	            captureIntentEvent("channel_songbook_manual_save_succeeded", {
	              ...buildSubmitProperties(values, "save", {
	                song_id: createdSong.id,
	                sheet_music_uploaded: Boolean(sheetResult.sheet),
	                clip_attempted: Boolean(clipResult),
	                clip_succeeded: clipResult?.success ?? null,
	                navigation_target: onSuccess ? "callback" : "musicbook",
	              }),
	            });
	            handleSuccess();
	          } else {
	            captureIntentEvent("channel_songbook_manual_save_partial_succeeded", {
	              ...buildSubmitProperties(values, "save", {
	                song_id: createdSong.id,
	                partial_failure_area: "sheet_music_upload",
	                navigation_target: "stay_for_recovery",
	              }),
	            });
	          }
	        } catch (e) {
	          captureIntentEvent("channel_songbook_manual_save_failed", {
	            ...buildSubmitProperties(values, "save", {
	              error_status: getApiErrorStatus(e),
	              error_name: getErrorName(e),
	            }),
	          });
	          toast.error(
	            "노래 추가 중 오류가 발생했어요. - " +
	              extractApiErrorMessage(e, "잠시 후 다시 시도해 주세요.")
          );
        } finally {
          isSubmittingRef.current = false;
        }
      }}
      onSaveAndContinue={
        hideSaveAndContinue
	          ? undefined
	          : async (values) => {
	              captureIntentEvent(
	                "channel_songbook_manual_save_and_continue_clicked",
	                {
	                  ...buildSubmitProperties(values, "save_and_continue"),
	                }
	              );
	              if (!channelId) {
	                captureIntentEvent(
	                  "channel_songbook_manual_save_and_continue_blocked_channel_unready",
	                  {
	                    ...buildSubmitProperties(values, "save_and_continue"),
	                  }
	                );
	                return;
	              }
	              // I1: 재진입 가드.
	              if (isSubmittingRef.current) {
	                captureIntentEvent(
	                  "channel_songbook_manual_save_and_continue_blocked_duplicate_submit",
	                  {
	                    ...buildSubmitProperties(values, "save_and_continue"),
	                  }
	                );
	                return;
	              }
	              isSubmittingRef.current = true;
	              try {
	                // 1. 노래 생성 — globalSongId 유무에 따라 quick-add / 일반 분기
	                captureIntentEvent(
	                  "channel_songbook_manual_save_and_continue_song_create_submitted",
	                  {
	                    ...buildSubmitProperties(values, "save_and_continue"),
	                  }
	                );
	                const createdSong = await createSongOrQuickAdd(channelId, values);
	                captureIntentEvent(
	                  "channel_songbook_manual_save_and_continue_song_create_succeeded",
	                  {
	                    ...buildSubmitProperties(values, "save_and_continue", {
	                      song_id: createdSong.id,
	                    }),
	                  }
	                );

	                // 2. 악보 업로드 (사용자가 선택했을 때만).
	                //    실패 시 pendingSheetMusicFile 은 의도적으로 유지(=재시도 가능).
	                if (pendingSheetMusicFile) {
	                  captureIntentEvent(
	                    "channel_songbook_manual_save_and_continue_sheet_music_upload_submitted",
	                    {
	                      ...buildSubmitProperties(values, "save_and_continue", {
	                        song_id: createdSong.id,
	                      }),
	                    }
	                  );
	                } else {
	                  captureIntentEvent(
	                    "channel_songbook_manual_save_and_continue_sheet_music_upload_skipped",
	                    {
	                      ...buildSubmitProperties(values, "save_and_continue", {
	                        song_id: createdSong.id,
	                      }),
	                    }
	                  );
	                }
	                const sheetResult = await uploadPendingSheetMusic(createdSong.id);
	                if (sheetResult.ok) {
	                  captureIntentEvent(
	                    sheetResult.sheet
	                      ? "channel_songbook_manual_save_and_continue_sheet_music_upload_succeeded"
	                      : "channel_songbook_manual_save_and_continue_sheet_music_upload_not_needed",
	                    {
	                      ...buildSubmitProperties(values, "save_and_continue", {
	                        song_id: createdSong.id,
	                        sheet_music_uploaded: Boolean(sheetResult.sheet),
	                        sheet_music_type: sheetResult.sheet?.type ?? null,
	                      }),
	                    }
	                  );
	                  setPendingSheetMusicFile(null);
	                } else {
	                  captureIntentEvent(
	                    "channel_songbook_manual_save_and_continue_sheet_music_upload_failed",
	                    {
	                      ...buildSubmitProperties(values, "save_and_continue", {
	                        song_id: createdSong.id,
	                      }),
	                    }
	                  );
	                }

	                // 3. 클립 추가 예정이면 클립도 생성
	                let clipResult: Awaited<
	                  ReturnType<typeof handleClipCreation>
	                > | null = null;
	                if (clipPendingData) {
	                  captureIntentEvent(
	                    "channel_songbook_manual_save_and_continue_clip_attach_submitted",
	                    {
	                      ...buildSubmitProperties(values, "save_and_continue", {
	                        song_id: createdSong.id,
	                      }),
	                    }
	                  );
	                  clipResult = await handleClipCreation(
	                    createdSong.id,
	                    clipPendingData
	                  );
	                  captureIntentEvent(
	                    clipResult.success
	                      ? clipResult.isRequest
	                        ? "channel_songbook_manual_save_and_continue_clip_request_succeeded"
	                        : "channel_songbook_manual_save_and_continue_clip_create_succeeded"
	                      : "channel_songbook_manual_save_and_continue_clip_attach_failed",
	                    {
	                      ...buildSubmitProperties(values, "save_and_continue", {
	                        song_id: createdSong.id,
	                        clip_result_is_request: Boolean(clipResult.isRequest),
	                      }),
	                    }
	                  );
	                  setClipPendingData(null);
	                } else {
	                  captureIntentEvent(
	                    "channel_songbook_manual_save_and_continue_clip_attach_skipped",
	                    {
	                      ...buildSubmitProperties(values, "save_and_continue", {
	                        song_id: createdSong.id,
	                      }),
	                    }
	                  );
	                }

                // 4. 토스트 분기. sheet 실패는 회복 동선 (편집하러 가기) 제공.
                if (!sheetResult.ok) {
                  toast.warning(
                    `노래는 저장되었지만 악보 업로드에 실패했습니다. (${sheetResult.reason})`,
                    {
                      duration: 8000,
                      action: {
                        label: "편집하러 가기",
                        onClick: () => {
                          router.push(
                            `/channel/${identifier}/manage/songs?editId=${createdSong.id}`
                          );
                        },
                      },
                    }
                  );
                }
                if (clipResult) {
                  if (clipResult.success) {
                    if (clipResult.isRequest) {
                      toast.success(
                        "노래 추가 완료! 클립은 관리자 승인 후 등록됩니다. 계속해서 노래를 추가할 수 있습니다."
                      );
                    } else {
                      toast.success(
                        "노래와 클립이 함께 추가되었습니다! 계속해서 노래를 추가할 수 있습니다."
                      );
                    }
                  } else {
                    toast.warning(
                      "노래는 추가되었지만 클립 추가에 실패했습니다. 계속해서 노래를 추가할 수 있습니다."
                    );
                  }
                } else if (sheetResult.ok) {
                  toast.success("노래 추가 완료", {
                    description: "계속해서 노래를 추가할 수 있습니다.",
                  });
                }

                // 5. 캐시 갱신 — backend fire-and-forget stale 윈도우 회피 위해
                //    optimistic prepend (helper 주석 참고).
                const songForCache =
                  sheetResult.ok && sheetResult.sheet
                    ? {
                        ...createdSong,
                        sheetMusicUrl: sheetResult.sheet.url,
                        sheetMusicType: sheetResult.sheet.type,
                      }
                    : createdSong;
                prependSongToListCaches(queryClient, identifier, songForCache);
                queryClient.invalidateQueries({ queryKey: globalSongKeys.all });

                // sheet 업로드 실패 시 form.reset 을 건너뛰어 사용자가 같은 화면에서
                // 재시도하거나 회복 액션을 취할 수 있게 한다. 곡 A 의 sheet 가 곡 B 에
	                // carry-over 되는 사고도 동시에 방지된다.
	                if (!sheetResult.ok) {
	                  captureIntentEvent(
	                    "channel_songbook_manual_save_and_continue_partial_succeeded",
	                    {
	                      ...buildSubmitProperties(values, "save_and_continue", {
	                        song_id: createdSong.id,
	                        partial_failure_area: "sheet_music_upload",
	                        reset_skipped: true,
	                      }),
	                    }
	                  );
	                  return { skipReset: true };
	                }
	                captureIntentEvent(
	                  "channel_songbook_manual_save_and_continue_succeeded",
	                  {
	                    ...buildSubmitProperties(values, "save_and_continue", {
	                      song_id: createdSong.id,
	                      sheet_music_uploaded: Boolean(sheetResult.sheet),
	                      clip_attempted: Boolean(clipResult),
	                      clip_succeeded: clipResult?.success ?? null,
	                      reset_skipped: false,
	                    }),
	                  }
	                );
	              } catch (e) {
	                captureIntentEvent(
	                  "channel_songbook_manual_save_and_continue_failed",
	                  {
	                    ...buildSubmitProperties(values, "save_and_continue", {
	                      error_status: getApiErrorStatus(e),
	                      error_name: getErrorName(e),
	                      reset_skipped: true,
	                    }),
	                  }
	                );
	                toast.error(
	                  "노래 추가 중 오류가 발생했어요. - " +
	                    extractApiErrorMessage(e, "잠시 후 다시 시도해 주세요.")
                );
                // 예외가 터지면 reset 하면 안 된다 (입력값 보존).
                return { skipReset: true };
              } finally {
                isSubmittingRef.current = false;
              }
            }
      }
    />
  );
}
