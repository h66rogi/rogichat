"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Alert, AlertDescription } from "@/meloming/shared/components/ui/alert";
import { Music, Radio, Send } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/meloming/shared/components/ui/avatar";
import { toast } from "sonner";
import {
  useChannelSongPermission,
  useCreateSongAddRequest,
} from "@/meloming/domains/channel/hooks/use-song-requests";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { SongFormV2 } from "@/meloming/domains/channel/components/management/song-form-v2";
import type { SongFormValues } from "@/meloming/domains/channel/components/management/song-form.schema";
import type { CreateSongAddRequestBody } from "@/meloming/domains/channel/types/song-request";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  getApiErrorStatus,
  getErrorName,
  getSongFormSummary,
  getSongRequestSummary,
} from "@/meloming/domains/channel/components/management/songbook-analytics";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SongAddRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 채널 identifier (webPath) */
  channelIdentifier: string;
  /** 채널 ID (권한 체크용, 필수) */
  channelId: number;
  /** 채널 이름 (표시용, 선택적) */
  channelName?: string;
  /** 채널 프로필 이미지 (표시용, 선택적) */
  channelProfileImageUrl?: string | null;
  onSuccess?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasMeaningfulSongFormInput(values: SongFormValues): boolean {
  return [
    values.title,
    values.artistName,
    values.albumArt,
    values.karaokeUrl,
    values.coverUrl,
    values.originalUrl,
    values.lyricsLink,
    values.lyricsText,
    values.songKey,
    values.bpm,
    values.proficiency,
    values.categoryNames?.length ? "category" : "",
    values.difficulty && values.difficulty !== 1 ? "difficulty" : "",
  ].some((value) => {
    if (typeof value === "number") return !Number.isNaN(value);
    if (typeof value === "string") return value.trim().length > 0;
    return Boolean(value);
  });
}

