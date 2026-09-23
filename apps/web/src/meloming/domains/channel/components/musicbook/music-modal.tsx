"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import { Skeleton } from "@/meloming/shared/components/ui/skeleton";
import {
  songsKeys,
  useSongByChannelIdentifierSongId,
} from "@/meloming/domains/channel/hooks/use-songs";
import type {
  PatchSongsChannelIdentifierSongIdRequestBody,
  Song,
} from "@/meloming/domains/channel/types/song";
import { DefaultImage } from "./music-card";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import { useAtomValue } from "jotai";
import { themeColorAtom } from "@/meloming/domains/channel/atoms/channel-atom";
import { SongRatingBadges } from "./song-rating-badges";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  AlignLeftIcon,
  DiscIcon,
  Film,
  Loader2,
  MicVocalIcon,
  MusicIcon,
  Pencil,
  FileText,
  Play,
  ClipboardList,
  Radio,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChannelPermission } from "@/meloming/domains/channel/hooks/use-channel";
import {
  ClipCreateDialog,
  type InitialSong,
} from "@/meloming/domains/clip/components/clip-create-dialog";
import { PillTabs, type PillTabItem } from "@/meloming/shared/components/ui/pill-tabs";
import { useClipsBySong } from "@/meloming/domains/clip/hooks/use-clips";
import { ClipCardHorizontal } from "@/meloming/domains/clip/components/clip-card-horizontal";
import { LiveSongRequestButton } from "@/meloming/domains/channel/components/live-song-request-button";
import { SongRequestHistoryList } from "./song-request-history-list";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import { useSongRequestStats } from "@/meloming/domains/overlay/hooks/use-song-requests";
import type { PricingSettings } from "@/meloming/domains/channel/types/pricing";
import type { SongFormValues } from "@/meloming/domains/channel/components/management/song-form.schema";
import { getSongRequestPriceItems } from "@/meloming/domains/channel/utils/song-request-price-display";
import { SongRequestPricePills } from "./song-request-price-pills";
import { SheetMusicSection } from "@/meloming/domains/channel/components/sheet-music";
import { SongFormV2 } from "@/meloming/domains/channel/components/management/song-form-v2";
import {
  buildSongPatchBody,
  getSongFormInitialValues,
} from "@/meloming/domains/channel/components/management/song-form-utils";
import {
  deleteSongsChannelChannelIdSongId,
  getSongAffectedClips,
  patchSongsChannelChannelIdSongId,
} from "@/meloming/domains/channel/apis/songs";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type MusicModalTab = "info" | "clips" | "requests";
type MusicModalMode = "detail" | "edit";

interface MusicModalProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  user: string | undefined;
  song: Song;
  liveRequestState?: LiveSongRequestState;
  pricingSettings?: PricingSettings;
  initialMode?: MusicModalMode;
}

