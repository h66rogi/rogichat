"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { Alert, AlertDescription } from "@/meloming/shared/components/ui/alert";
import { X, Music, Loader2, ArrowLeft, Link as LinkIcon, Radio, Send, AlertCircle, Upload, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/meloming/shared/components/ui/avatar";
import { toast } from "sonner";
import { useImageUpload } from "@/meloming/shared/hooks/use-image-upload";
import { useCreateClip } from "@/meloming/domains/clip/hooks/use-clips";
import {
  useChannelClipPermission,
  useCreateClipRequest,
} from "@/meloming/domains/clip/hooks/use-clip-requests";
import { resolveClipUrl } from "@/meloming/domains/clip/apis/clips";
import { SongSearchCombobox } from "@/meloming/domains/clip/components/song-search-combobox";
import { ChannelTagDialog } from "@/meloming/domains/clip/components/channel-tag-dialog";
import { TaggedChannelsList, type TaggedChannelItem } from "@/meloming/domains/clip/components/tagged-channels-list";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { useFeatureFlag } from "@/meloming/shared/hooks/use-feature-flag";
import { IdentityVerificationWall } from "@/meloming/domains/user/components/identity-verification-wall";
import { AddToPlaylistDialog } from "@/meloming/domains/playlist/components/add-to-playlist-dialog";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import type { ClipPlatform, ResolveClipResponse } from "@/meloming/domains/clip/types/clip";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  countBucket,
  durationBucket,
  fileSizeBucket,
  getApiErrorStatus,
  getErrorName,
  textLengthBucket,
} from "@/meloming/domains/channel/components/management/songbook-analytics";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitialSong {
  channelId: number;
  songId: number;
  songTitle: string;
  artistName: string;
}

interface ClipCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelIdentifier: string;
  /** 채널 ID (권한 체크용, 필수) */
  channelId: number;
  /** 채널 이름 (표시용, 선택적) */
  channelName?: string;
  /** 채널 프로필 이미지 (표시용, 선택적) */
  channelProfileImageUrl?: string | null;
  initialSong?: InitialSong | null;
  onSuccess?: () => void;
}

// ---------------------------------------------------------------------------
// Form Schemas
// ---------------------------------------------------------------------------

// Step 1: URL 입력
const urlInputSchema = z.object({
  url: z.string().min(1, "영상 URL을 입력해주세요"),
});

type UrlInputFormData = z.infer<typeof urlInputSchema>;

// Step 2: 클립 정보 입력
const clipCreateSchema = z.object({
  title: z
    .string()
    .min(1, "제목을 입력해주세요")
    .max(100, "제목은 100자 이내로 입력해주세요"),
  platform: z.enum(["YOUTUBE", "SOOP", "CHZZK", "MELOMING"]),
  videoId: z.string().min(1, "영상 ID가 필요합니다"),
  thumbnailUrl: z
    .string()
    .url("올바른 URL 형식이 아닙니다")
    .optional()
    .or(z.literal("")),
  description: z.string().max(500, "설명은 500자 이내로 입력해주세요").optional(),
  duration: z.number().optional(),
  publishToHotClip: z.boolean(),
  selectedSong: z
    .object({
      channelId: z.number(),
      songId: z.number(),
      songTitle: z.string(),
      artistName: z.string(),
    })
    .nullable(),
});

type ClipCreateFormData = z.infer<typeof clipCreateSchema>;

function getClipCreateUrlSource(value: string): string {
  const lowerValue = value.toLowerCase();
  if (lowerValue.includes("youtube.com") || lowerValue.includes("youtu.be")) {
    return "youtube";
  }
  if (lowerValue.includes("chzzk.naver.com/video")) {
    return "chzzk_vod";
  }
  if (lowerValue.includes("chzzk.naver.com")) {
    return "chzzk";
  }
  if (lowerValue.includes("sooplive.co.kr") || lowerValue.includes("afreecatv.com")) {
    return "soop";
  }
  if (lowerValue.includes("meloming.com")) {
    return "meloming";
  }
  return lowerValue.trim().length > 0 ? "other" : "empty";
}

function getResolveResultSummary(result: ResolveClipResponse | null | undefined) {
  return {
    resolved: Boolean(result),
    resolved_platform: result?.platform ?? null,
    resolved_title_length_bucket: textLengthBucket(result?.title),
    resolved_description_length_bucket: textLengthBucket(result?.description),
    resolved_duration_bucket: durationBucket(result?.duration),
    resolved_has_video_id: Boolean(result?.videoId),
    resolved_has_thumbnail_url: Boolean(result?.thumbnailUrl),
  };
}