export function SongAddRequestDialog({
  open,
  onOpenChange,
  channelIdentifier,
  channelId,
  channelName,
  channelProfileImageUrl,
  onSuccess,
}: SongAddRequestDialogProps) {
  const [currentFormValues, setCurrentFormValues] = useState<SongFormValues | null>(
    null
  );
  const closeReasonRef = useRef("dismissed");
  const dialogViewedRef = useRef(false);
  const permissionLoadingViewedRef = useRef(false);
  const permissionLoadedSignatureRef = useRef<string | null>(null);
  const permissionFailedSignatureRef = useRef<string | null>(null);
  const requestModeNoticeViewedRef = useRef(false);
  const directPermissionViewedRef = useRef(false);
  const cannotRequestViewedRef = useRef(false);
  const formStartedCapturedRef = useRef(false);
  const titleCapturedRef = useRef(false);
  const artistCapturedRef = useRef(false);
  const requiredFieldsCapturedRef = useRef(false);
  const categoryCapturedRef = useRef(false);
  const mediaCapturedRef = useRef(false);
  const referenceCapturedRef = useRef(false);
  const lyricsTextCapturedRef = useRef(false);
  const songKeyCapturedRef = useRef(false);
  const bpmCapturedRef = useRef(false);
  const difficultyCapturedRef = useRef(false);
  const autoAlbumSearchEligibleCapturedRef = useRef(false);

  // 사용자 정보
  const { user } = useAuth();

  // 권한 체크
  const {
    data: permission,
    isLoading: isLoadingPermission,
    error: permissionError,
  } =
    useChannelSongPermission(open ? channelId : undefined, {
      enabled: open,
    });

  const hasPermission = permission?.hasPermission ?? false;
  const canRequestSong = permission?.canRequestSong ?? false;

  const createSongRequestMutation = useCreateSongAddRequest();

  const getDialogEventProperties = useCallback(
    () => ({
      channel_id: channelId || null,
      channel_identifier_present: Boolean(channelIdentifier),
      channel_name_present: hasText(channelName),
      channel_profile_image_present: hasText(channelProfileImageUrl),
      viewer_authenticated: Boolean(user),
      permission_loaded: Boolean(permission),
      permission_loading: isLoadingPermission,
      has_direct_song_permission: hasPermission,
      can_request_song: canRequestSong,
    }),
    [
      canRequestSong,
      channelId,
      channelIdentifier,
      channelName,
      channelProfileImageUrl,
      hasPermission,
      isLoadingPermission,
      permission,
      user,
    ]
  );

  const buildCreateBody = useCallback(
    (values: SongFormValues): CreateSongAddRequestBody => ({
      channelId,
      title: values.title,
      artistName: values.artistName || "",
      albumArt: values.albumArt || undefined,
      karaokeUrl: values.karaokeUrl || undefined,
      coverUrl: values.coverUrl || undefined,
      originalUrl: values.originalUrl || undefined,
      difficulty: values.difficulty || undefined,
      proficiency: values.proficiency || undefined,
      songKey: values.songKey || undefined,
      bpm: values.bpm ? Number(values.bpm) : undefined,
      lyricsLink: values.lyricsLink || undefined,
      lyricsText: values.lyricsText || undefined,
      categoryNames: values.categoryNames?.length ? values.categoryNames : undefined,
      autoSearchAlbumArt: values.albumArt ? undefined : true,
    }),
    [channelId]
  );

  const captureFormMilestones = useCallback(
    (values: SongFormValues) => {
      const eventProperties = {
        ...getDialogEventProperties(),
        ...getSongFormSummary(values),
      };

      if (!formStartedCapturedRef.current && hasMeaningfulSongFormInput(values)) {
        formStartedCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_form_started", {
          ...eventProperties,
        });
      }

      if (!titleCapturedRef.current && hasText(values.title)) {
        titleCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_title_entered", {
          ...eventProperties,
        });
      }

      if (!artistCapturedRef.current && hasText(values.artistName)) {
        artistCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_artist_entered", {
          ...eventProperties,
        });
      }

      if (
        !requiredFieldsCapturedRef.current &&
        hasText(values.title) &&
        hasText(values.artistName)
      ) {
        requiredFieldsCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_required_fields_completed", {
          ...eventProperties,
        });
      }

      if (
        !categoryCapturedRef.current &&
        (values.categoryNames?.filter(hasText).length ?? 0) > 0
      ) {
        categoryCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_category_added", {
          ...eventProperties,
        });
      }

      if (
        !mediaCapturedRef.current &&
        [values.albumArt, values.karaokeUrl, values.coverUrl, values.originalUrl].some(
          hasText
        )
      ) {
        mediaCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_media_added", {
          ...eventProperties,
        });
      }

      if (
        !referenceCapturedRef.current &&
        [values.lyricsLink, values.lyricsText].some(hasText)
      ) {
        referenceCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_reference_added", {
          ...eventProperties,
        });
      }

      if (!lyricsTextCapturedRef.current && hasText(values.lyricsText)) {
        lyricsTextCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_lyrics_text_entered", {
          ...eventProperties,
        });
      }

      if (!songKeyCapturedRef.current && hasText(values.songKey)) {
        songKeyCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_song_key_entered", {
          ...eventProperties,
        });
      }

      if (!bpmCapturedRef.current && values.bpm !== undefined && values.bpm !== "") {
        bpmCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_bpm_entered", {
          ...eventProperties,
        });
      }

      if (
        !difficultyCapturedRef.current &&
        typeof values.difficulty === "number" &&
        values.difficulty !== 1
      ) {
        difficultyCapturedRef.current = true;
        captureIntentEvent("channel_songbook_add_request_difficulty_changed", {
          ...eventProperties,
        });
      }

      if (
        !autoAlbumSearchEligibleCapturedRef.current &&
        hasText(values.title) &&
        hasText(values.artistName) &&
        !hasText(values.albumArt)
      ) {
        autoAlbumSearchEligibleCapturedRef.current = true;
        captureIntentEvent(
          "channel_songbook_add_request_auto_album_search_eligible",
          {
            ...eventProperties,
            auto_search_album_art: true,
          }
        );
      }
    },
    [getDialogEventProperties]
  );

  const handleValuesChange = useCallback(
    (values: SongFormValues) => {
      setCurrentFormValues(values);
      captureFormMilestones(values);
    },
    [captureFormMilestones]
  );

  useEffect(() => {
    if (!open) {
      dialogViewedRef.current = false;
      return;
    }

    if (dialogViewedRef.current) return;
    dialogViewedRef.current = true;

    closeReasonRef.current = "dismissed";
    permissionLoadingViewedRef.current = false;
    permissionLoadedSignatureRef.current = null;
    permissionFailedSignatureRef.current = null;
    requestModeNoticeViewedRef.current = false;
    directPermissionViewedRef.current = false;
    cannotRequestViewedRef.current = false;
    formStartedCapturedRef.current = false;
    titleCapturedRef.current = false;
    artistCapturedRef.current = false;
    requiredFieldsCapturedRef.current = false;
    categoryCapturedRef.current = false;
    mediaCapturedRef.current = false;
    referenceCapturedRef.current = false;
    lyricsTextCapturedRef.current = false;
    songKeyCapturedRef.current = false;
    bpmCapturedRef.current = false;
    difficultyCapturedRef.current = false;
    autoAlbumSearchEligibleCapturedRef.current = false;
    setCurrentFormValues(null);

    captureIntentEvent("channel_songbook_add_request_dialog_viewed", {
      ...getDialogEventProperties(),
    });
  }, [getDialogEventProperties, open]);

  useEffect(() => {
    if (!open || !isLoadingPermission || permissionLoadingViewedRef.current) return;
    permissionLoadingViewedRef.current = true;
    captureIntentEvent("channel_songbook_add_request_permission_loading_viewed", {
      ...getDialogEventProperties(),
    });
  }, [getDialogEventProperties, isLoadingPermission, open]);

  useEffect(() => {
    if (!open || !permission) return;
    const signature = `${permission.hasPermission}:${permission.canRequestSong}`;
    if (permissionLoadedSignatureRef.current === signature) return;
    permissionLoadedSignatureRef.current = signature;
    captureIntentEvent("channel_songbook_add_request_permission_loaded", {
      ...getDialogEventProperties(),
      permission_has_direct_song_permission: permission.hasPermission,
      permission_can_request_song: permission.canRequestSong,
    });
  }, [getDialogEventProperties, open, permission]);

  useEffect(() => {
    if (!open || !permissionError) return;
    const signature = `${getErrorName(permissionError)}:${getApiErrorStatus(permissionError)}`;
    if (permissionFailedSignatureRef.current === signature) return;
    permissionFailedSignatureRef.current = signature;
    captureIntentEvent("channel_songbook_add_request_permission_load_failed", {
      ...getDialogEventProperties(),
      error_name: getErrorName(permissionError),
      error_status: getApiErrorStatus(permissionError),
    });
  }, [getDialogEventProperties, open, permissionError]);

  useEffect(() => {
    if (
      !open ||
      isLoadingPermission ||
      hasPermission ||
      !canRequestSong ||
      requestModeNoticeViewedRef.current
    ) {
      return;
    }
    requestModeNoticeViewedRef.current = true;
    captureIntentEvent("channel_songbook_add_request_request_mode_notice_viewed", {
      ...getDialogEventProperties(),
    });
  }, [
    canRequestSong,
    getDialogEventProperties,
    hasPermission,
    isLoadingPermission,
    open,
  ]);

  useEffect(() => {
    if (!open || isLoadingPermission || !hasPermission || directPermissionViewedRef.current) {
      return;
    }
    directPermissionViewedRef.current = true;
    captureIntentEvent("channel_songbook_add_request_direct_permission_viewed", {
      ...getDialogEventProperties(),
    });
  }, [getDialogEventProperties, hasPermission, isLoadingPermission, open]);

  useEffect(() => {
    if (
      !open ||
      isLoadingPermission ||
      hasPermission ||
      canRequestSong ||
      cannotRequestViewedRef.current
    ) {
      return;
    }
    cannotRequestViewedRef.current = true;
    captureIntentEvent("channel_songbook_add_request_cannot_request_viewed", {
      ...getDialogEventProperties(),
    });
  }, [
    canRequestSong,
    getDialogEventProperties,
    hasPermission,
    isLoadingPermission,
    open,
  ]);

  const handleDialogOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }

      captureIntentEvent("channel_songbook_add_request_dialog_closed", {
        ...getDialogEventProperties(),
        close_reason: closeReasonRef.current,
        ...getSongFormSummary(currentFormValues ?? {}),
      });
      onOpenChange(false);
    },
    [currentFormValues, getDialogEventProperties, onOpenChange]
  );

  // 노래 신청 처리
  const handleSubmit = async (values: SongFormValues) => {
    const body = buildCreateBody(values);
    const eventProperties = {
      ...getDialogEventProperties(),
      ...getSongFormSummary(values),
      auto_search_album_art: body.autoSearchAlbumArt === true,
    };
    captureIntentEvent("channel_songbook_add_request_create_submitted", {
      ...eventProperties,
    });

    try {
      const createdRequest = await createSongRequestMutation.mutateAsync(body);
      captureIntentEvent("channel_songbook_add_request_create_succeeded", {
        ...eventProperties,
        ...getSongRequestSummary(createdRequest, "created_request"),
      });

      toast.success("노래 추가 요청이 완료되었습니다. 채널 관리자 승인 후 등록됩니다.");
      closeReasonRef.current = "create_succeeded";
      handleDialogOpenChange(false);
      onSuccess?.();

    } catch (error) {
      console.error("Failed to create song request:", error);
      captureIntentEvent("channel_songbook_add_request_create_failed", {
        ...eventProperties,
        error_name: getErrorName(error),
        error_status: getApiErrorStatus(error),
      });
      toast.error("노래 추가 요청에 실패했습니다");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music className="size-5" />
            노래 추가 요청
          </DialogTitle>
          <DialogDescription>
            노래 정보를 입력하세요. 채널 관리자 승인 후 등록됩니다.
          </DialogDescription>
        </DialogHeader>

        {/* 요청 모드 안내 */}
        {!isLoadingPermission && !hasPermission && canRequestSong && (
          <Alert>
            <Send className="size-4" />
            <AlertDescription>
              이 채널에 직접 노래를 등록할 권한이 없습니다.
              요청하면 채널 관리자 검토 후 등록됩니다.
            </AlertDescription>
          </Alert>
        )}

        {/* 채널 정보 표시 */}
        {channelName && (
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md">
            <Radio className="size-4 text-muted-foreground shrink-0" />
            <Avatar className="size-6 shrink-0">
              <AvatarImage src={channelProfileImageUrl ?? undefined} />
              <AvatarFallback className="text-xs">
                {channelName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-muted-foreground truncate">
              <span className="font-medium text-foreground">{channelName}</span>
              에 노래 추가 요청
            </span>
          </div>
        )}

        {/* SongFormV2 재사용 - relaxed 모드로 카테고리 필수 아님, requestMode로 생성 API 호출 안 함 */}
        <SongFormV2
          identifier={channelIdentifier}
          channelId={channelId}
          submitLabel="노래 추가 요청"
          onSubmit={handleSubmit}
          onValuesChange={handleValuesChange}
          validationMode="relaxed"
          requestMode={true}
        />
      </DialogContent>
    </Dialog>
  );
}