export default function MusicModal({
  open,
  setOpen,
  song,
  user,
  liveRequestState,
  pricingSettings,
  initialMode = "detail",
}: MusicModalProps) {
  const themeColor = useAtomValue(themeColorAtom);
  const [activeTab, setActiveTab] = useState<MusicModalTab>("info");
  const [editOpen, setEditOpen] = useState(false);
  const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);
  const [isLyricsTruncatable, setIsLyricsTruncatable] = useState(false);
  const [collapsedMaxHeight, setCollapsedMaxHeight] = useState<number | null>(
    null
  );
  const [fullHeight, setFullHeight] = useState<number | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const lyricsContentRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const { data: userPermission } = useChannelPermission(user || "", {
    enabled: Boolean(user),
  });
  const canViewLyrics = Boolean(
    userPermission?.isOwner ||
      userPermission?.manageContent ||
      userPermission?.manageSettings
  );
  const canManageContent = Boolean(
    userPermission?.isOwner || userPermission?.manageContent
  );

  // 클립 등록 다이얼로그 상태
  const [clipCreateOpen, setClipCreateOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [orphanClipCount, setOrphanClipCount] = useState<number | null>(null);
  const [isLoadingAffectedClips, setIsLoadingAffectedClips] = useState(false);

  const {
    data: detail,
    isLoading,
    error,
  } = useSongByChannelIdentifierSongId(user, song.id, {
    enabled: open || editOpen,
  });
  const priceTarget = detail ?? song;
  const requestPriceItems = useMemo(
    () =>
      getSongRequestPriceItems(
        {
          price: priceTarget.price ?? null,
          currencyPrices: priceTarget.currencyPrices ?? null,
          difficulty: priceTarget.difficulty ?? null,
          categories: priceTarget.categories ?? [],
        },
        pricingSettings
      ),
    [priceTarget, pricingSettings]
  );
  // 곡별 신청 통계
  const { data: requestStats } = useSongRequestStats(
    open ? song?.id : undefined,
    open ? song?.channelId : undefined
  );

  // 노래별 클립 목록 조회 (모달 열릴 때 조회하여 개수 표시)
  const { data: clipsData, isLoading: isClipsLoading } = useClipsBySong(
    user,
    song.id,
    { enabled: open }
  );

  // 클립 개수
  const clipCount = clipsData?.items?.length ?? 0;

  // 탭 정의 (클립 개수 badge 포함)
  const musicModalTabs: PillTabItem<MusicModalTab>[] = [
    { id: "info", label: "노래 정보", icon: FileText },
    { id: "clips", label: "노래클립", icon: Play, badge: clipCount },
    { id: "requests", label: "신청내역", icon: ClipboardList },
  ];

  // 클립 등록 시 전달할 노래 정보
  const initialSongForClip: InitialSong | null = detail
    ? {
        channelId: detail.channelId,
        songId: detail.id,
        songTitle: detail.title,
        artistName: detail.artist.name,
      }
    : null;
  const initialSongFormValues = useMemo(
    () => (detail ? getSongFormInitialValues(detail) : undefined),
    [detail]
  );

  const openEditDialog = () => {
    if (!detail || !user) return;
    setClipCreateOpen(false);
    setEditOpen(true);
    setOpen(false);
  };

  const openDeleteConfirm = async () => {
    if (!detail || !canManageContent) return;
    setClipCreateOpen(false);
    setOrphanClipCount(null);
    setDeleteConfirmOpen(true);
    setIsLoadingAffectedClips(true);
    try {
      const affected = await getSongAffectedClips(detail.channelId, detail.id);
      setOrphanClipCount(affected.orphanClipCount);
    } catch {
      setOrphanClipCount(null);
    } finally {
      setIsLoadingAffectedClips(false);
    }
  };

  const handleEditSubmit = async (values: SongFormValues) => {
    if (!detail || !initialSongFormValues) return;

    let patchBody: PatchSongsChannelIdentifierSongIdRequestBody;
    try {
      patchBody = buildSongPatchBody(initialSongFormValues, values);
    } catch {
      toast.error("노래 정보를 불러오는 중입니다.", {
        description: "잠시 후 다시 시도해주세요.",
      });
      return;
    }

    setIsSavingEdit(true);
    try {
      await patchSongsChannelChannelIdSongId(
        detail.channelId,
        detail.id,
        patchBody
      );
      await queryClient.invalidateQueries({
        queryKey: songsKeys.detail(user || "", detail.id),
      });
      if (user) {
        await queryClient.invalidateQueries({
          queryKey: songsKeys.publicUser(user),
        });
      }
      toast.success("노래를 수정했습니다.");
      setEditOpen(false);
    } catch {
      toast.error("노래 수정에 실패했습니다.", {
        description: "잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!detail || !user || !canManageContent) return;

    setIsDeleting(true);
    try {
      await deleteSongsChannelChannelIdSongId(detail.channelId, detail.id);
      setDeleteConfirmOpen(false);
      setClipCreateOpen(false);
      setEditOpen(false);
      setOpen(false);
      queryClient.removeQueries({
        queryKey: songsKeys.detail(user, detail.id),
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: songsKeys.publicUser(user),
        }),
        queryClient.invalidateQueries({
          queryKey: songsKeys.favoritesByChannelId(detail.channelId),
        }),
      ]);
      toast.success("노래가 삭제되었습니다.");
    } catch {
      toast.error("노래 삭제에 실패했습니다.", {
        description: "잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Reset state on open
  useEffect(() => {
    if (!open) return;
    const resetId = window.setTimeout(() => {
      setIsLyricsExpanded(false);
      setActiveTab("info");
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [open]);

  useEffect(() => {
    if (!open || initialMode !== "edit" || !detail || !user) return;
    setClipCreateOpen(false);
    setEditOpen(true);
    setOpen(false);
  }, [detail, initialMode, open, setOpen, user]);

  // Measure heights to enable smooth expand/collapse
  useEffect(() => {
    if (!open) return;
    const container = lyricsContainerRef.current;
    const content = lyricsContentRef.current;
    if (!container || !content) return;

    const recompute = () => {
      const computed = window.getComputedStyle(content);
      let lineHeight = parseFloat(computed.lineHeight);
      if (Number.isNaN(lineHeight)) {
        const fontSize = parseFloat(computed.fontSize);
        lineHeight = fontSize * 1.5; // fallback
      }
      const collapsed = Math.ceil(lineHeight * 4);
      const contentHeight = content.scrollHeight;
      setCollapsedMaxHeight(collapsed);

      // p-3 => 12px top + 12px bottom
      const PADDING_VERTICAL_PX = 24;
      const full = contentHeight + PADDING_VERTICAL_PX;
      setFullHeight(full);

      setIsLyricsTruncatable(contentHeight > collapsed + 2);
    };

    // Initial compute
    recompute();

    // Re-measure on content resize
    const ro = new ResizeObserver(() => recompute());
    ro.observe(content);
    return () => ro.disconnect();
  }, [open, detail?.lyricsText]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (isSavingEdit) return;
          setOpen(nextOpen);
          if (!nextOpen) {
            setClipCreateOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <>
            <DialogHeader>
              <DialogTitle></DialogTitle>
            </DialogHeader>

            {isLoading ? (
              <div className="space-y-4">
                {/* 헤더 스켈레톤 */}
                <div className="flex gap-5 items-center">
                  <Skeleton className="w-24 h-24 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-7 w-3/4" />
                    <Skeleton className="h-5 w-1/3" />
                  </div>
                </div>

                {/* 탭 스켈레톤 */}
                <div className="flex gap-2 mt-4">
                  <Skeleton className="h-9 w-24 rounded-full" />
                  <Skeleton className="h-9 w-24 rounded-full" />
                  <Skeleton className="h-9 w-24 rounded-full" />
                </div>

                {/* 콘텐츠 스켈레톤 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <Skeleton className="col-span-2 h-20 rounded-lg" />
                  <Skeleton className="h-20 rounded-lg" />
                  <Skeleton className="h-20 rounded-lg" />
                </div>
              </div>
            ) : error ? (
              <div className="text-red-500 text-sm">
                곡 정보를 불러오지 못했습니다.
              </div>
            ) : detail ? (
              <>
                {/* Live Request CTA Banner */}
                {liveRequestState?.showRequestUI && (
                  <div className="relative -mx-6 -mt-2 mb-4 px-6 py-4 bg-gradient-to-r from-fuchsia-600 via-pink-600 to-violet-600 text-white overflow-hidden">
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />

                    <div className="relative flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <span className="absolute inset-0 bg-white/20 rounded-full animate-ping" />
                          <div className="relative size-10 bg-white/20 rounded-full flex items-center justify-center">
                            <Radio className="size-5" />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold">지금 신청 가능!</span>
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full text-xs font-semibold">
                              <Sparkles className="size-3" />
                              LIVE
                            </span>
                          </div>
                          <p className="text-sm text-white/80">
                            {liveRequestState.isQueueFull
                              ? "대기열이 가득 찼어요"
                              : "이 노래를 바로 신청해보세요"}
                          </p>
                        </div>
                      </div>

                      <LiveSongRequestButton
                        song={song}
                        requestState={liveRequestState}
                        size="lg"
                        variant="secondary"
                        className="bg-white text-fuchsia-600 hover:bg-white/90 font-bold shadow-lg shadow-black/20 px-6"
                        onRequested={() => setOpen(false)}
                      />
                    </div>
                  </div>
                )}

            {/* 헤더: 앨범아트 + 곡 기본정보 */}
            <div className="flex gap-5 items-center">
              <div className="w-24 h-24 shrink-0 relative">
                {detail.albumArt ? (
                  <img
                    src={detail.albumArt}
                    alt={detail.title}
                    className="w-full h-full object-cover rounded-lg shadow-md"
                  />
                ) : (
                  <DefaultImage themeColor={themeColor} />
                )}
                {/* Live badge on album art */}
                {liveRequestState?.showRequestUI && (
                  <div className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-gradient-to-r from-fuchsia-500 to-pink-500 rounded text-[10px] font-bold text-white shadow-md">
                    LIVE
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-2xl font-bold leading-tight line-clamp-2">
                  {detail.title}
                </h2>
                <p className="text-base text-muted-foreground font-medium mt-1">
                  {detail.artist.name}
                </p>
              </div>
            </div>

            {/* Pill Tabs */}
            <PillTabs
              tabs={musicModalTabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              className="mt-4"
            />

            {/* 탭 콘텐츠 */}
            <div className="mt-4 min-h-[200px]">
              {/* 노래 정보 탭 */}
              {activeTab === "info" && (
                <div className="space-y-5">
                  {/* 메타 정보 그리드 */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* 카테고리 */}
                    <div className="col-span-2 rounded-lg bg-muted/50 p-3">
                      <span className="text-muted-foreground text-xs font-medium block mb-2">
                        카테고리
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.categories.length > 0 ? (
                          detail.categories.map((c) => (
                            <Badge
                              key={c.id}
                              className="text-xs"
                              style={{
                                backgroundColor: c.color,
                                color: getContrastingTextColor(c.color),
                              }}
                            >
                              {c.name}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </div>
                    </div>

                    {/* 별점 */}
                    <div className="rounded-lg bg-muted/50 p-3">
                      <span className="text-muted-foreground text-xs font-medium block mb-2">
                        별점
                      </span>
                      <SongRatingBadges
                        difficulty={detail.difficulty}
                        proficiency={detail.proficiency}
                        size={16}
                      />
                    </div>

                    {/* 참고 가격 */}
                    {requestPriceItems.length > 0 && (
                      <div className="rounded-lg bg-muted/50 p-3">
                        <span className="text-muted-foreground text-xs font-medium block mb-1">
                          참고 가격
                        </span>
                        <SongRequestPricePills items={requestPriceItems} />
                      </div>
                    )}

                    {/* 키 & BPM */}
                    <div className="rounded-lg bg-muted/50 p-3">
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <span className="text-muted-foreground text-xs font-medium block mb-1">
                            키
                          </span>
                          <span className="text-sm font-medium">
                            {detail.songKey || "-"}
                          </span>
                        </div>
                        <div className="flex-1">
                          <span className="text-muted-foreground text-xs font-medium block mb-1">
                            BPM
                          </span>
                          <span className="text-sm font-medium">
                            {detail.bpm || "-"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 신청 통계 */}
                  {requestStats && requestStats.totalRequestCount > 0 && (
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Radio className="size-3.5" />
                        <span>총 {requestStats.totalRequestCount}회 신청</span>
                      </div>
                      {requestStats.lastRequestedAt && (
                        <span className="text-xs">
                          마지막 {new Date(requestStats.lastRequestedAt).toLocaleDateString('ko-KR')}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 설명 */}
                  {detail.description && (
                    <div>
                      <span className="text-muted-foreground text-xs font-medium block mb-2">
                        설명
                      </span>
                      <div className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3">
                        {detail.description}
                      </div>
                    </div>
                  )}

                  {/* 관련 링크 */}
                  {(detail.lyricsLink ||
                    detail.karaokeUrl ||
                    detail.coverUrl ||
                    detail.originalUrl) && (
                    <div>
                      <span className="text-muted-foreground text-xs font-medium block mb-2">
                        관련 링크
                      </span>
                      <div className="flex flex-row gap-2 flex-wrap">
                        {detail.lyricsLink && (
                          <a
                            href={detail.lyricsLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Button variant="indigo-outline" size="sm">
                              <AlignLeftIcon className="size-4" />
                              가사
                            </Button>
                          </a>
                        )}

                        {detail.karaokeUrl && (
                          <a
                            href={detail.karaokeUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Button variant="indigo-outline" size="sm">
                              <MicVocalIcon className="size-4" />
                              노래방
                            </Button>
                          </a>
                        )}

                        {detail.coverUrl && (
                          <a
                            href={detail.coverUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Button variant="indigo-outline" size="sm">
                              <DiscIcon className="size-4" />
                              커버곡
                            </Button>
                          </a>
                        )}

                        {detail.originalUrl && (
                          <a
                            href={detail.originalUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Button variant="indigo-outline" size="sm">
                              <MusicIcon className="size-4" />
                              원곡
                            </Button>
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 메모 */}
                  {detail.lyricsText && canViewLyrics && (
                    <div>
                      <span className="text-muted-foreground text-xs font-medium block mb-2">
                        메모
                      </span>

                      <div
                        ref={lyricsContainerRef}
                        role="button"
                        aria-expanded={isLyricsExpanded}
                        onClick={() => {
                          if (!isLyricsExpanded && isLyricsTruncatable) {
                            setIsLyricsExpanded(true);
                          }
                        }}
                        className="relative text-sm text-left rounded-lg p-3 w-full bg-muted/50"
                        style={{
                          overflow: "hidden",
                          whiteSpace: "pre-wrap",
                          transition: "max-height 320ms ease",
                          maxHeight: isLyricsExpanded
                            ? fullHeight
                              ? `${fullHeight}px`
                              : undefined
                            : collapsedMaxHeight
                            ? `${collapsedMaxHeight}px`
                            : undefined,
                          cursor:
                            !isLyricsExpanded && isLyricsTruncatable
                              ? "pointer"
                              : "default",
                        }}
                      >
                        <div ref={lyricsContentRef}>{detail.lyricsText}</div>

                        {!isLyricsExpanded && isLyricsTruncatable && (
                          <>
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-muted/50 rounded-b-lg" />
                            <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs font-medium text-muted-foreground">
                              더보기
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {detail.lyricsText && !canViewLyrics && (
                    <div>
                      <span className="text-muted-foreground text-xs font-medium block mb-2">
                        메모
                      </span>
                      <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                        메모는 채널 소유자 또는 매니저만 볼 수 있어요.
                      </div>
                    </div>
                  )}

                  {/* 악보 열람 (매니저 전용 + feature flag 게이팅은 컴포넌트 내부에서 처리).
                      상세 모달은 viewer-only 이고, 업로드/삭제는 SongFormV2 수정 모달에서만 한다. */}
                  {user && (
                    <SheetMusicSection
                      channelIdentifier={user}
                      songId={detail.id}
                      initialSlots={detail.sheetMusics ?? null}
                      initialUrl={detail.sheetMusicUrl ?? null}
                      initialType={detail.sheetMusicType ?? null}
                      canManage={canManageContent}
                      readOnly
                      songTitle={detail.title}
                    />
                  )}
                </div>
              )}

              {/* 클립 탭 */}
              {activeTab === "clips" && (
                <div className="space-y-2">
                  {isClipsLoading ? (
                    <div className="space-y-2">
                      {[...Array(3)].map((_, i) => (
                        <Skeleton key={i} className="h-24 w-full rounded-md" />
                      ))}
                    </div>
                  ) : clipsData?.items && clipsData.items.length > 0 ? (
                    clipsData.items.map((clip) => (
                      <ClipCardHorizontal key={clip.id} clip={clip} />
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Play className="size-10 mb-2 opacity-50" />
                      <p className="text-sm">등록된 클립이 없습니다</p>
                    </div>
                  )}
                </div>
              )}

              {/* 신청내역 탭 */}
              {activeTab === "requests" && (
                <SongRequestHistoryList
                  songId={song?.id}
                  channelId={song?.channelId}
                  enabled={open && activeTab === "requests"}
                />
              )}
            </div>

            <DialogFooter className="gap-2">
              {canManageContent && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setClipCreateOpen(true)}
                  >
                    <Film className="mr-1 h-4 w-4" /> 클립 등록
                  </Button>
                  <Button
                    variant="default"
                    onClick={openEditDialog}
                  >
                    <Pencil className="mr-1 h-4 w-4" /> 수정
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={openDeleteConfirm}
                    disabled={isDeleting}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> 삭제
                  </Button>
                </>
              )}
            </DialogFooter>

            {/* 클립 등록 다이얼로그 */}
            {user && (
              <ClipCreateDialog
                open={clipCreateOpen}
                onOpenChange={setClipCreateOpen}
                channelIdentifier={user}
                channelId={song.channelId}
                initialSong={initialSongForClip}
              />
            )}
          </>
            ) : null}
          </>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(nextOpen) => {
          if (isSavingEdit) return;
          setEditOpen(nextOpen);
        }}
      >
        <DialogContent className="min-w-full lg:min-w-5xl xl:min-w-7xl max-w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="paperlogy">노래 수정</DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <div className="py-6 text-sm text-muted-foreground">
              상세 정보를 불러오는 중입니다...
            </div>
          ) : error ? (
            <div className="py-6 text-sm text-red-500">
              곡 정보를 불러오지 못했습니다.
            </div>
          ) : detail && user ? (
            <SongFormV2
              key={`musicbook-edit-${detail.id}`}
              identifier={user}
              channelId={detail.channelId}
              initialValues={initialSongFormValues}
              editingSongId={detail.id}
              submitLabel={isSavingEdit ? "저장 중..." : "수정 저장"}
              onSubmit={handleEditSubmit}
            />
          ) : (
            <div className="py-6 text-sm text-muted-foreground">
              수정할 노래 정보를 찾을 수 없습니다.
            </div>
          )}
          {isSavingEdit && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(nextOpen) => {
          if (isDeleting) return;
          setDeleteConfirmOpen(nextOpen);
          if (!nextOpen) {
            setOrphanClipCount(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="paperlogy">노래 삭제</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  &ldquo;{detail?.title ?? song.title}&rdquo;를 삭제하시겠습니까? 이
                  작업은 되돌릴 수 없습니다.
                </p>
                {isLoadingAffectedClips && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    연결된 클립 영향을 확인하는 중입니다...
                  </p>
                )}
                {orphanClipCount != null && orphanClipCount > 0 && (
                  <p className="mt-2 text-amber-600 font-medium">
                    이 노래에만 연결된 클립 {orphanClipCount}개도 함께 삭제됩니다.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                handleDeleteConfirm();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  삭제 중...
                </>
              ) : (
                "삭제"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