function getClipCreateFormSummary(
  values: Partial<ClipCreateFormData>,
  taggedChannelCount: number,
) {
  return {
    title_length_bucket: textLengthBucket(values.title),
    description_length_bucket: textLengthBucket(values.description),
    platform: values.platform ?? null,
    has_video_id: Boolean(values.videoId),
    has_thumbnail_url: Boolean(values.thumbnailUrl),
    duration_bucket: durationBucket(values.duration),
    publish_to_hot_clip: Boolean(values.publishToHotClip),
    selected_song_set: Boolean(values.selectedSong),
    selected_song_channel_id: values.selectedSong?.channelId ?? null,
    selected_song_id: values.selectedSong?.songId ?? null,
    tagged_channel_count: taggedChannelCount,
    tagged_channel_count_bucket: countBucket(taggedChannelCount),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClipCreateDialog({
  open,
  onOpenChange,
  channelIdentifier,
  channelId,
  channelName,
  channelProfileImageUrl,
  initialSong,
  onSuccess,
}: ClipCreateDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedData, setResolvedData] = useState<ResolveClipResponse | null>(null);
  const openedSignatureRef = useRef<string | null>(null);
  const permissionSignatureRef = useRef<string | null>(null);
  const permissionNoticeViewedRef = useRef(false);
  const identityWallViewedRef = useRef(false);
  const stepTwoViewedRef = useRef(false);
  const playlistDialogViewedRef = useRef(false);
  const urlInputFocusedRef = useRef(false);
  const urlInputStartedRef = useRef(false);
  const titleFocusedRef = useRef(false);
  const titleEditedRef = useRef(false);
  const descriptionFocusedRef = useRef(false);
  const descriptionEditedRef = useRef(false);
  const thumbnailUrlEditedRef = useRef(false);

  // 태그 채널 관련 상태
  const [taggedChannels, setTaggedChannels] = useState<TaggedChannelItem[]>([]);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  // 사용자 정보 및 본인인증 상태
  const { user } = useAuth();
  const isIdentityVerified = user?.isIdentityVerified ?? false;

  // 재생목록 추가 기능
  const playlistEnabled = useFeatureFlag('playlist');
  const [createdClipId, setCreatedClipId] = useState<number | null>(null);

  // 권한 체크
  const {
    data: permission,
    isLoading: isLoadingPermission,
    error: permissionError,
  } =
    useChannelClipPermission(open ? channelId : undefined, {
      enabled: open,
    });

  const hasPermission = permission?.hasPermission ?? false;
  const canRequestClip = permission?.canRequestClip ?? false;

  // 클립 요청 시 본인인증 필요 여부 (권한이 없고 요청 가능한 경우에만)
  const needsIdentityVerification = !hasPermission && canRequestClip && !isIdentityVerified;

  const createClipMutation = useCreateClip(channelIdentifier);
  const createClipRequestMutation = useCreateClipRequest();

  // 썸네일 업로드
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const { uploadImage, isUploading: isUploadingThumbnail } = useImageUpload();

  // Step 1 form
  const urlForm = useForm<UrlInputFormData>({
    resolver: zodResolver(urlInputSchema),
    defaultValues: { url: "" },
  });

  // Step 2 form
  const clipForm = useForm<ClipCreateFormData>({
    resolver: zodResolver(clipCreateSchema),
    defaultValues: {
      title: "",
      platform: "YOUTUBE",
      videoId: "",
      thumbnailUrl: "",
      description: "",
      duration: undefined,
      publishToHotClip: true,
      selectedSong: initialSong ?? null,
    },
  });

  const selectedSong = clipForm.watch("selectedSong");
  const thumbnailUrl = clipForm.watch("thumbnailUrl");
  const publishToHotClip = clipForm.watch("publishToHotClip");
  const titleRegistration = clipForm.register("title");
  const thumbnailUrlRegistration = clipForm.register("thumbnailUrl");
  const descriptionRegistration = clipForm.register("description");
  const urlRegistration = urlForm.register("url");

  const getContextSummary = () => ({
    channel_id: channelId,
    has_initial_song: Boolean(initialSong),
    initial_song_id: initialSong?.songId ?? null,
    initial_song_channel_id: initialSong?.channelId ?? null,
    has_channel_display_name: Boolean(channelName),
    has_channel_profile_image: Boolean(channelProfileImageUrl),
    step,
    permission_loading: isLoadingPermission,
    has_permission: hasPermission,
    can_request_clip: canRequestClip,
    needs_identity_verification: needsIdentityVerification,
    mode: hasPermission ? "direct_create" : canRequestClip ? "request" : "blocked",
    playlist_enabled: Boolean(playlistEnabled),
    resolved_data_present: Boolean(resolvedData),
    selected_song_set: Boolean(selectedSong),
    selected_song_id: selectedSong?.songId ?? null,
    selected_song_channel_id: selectedSong?.channelId ?? null,
    tagged_channel_count: taggedChannels.length,
    tagged_channel_count_bucket: countBucket(taggedChannels.length),
    publish_to_hot_clip: Boolean(publishToHotClip),
  });

  const getCurrentFormSummary = () =>
    getClipCreateFormSummary(clipForm.getValues(), taggedChannels.length);

  // 썸네일 업로드 핸들러
  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileProperties = {
      ...getContextSummary(),
      file_mime_type: file.type || "unknown",
      file_size_bucket: fileSizeBucket(file.size),
    };
    captureIntentEvent("clip_create_dialog_thumbnail_file_selected", fileProperties);

    // 이미지 타입 검증
    if (!file.type.startsWith("image/")) {
      captureIntentEvent("clip_create_dialog_thumbnail_upload_blocked_type", fileProperties);
      toast.error("이미지 파일만 업로드할 수 있습니다");
      return;
    }

    // 파일 크기 검증 (10MB)
    if (file.size > 10 * 1024 * 1024) {
      captureIntentEvent("clip_create_dialog_thumbnail_upload_blocked_size", fileProperties);
      toast.error("파일 크기는 10MB 이하여야 합니다");
      return;
    }

    captureIntentEvent("clip_create_dialog_thumbnail_upload_submitted", fileProperties);
    try {
      const result = await uploadImage(file);
      clipForm.setValue("thumbnailUrl", result.imageUrl);
      captureIntentEvent("clip_create_dialog_thumbnail_upload_succeeded", {
        ...fileProperties,
        has_uploaded_url: Boolean(result.imageUrl),
      });
    } catch (uploadError) {
      captureIntentEvent("clip_create_dialog_thumbnail_upload_failed", {
        ...fileProperties,
        api_status: getApiErrorStatus(uploadError),
        error_name: getErrorName(uploadError),
      });
      toast.error("썸네일 업로드에 실패했습니다");
    }

    // input 초기화 (같은 파일 재선택 가능하도록)
    if (thumbnailInputRef.current) {
      thumbnailInputRef.current.value = "";
    }
  };

  // Dialog 열릴 때 초기 노래 설정
  useEffect(() => {
    if (open && initialSong) {
      clipForm.setValue("selectedSong", initialSong);
    }
  }, [open, initialSong, clipForm]);

  // Dialog 닫힐 때 전체 리셋
  useEffect(() => {
    if (!open) {
      setStep(1);
      setResolvedData(null);
      setTaggedChannels([]);
      setTagDialogOpen(false);
      setCreatedClipId(null);
      urlForm.reset({ url: "" });
      clipForm.reset({
        title: "",
        platform: "YOUTUBE",
        videoId: "",
        thumbnailUrl: "",
        description: "",
        duration: undefined,
        publishToHotClip: true,
        selectedSong: initialSong ?? null,
      });
    }
  }, [open, urlForm, clipForm, initialSong]);

  useEffect(() => {
    if (!open) return;
    const openedSignature = `${channelId}:${initialSong?.songId ?? "none"}`;
    if (openedSignatureRef.current === openedSignature) return;
    openedSignatureRef.current = openedSignature;
    captureIntentEvent("clip_create_dialog_opened", {
      ...getContextSummary(),
    });
    if (initialSong) {
      captureIntentEvent("clip_create_dialog_initial_song_prefilled", {
        ...getContextSummary(),
      });
    }
  }, [channelId, initialSong, open]);

  useEffect(() => {
    if (!open || !permission) return;
    const permissionSignature = `${channelId}:${permission.hasPermission}:${permission.canRequestClip}`;
    if (permissionSignatureRef.current === permissionSignature) return;
    permissionSignatureRef.current = permissionSignature;
    captureIntentEvent("clip_create_dialog_permission_loaded", {
      ...getContextSummary(),
      permission_channel_id: permission.channelId,
      permission_has_permission: permission.hasPermission,
      permission_can_request_clip: permission.canRequestClip,
    });
  }, [channelId, open, permission]);

  useEffect(() => {
    if (!open || !permissionError) return;
    captureIntentEvent("clip_create_dialog_permission_load_failed", {
      ...getContextSummary(),
      api_status: getApiErrorStatus(permissionError),
      error_name: getErrorName(permissionError),
    });
  }, [open, permissionError]);

  useEffect(() => {
    if (!open || isLoadingPermission || hasPermission || !canRequestClip) return;
    if (permissionNoticeViewedRef.current) return;
    permissionNoticeViewedRef.current = true;
    captureIntentEvent("clip_create_dialog_request_mode_notice_viewed", {
      ...getContextSummary(),
    });
  }, [canRequestClip, hasPermission, isLoadingPermission, open]);

  useEffect(() => {
    if (!open || !needsIdentityVerification || identityWallViewedRef.current) return;
    identityWallViewedRef.current = true;
    captureIntentEvent("clip_create_dialog_identity_wall_viewed", {
      ...getContextSummary(),
    });
  }, [needsIdentityVerification, open]);

  useEffect(() => {
    if (!open || step !== 2 || stepTwoViewedRef.current) return;
    stepTwoViewedRef.current = true;
    captureIntentEvent("clip_create_dialog_details_step_viewed", {
      ...getContextSummary(),
      ...getResolveResultSummary(resolvedData),
      ...getCurrentFormSummary(),
    });
  }, [open, resolvedData, step]);

  useEffect(() => {
    if (!open) {
      openedSignatureRef.current = null;
      permissionSignatureRef.current = null;
      permissionNoticeViewedRef.current = false;
      identityWallViewedRef.current = false;
      stepTwoViewedRef.current = false;
      urlInputFocusedRef.current = false;
      urlInputStartedRef.current = false;
      titleFocusedRef.current = false;
      titleEditedRef.current = false;
      descriptionFocusedRef.current = false;
      descriptionEditedRef.current = false;
      thumbnailUrlEditedRef.current = false;
      playlistDialogViewedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!playlistEnabled || createdClipId === null || playlistDialogViewedRef.current) return;
    playlistDialogViewedRef.current = true;
    captureIntentEvent("clip_create_dialog_playlist_add_dialog_opened", {
      ...getContextSummary(),
      created_clip_id: createdClipId,
    });
  }, [createdClipId, playlistEnabled]);

  // 치지직 비디오(VOD) URL 패턴 검사
  const isChzzkVideoUrl = (url: string): boolean => {
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes("chzzk.naver.com/video");
  };

  // URL resolve 처리
  const handleResolve = async (data: UrlInputFormData) => {
    const urlProperties = {
      ...getContextSummary(),
      url_length_bucket: textLengthBucket(data.url),
      url_source_guess: getClipCreateUrlSource(data.url),
    };
    captureIntentEvent("clip_create_dialog_url_resolve_submitted", urlProperties);

    // 치지직 비디오(VOD) URL 체크
    if (isChzzkVideoUrl(data.url)) {
      captureIntentEvent("clip_create_dialog_url_resolve_blocked_chzzk_vod", urlProperties);
      toast.error("치지직은 클립만 등록할 수 있습니다. 비디오(VOD)는 지원하지 않습니다.");
      return;
    }

    setIsResolving(true);
    try {
      const result = await resolveClipUrl({ url: data.url });
      setResolvedData(result);
      captureIntentEvent("clip_create_dialog_url_resolve_succeeded", {
        ...urlProperties,
        ...getResolveResultSummary(result),
      });

      // Step 2 폼에 데이터 채우기
      clipForm.setValue("title", result.title);
      clipForm.setValue("platform", result.platform);
      clipForm.setValue("videoId", result.videoId);
      clipForm.setValue("thumbnailUrl", result.thumbnailUrl || "");
      clipForm.setValue("description", result.description || "");
      clipForm.setValue("duration", result.duration);

      setStep(2);
    } catch (error) {
      console.error("Failed to resolve clip URL:", error);
      captureIntentEvent("clip_create_dialog_url_resolve_failed", {
        ...urlProperties,
        api_status: getApiErrorStatus(error),
        error_name: getErrorName(error),
      });
      toast.error("영상 정보를 불러오는데 실패했습니다. URL을 확인해주세요.");
    } finally {
      setIsResolving(false);
    }
  };

  // 클립 등록/신청 처리
  const handleSubmit = async (data: ClipCreateFormData) => {
    const eventProperties = {
      ...getContextSummary(),
      ...getClipCreateFormSummary(data, taggedChannels.length),
      submit_mode: hasPermission ? "direct_create" : "request",
    };
    captureIntentEvent("clip_create_dialog_submit_submitted", eventProperties);

    if (!data.selectedSong) {
      captureIntentEvent("clip_create_dialog_submit_blocked_missing_song", eventProperties);
      toast.error("노래를 선택해주세요");
      return;
    }

    try {
      if (hasPermission) {
        captureIntentEvent("clip_create_dialog_direct_create_submitted", eventProperties);
        // 권한이 있으면 직접 등록
        const createdClip = await createClipMutation.mutateAsync({
          title: data.title,
          platform: data.platform,
          // 새로운 방식: primaryChannel + taggedChannels
          primaryChannel: {
            channelId: data.selectedSong.channelId,
            songId: data.selectedSong.songId,
          },
          taggedChannels: taggedChannels.map((tc) => ({
            channelId: tc.channelId,
            songId: tc.songId,
          })),
          description: data.description || undefined,
          videoId: data.videoId,
          thumbnailUrl: data.thumbnailUrl || undefined,
          duration: data.duration,
          publishToHotClip: data.publishToHotClip,
        });

        captureIntentEvent("clip_create_dialog_direct_create_succeeded", {
          ...eventProperties,
          created_clip_id: createdClip.id,
        });
        toast.success("클립이 등록되었습니다");
        onOpenChange(false);
        onSuccess?.();

        if (playlistEnabled) {
          setCreatedClipId(createdClip.id);
        }

        // 생성된 클립 페이지로 이동
        captureIntentEvent("clip_create_dialog_direct_create_redirected", {
          ...eventProperties,
          created_clip_id: createdClip.id,
        });
        router.push(`/clip/${createdClip.id}`);
      } else {
        captureIntentEvent("clip_create_dialog_request_create_submitted", eventProperties);
        // 권한이 없으면 신청
        const createdRequest = await createClipRequestMutation.mutateAsync({
          channelId: data.selectedSong.channelId,
          songId: data.selectedSong.songId,
          title: data.title,
          platform: data.platform,
          description: data.description || undefined,
          videoId: data.videoId,
          thumbnailUrl: data.thumbnailUrl || undefined,
          duration: data.duration,
          publishToHotClip: data.publishToHotClip,
        });

        captureIntentEvent("clip_create_dialog_request_create_succeeded", {
          ...eventProperties,
          created_request_id: createdRequest.id,
          created_request_status: createdRequest.status,
        });
        toast.success("클립 등록 요청이 완료되었습니다. 채널 관리자 승인 후 등록됩니다.");
        onOpenChange(false);
        onSuccess?.();

      }
    } catch (error: unknown) {
      console.error("Failed to create clip:", error);
      if (hasPermission) {
        captureIntentEvent("clip_create_dialog_direct_create_failed", {
          ...eventProperties,
          api_status: getApiErrorStatus(error),
          error_name: getErrorName(error),
        });
      } else {
        captureIntentEvent("clip_create_dialog_request_create_failed", {
          ...eventProperties,
          api_status: getApiErrorStatus(error),
          error_name: getErrorName(error),
        });
      }
      const errorMessage = extractApiErrorMessage(
        error,
        hasPermission ? "클립 등록에 실패했습니다" : "클립 요청에 실패했습니다"
      );
      toast.error(errorMessage);
    }
  };

  const handleBack = () => {
    captureIntentEvent("clip_create_dialog_back_to_url_step_clicked", {
      ...getContextSummary(),
      ...getCurrentFormSummary(),
    });
    setStep(1);
    setResolvedData(null);
  };

  const handleClearSong = () => {
    captureIntentEvent("clip_create_dialog_selected_song_cleared", {
      ...getContextSummary(),
      previous_song_id: selectedSong?.songId ?? null,
      previous_song_channel_id: selectedSong?.channelId ?? null,
    });
    clipForm.setValue("selectedSong", null);
  };

  // 태그 채널 추가
  const handleAddTaggedChannel = (item: TaggedChannelItem) => {
    const eventProperties = {
      ...getContextSummary(),
      tagged_channel_id: item.channelId,
      tagged_song_id: item.songId,
    };
    captureIntentEvent("clip_create_dialog_tagged_channel_add_submitted", eventProperties);
    // 중복 체크
    if (taggedChannels.some((tc) => tc.channelId === item.channelId)) {
      captureIntentEvent("clip_create_dialog_tagged_channel_add_blocked_duplicate", eventProperties);
      toast.error("이미 태그된 채널입니다");
      return;
    }
    setTaggedChannels((prev) => [...prev, item]);
    captureIntentEvent("clip_create_dialog_tagged_channel_add_succeeded", {
      ...eventProperties,
      next_tagged_channel_count: taggedChannels.length + 1,
      next_tagged_channel_count_bucket: countBucket(taggedChannels.length + 1),
    });
  };

  // 태그 채널 제거
  const handleRemoveTaggedChannel = (targetChannelId: number) => {
    captureIntentEvent("clip_create_dialog_tagged_channel_remove_clicked", {
      ...getContextSummary(),
      removed_channel_id: targetChannelId,
    });
    setTaggedChannels((prev) => prev.filter((tc) => tc.channelId !== targetChannelId));
    captureIntentEvent("clip_create_dialog_tagged_channel_remove_succeeded", {
      ...getContextSummary(),
      removed_channel_id: targetChannelId,
      next_tagged_channel_count: Math.max(0, taggedChannels.length - 1),
      next_tagged_channel_count_bucket: countBucket(Math.max(0, taggedChannels.length - 1)),
    });
  };

  // 이미 선택된 채널 ID 목록 (메인 채널 + 태그된 채널들)
  const excludeChannelIds = useMemo(() => {
    const ids = taggedChannels.map((tc) => tc.channelId);
    if (channelId) {
      ids.push(channelId);
    }
    return ids;
  }, [taggedChannels, channelId]);

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      captureIntentEvent("clip_create_dialog_closed", {
        ...getContextSummary(),
        ...getCurrentFormSummary(),
      });
    }
    onOpenChange(nextOpen);
  };

  const handleIdentityWallClose = () => {
    captureIntentEvent("clip_create_dialog_identity_wall_close_clicked", {
      ...getContextSummary(),
    });
    onOpenChange(false);
  };

  const handleCancelClick = () => {
    captureIntentEvent("clip_create_dialog_cancel_clicked", {
      ...getContextSummary(),
      ...getCurrentFormSummary(),
    });
    onOpenChange(false);
  };

  const handleUrlInputFocus = () => {
    if (urlInputFocusedRef.current) return;
    urlInputFocusedRef.current = true;
    captureIntentEvent("clip_create_dialog_url_input_focused", {
      ...getContextSummary(),
    });
  };

  const handleUrlInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!urlInputStartedRef.current && event.target.value.trim().length > 0) {
      urlInputStartedRef.current = true;
      captureIntentEvent("clip_create_dialog_url_input_started", {
        ...getContextSummary(),
        url_length_bucket: textLengthBucket(event.target.value),
        url_source_guess: getClipCreateUrlSource(event.target.value),
      });
    }
    urlRegistration.onChange(event);
  };

  const handleTitleFocus = () => {
    if (titleFocusedRef.current) return;
    titleFocusedRef.current = true;
    captureIntentEvent("clip_create_dialog_title_focused", {
      ...getContextSummary(),
      ...getCurrentFormSummary(),
    });
  };

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!titleEditedRef.current && event.target.value.trim().length > 0) {
      titleEditedRef.current = true;
      captureIntentEvent("clip_create_dialog_title_started", {
        ...getContextSummary(),
        title_length_bucket: textLengthBucket(event.target.value),
      });
    }
    titleRegistration.onChange(event);
  };

  const handleDescriptionFocus = () => {
    if (descriptionFocusedRef.current) return;
    descriptionFocusedRef.current = true;
    captureIntentEvent("clip_create_dialog_description_focused", {
      ...getContextSummary(),
      ...getCurrentFormSummary(),
    });
  };

  const handleDescriptionChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!descriptionEditedRef.current && event.target.value.trim().length > 0) {
      descriptionEditedRef.current = true;
      captureIntentEvent("clip_create_dialog_description_started", {
        ...getContextSummary(),
        description_length_bucket: textLengthBucket(event.target.value),
      });
    }
    descriptionRegistration.onChange(event);
  };

  const handleThumbnailUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    thumbnailUrlRegistration.onChange(event);
    if (!thumbnailUrlEditedRef.current && event.target.value.trim().length > 0) {
      thumbnailUrlEditedRef.current = true;
      captureIntentEvent("clip_create_dialog_thumbnail_url_edited", {
        ...getContextSummary(),
        thumbnail_url_length_bucket: textLengthBucket(event.target.value),
        has_thumbnail_url_input: true,
      });
    }
  };

  const handleThumbnailUploadClick = () => {
    captureIntentEvent("clip_create_dialog_thumbnail_upload_clicked", {
      ...getContextSummary(),
    });
    thumbnailInputRef.current?.click();
  };

  const handleSelectedSongChange = (
    value: ClipCreateFormData["selectedSong"],
    onChange: (value: ClipCreateFormData["selectedSong"]) => void,
  ) => {
    captureIntentEvent("clip_create_dialog_song_selected", {
      ...getContextSummary(),
      selected_song_id: value?.songId ?? null,
      selected_song_channel_id: value?.channelId ?? null,
      selected_song_set: Boolean(value),
    });
    onChange(value);
  };

  const handlePublishToHotClipChange = (
    checked: boolean,
    onChange: (value: boolean) => void,
  ) => {
    captureIntentEvent("clip_create_dialog_publish_to_hotclip_toggled", {
      ...getContextSummary(),
      previous_publish_to_hot_clip: Boolean(publishToHotClip),
      next_publish_to_hot_clip: checked,
    });
    onChange(checked);
  };

  const handleTagDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      captureIntentEvent("clip_create_dialog_tag_dialog_opened", {
        ...getContextSummary(),
      });
    } else {
      captureIntentEvent("clip_create_dialog_tag_dialog_closed", {
        ...getContextSummary(),
      });
    }
    setTagDialogOpen(nextOpen);
  };

  const handlePlaylistDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      captureIntentEvent("clip_create_dialog_playlist_add_dialog_closed", {
        ...getContextSummary(),
        created_clip_id: createdClipId,
      });
      setCreatedClipId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        {/* 본인인증 필요 시 Wall 표시 */}
        {needsIdentityVerification ? (
          <IdentityVerificationWall onClose={handleIdentityWallClose} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {step === 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 -ml-2"
                    onClick={handleBack}
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                )}
                {hasPermission ? "클립 등록" : "클립 등록 요청"}
              </DialogTitle>
              <DialogDescription>
                {step === 1
                  ? "영상 URL을 입력하면 정보를 자동으로 불러옵니다"
                  : hasPermission
                  ? "영상 정보를 확인하고 수정할 수 있습니다"
                  : "영상 정보를 확인하세요. 채널 관리자 승인 후 등록됩니다."}
              </DialogDescription>
            </DialogHeader>

            {/* 요청 모드 안내 */}
            {!isLoadingPermission && !hasPermission && canRequestClip && (
              <Alert>
                <Send className="size-4" />
                <AlertDescription>
                  이 채널에 직접 클립을 등록할 권한이 없습니다.
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
              에 클립 추가
            </span>
          </div>
        )}

        {/* Step 1: URL 입력 */}
        {step === 1 && (
          <form onSubmit={urlForm.handleSubmit(handleResolve)} className="space-y-5 pt-2">
            <div className="space-y-2">
              <Label htmlFor="url">
                영상 URL <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="url"
                  {...urlRegistration}
                  onFocus={handleUrlInputFocus}
                  onChange={handleUrlInputChange}
                  placeholder="YouTube, SOOP, 치지직 URL을 입력하세요"
                  className="h-11 pl-10"
                  autoFocus
                />
              </div>
              {urlForm.formState.errors.url && (
                <p className="text-sm text-red-500">
                  {urlForm.formState.errors.url.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                지원 플랫폼: YouTube, 숲(SOOP), 치지직(CHZZK 클립만)
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelClick}
              >
                취소
              </Button>
              <Button type="submit" disabled={isResolving}>
                {isResolving ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    불러오는 중...
                  </>
                ) : (
                  "영상 정보 불러오기"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* Step 2: 클립 정보 입력 */}
        {step === 2 && (
          <form onSubmit={clipForm.handleSubmit(handleSubmit)} className="space-y-5 pt-2">
            {/* 썸네일 미리보기 */}
            {thumbnailUrl && (
              <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
                <img
                  src={thumbnailUrl}
                  alt="썸네일 미리보기"
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* 제목 */}
            <div className="space-y-2">
              <Label htmlFor="title">
                제목 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="title"
                {...titleRegistration}
                onFocus={handleTitleFocus}
                onChange={handleTitleChange}
                placeholder="클립 제목을 입력하세요"
                className="h-10"
              />
              {clipForm.formState.errors.title && (
                <p className="text-sm text-red-500">
                  {clipForm.formState.errors.title.message}
                </p>
              )}
            </div>

            {/* 플랫폼 (읽기 전용) */}
            <div className="space-y-2">
              <Label htmlFor="platform">플랫폼</Label>
              <Controller
                name="platform"
                control={clipForm.control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="플랫폼 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="YOUTUBE">YouTube</SelectItem>
                      <SelectItem value="SOOP">숲(SOOP)</SelectItem>
                      <SelectItem value="CHZZK">치지직</SelectItem>
                      <SelectItem value="MELOMING">Meloming Clip</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {/* 썸네일 URL */}
            <div className="space-y-2">
              <Label htmlFor="thumbnailUrl">썸네일 URL</Label>
              <div className="flex gap-2">
                <Input
                  id="thumbnailUrl"
                  {...thumbnailUrlRegistration}
                  onChange={handleThumbnailUrlChange}
                  placeholder="https://..."
                  className="h-10 flex-1"
                />
                <input
                  ref={thumbnailInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  onClick={handleThumbnailUploadClick}
                  disabled={isUploadingThumbnail}
                >
                  {isUploadingThumbnail ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                </Button>
              </div>
              {clipForm.formState.errors.thumbnailUrl && (
                <p className="text-sm text-red-500">
                  {clipForm.formState.errors.thumbnailUrl.message}
                </p>
              )}
            </div>

            {/* 설명 */}
            <div className="space-y-2">
              <Label htmlFor="description">설명</Label>
              <Textarea
                id="description"
                {...descriptionRegistration}
                onFocus={handleDescriptionFocus}
                onChange={handleDescriptionChange}
                placeholder="클립에 대한 설명을 입력하세요"
                rows={3}
                className="resize-none"
              />
              {clipForm.formState.errors.description && (
                <p className="text-sm text-red-500">
                  {clipForm.formState.errors.description.message}
                </p>
              )}
            </div>

            {/* 노래 선택 */}
            <div className="space-y-2">
              <Label>
                연결할 노래 <span className="text-red-500">*</span>
              </Label>

              {selectedSong ? (
                <div className="flex items-center gap-2 p-3 border rounded-md bg-muted/30">
                  <Music className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium truncate">
                      {selectedSong.songTitle}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {selectedSong.artistName}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={handleClearSong}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <Controller
                  name="selectedSong"
                  control={clipForm.control}
                  render={({ field }) => (
                    <SongSearchCombobox
                      channelIdentifier={channelIdentifier}
                      value={field.value}
                      onValueChange={(value) =>
                        handleSelectedSongChange(value, field.onChange)
                      }
                      clipTitle={resolvedData?.title}
                    />
                  )}
                />
              )}

              {clipForm.formState.errors.selectedSong && (
                <p className="text-sm text-red-500">노래를 선택해주세요</p>
              )}
            </div>

            {/* 함께 출연 채널 태그 (권한 있을 때만) */}
            {hasPermission && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>함께 출연 채널</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => handleTagDialogOpenChange(true)}
                  >
                    <UserPlus className="size-3.5" />
                    채널 태그
                  </Button>
                </div>

                {taggedChannels.length > 0 ? (
                  <TaggedChannelsList
                    channels={taggedChannels}
                    onRemove={handleRemoveTaggedChannel}
                    primaryChannelId={channelId}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground py-2">
                    콜라보/합방 등 함께 출연한 채널을 태그하면 해당 채널에도 클립이 표시됩니다.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="clip-publish-to-hotclip">핫클립에 게시</Label>
                <p className="text-xs text-muted-foreground">
                  끄면 채널 클립에만 등록되고 핫클립 목록에는 노출되지 않습니다.
                </p>
              </div>
              <Controller
                name="publishToHotClip"
                control={clipForm.control}
                render={({ field }) => (
                  <Switch
                    id="clip-publish-to-hotclip"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      handlePublishToHotClipChange(checked, field.onChange)
                    }
                  />
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelClick}
              >
                취소
              </Button>
              <Button
                type="submit"
                disabled={
                  clipForm.formState.isSubmitting ||
                  createClipMutation.isPending ||
                  createClipRequestMutation.isPending ||
                  isLoadingPermission
                }
              >
                {clipForm.formState.isSubmitting ||
                createClipMutation.isPending ||
                createClipRequestMutation.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    {hasPermission ? "등록 중..." : "요청 중..."}
                  </>
                ) : hasPermission ? (
                  "클립 등록"
                ) : (
                  <>
                    <Send className="size-4 mr-2" />
                    클립 등록 요청
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
          </>
        )}
      </DialogContent>

      {/* 채널 태그 다이얼로그 */}
      <ChannelTagDialog
        open={tagDialogOpen}
        onOpenChange={handleTagDialogOpenChange}
        onComplete={handleAddTaggedChannel}
        excludeChannelIds={excludeChannelIds}
        clipTitle={resolvedData?.title}
      />

      {/* 클립 생성 후 재생목록 추가 다이얼로그 */}
      {playlistEnabled && createdClipId !== null && (
        <AddToPlaylistDialog
          open={createdClipId !== null}
          onOpenChange={handlePlaylistDialogOpenChange}
          clipId={createdClipId}
        />
      )}
    </Dialog>
  );
}
