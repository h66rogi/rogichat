import type { Song } from "@/meloming/domains/channel/types/song";
type SortBy = "newest" | "oldest" | "title" | "artist" | "likes_desc";
import SortCombobox from "@/meloming/shared/components/search-form/sort-combobox";
import {
  AlertTriangle,
  RefreshCw,
  Loader2,
  PlusIcon,
  Grid3X3,
  List,
  Table as TableIcon,
  ShuffleIcon,
  HeartIcon,
  Radio,
  Sparkles,
  Maximize2,
  Minimize2,
  Crown,
} from "lucide-react";
import { isAxiosError } from "@/meloming/shared/lib/axios-error";
import { Button } from "@/meloming/shared/components/ui/button";
import { Alert, AlertDescription } from "@/meloming/shared/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/meloming/shared/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import Link from "next/link";
import LoginRequiredDialog from "@/meloming/shared/components/common/login-required-dialog";
import MusicCard from "@/meloming/domains/channel/components/musicbook/music-card";
import MusicCardList from "@/meloming/domains/channel/components/musicbook/music-card-list";
import MusicSheet from "@/meloming/domains/channel/components/musicbook/music-sheet";
import type { SongPrimaryRatingField } from "@/meloming/domains/channel/components/musicbook/song-rating-badges";
import { SectionErrorBoundary } from "../../../../shared/components/common/error-boundary";
import { useIntersectionObserver } from "@/meloming/shared/hooks/use-intersection-observer";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import clsx from "clsx";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import {
  SkeletonMusicCardGrid,
  SkeletonMusicCardListGrid,
} from "@/meloming/shared/components/skeleton";
import { useChannel, useChannelPermission } from "@/meloming/domains/channel/hooks/use-channel";
import { SongAddDialog } from "@/meloming/domains/channel/components/song-add-dialog";
import RandomSongsDialog from "@/meloming/domains/channel/components/section/random-songs-dialog";
import { RandomSongRequestButton } from "@/meloming/domains/channel/components/random-song-request-button";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { SongAddRequestDialog } from "@/meloming/domains/channel/components/song-add-request-dialog";
import { useChannelSongPermission } from "@/meloming/domains/channel/hooks/use-song-requests";
import {
  usePublicActiveSession,
  publicSessionKeys,
} from "@/meloming/domains/overlay/hooks/use-public-session";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import { LiveSongRequestFloating } from "@/meloming/domains/channel/components/live-song-request-floating";
import { useSongLiveSocket } from "@/meloming/domains/overlay/hooks/use-song-live-socket";
import {
  songRequestKeys,
  useSongRequestOperatorStatus,
} from "@/meloming/domains/overlay/hooks/use-song-requests";
import { useQueryClient } from "@tanstack/react-query";
import { usePricingSettings } from "@/meloming/domains/channel/hooks/use-pricing-settings";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import { countBucket } from "@/meloming/domains/channel/components/management/songbook-analytics";

/**
 * 무한스크롤 노래 목록 섹션 컴포넌트
 */
export type ViewMode = "grid" | "list" | "sheet";

export default function SongListSection({
  userId,
  songs,
  totalCount,
  isLoading,
  error,
  refetch,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  sortBy,
  onSortChange,
  isUserLoading = false, // 유저 정보 로딩 상태
  openSongId,
  editSongId,
  isFavoriteMode = false,
  onFavoriteModeChange,
  isWide = false,
  onToggleLayout,
  viewMode,
  onViewModeChange,
  primaryRatingField = "difficulty",
}: {
  userId: string;
  songs: Song[];
  totalCount: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  sortBy: SortBy;
  onSortChange: (sortBy: SortBy) => void;
  isUserLoading?: boolean; // 유저 정보 로딩 상태
  openSongId?: number;
  editSongId?: number;
  isFavoriteMode?: boolean;
  onFavoriteModeChange?: (isFavoriteMode: boolean) => void;
  isWide?: boolean;
  onToggleLayout?: () => void;
  viewMode: ViewMode;
  onViewModeChange: (next: ViewMode) => void;
  primaryRatingField?: SongPrimaryRatingField;
}) {
  const isMobile = useIsMobile();
  const [consumedOpenSongId, setConsumedOpenSongId] = useState<
    number | undefined
  >(undefined);

  const { data: userPermission } = useChannelPermission(userId);
  const { data: channel } = useChannel(userId);
  const { data: pricingSettings } = usePricingSettings(channel?.id);
  const { user, isAuthenticated } = useAuth();

  // 노래 추가 요청 권한 및 다이얼로그 상태
  const { data: songPermission } = useChannelSongPermission(channel?.id);
  const canRequestSong = songPermission?.canRequestSong ?? false;
  const [songRequestDialogOpen, setSongRequestDialogOpen] = useState(false);
  const songAddRequestCtaViewedRef = useRef<Set<string>>(new Set());

  // 와이드 보기 PRO CTA 상태
  const isOwnerPro = channel?.isOwnerProSubscriber ?? false;
  const [wideProInfoOpen, setWideProInfoOpen] = useState(false);
  const [wideLoginDialogOpen, setWideLoginDialogOpen] = useState(false);

  const handleWideToggleClick = useCallback(() => {
    if (isOwnerPro) {
      onToggleLayout?.();
      return;
    }
    if (!isAuthenticated) {
      setWideLoginDialogOpen(true);
      return;
    }
    // 로그인 상태: 먼저 PRO 전용 안내 모달 표시
    setWideProInfoOpen(true);
  }, [isOwnerPro, isAuthenticated, onToggleLayout]);

  const { data: publicSession, isLoading: isPublicSessionLoading } =
    usePublicActiveSession(userId, {
      enabled: Boolean(userId),
      refetchInterval: 30_000,
    });

  // 신청곡 운영자 권한 (소유자/활성 매니저/사이트 관리자) — 모든 신청 제한 우회
  const { data: operatorStatus } = useSongRequestOperatorStatus(
    channel?.id ?? null,
    user?.id ?? null,
  );
  const viewerIsOperator = operatorStatus?.isOperator ?? false;
  const canManageSongs = Boolean(
    userPermission?.isOwner || userPermission?.manageContent
  );

  const queryClient = useQueryClient();

  const invalidatePublicSession = useCallback(() => {
    if (!userId) return;
    queryClient.invalidateQueries({ queryKey: publicSessionKeys.active(userId) });
  }, [queryClient, userId]);

  const invalidateQueue = useCallback(
    (sessionId?: number) => {
      const targetSessionId = sessionId ?? publicSession?.sessionId ?? null;
      if (!targetSessionId) return;
      queryClient.invalidateQueries({
        queryKey: songRequestKeys.queue(targetSessionId),
      });
      queryClient.invalidateQueries({
        queryKey: songRequestKeys.requestedSongIds(targetSessionId),
      });
    },
    [queryClient, publicSession?.sessionId],
  );

  useSongLiveSocket(userId, {
    enabled: Boolean(userId),
    onRequestAdded: (payload) => {
      invalidateQueue(payload?.sessionId);
      invalidatePublicSession();
    },
    onRequestUpdated: (payload) => {
      invalidateQueue(payload?.sessionId);
      invalidatePublicSession();
    },
    onRequestRemoved: (payload) => {
      invalidateQueue(payload?.sessionId);
      invalidatePublicSession();
    },
    onQueueReordered: (payload) => {
      invalidateQueue(payload?.sessionId);
      invalidatePublicSession();
    },
    onSettingsUpdated: () => {
      invalidatePublicSession();
    },
    onSessionStarted: (payload) => {
      invalidatePublicSession();
      invalidateQueue(payload?.sessionId);
    },
    onSessionEnded: () => {
      invalidatePublicSession();
    },
  });

  const liveRequestState = useMemo<LiveSongRequestState>(() => {
    const settings = publicSession?.settings;
    const isLive = Boolean(publicSession?.isLive);
    const requestEnabled = Boolean(settings?.requestEnabled);
    const paused = Boolean(settings?.paused);
    const maxQueueSize = settings?.maxQueueSize ?? 0;
    const queueCount = publicSession?.queueCount ?? 0;
    const isQueueFull = maxQueueSize > 0 && queueCount >= maxQueueSize;
    const showRequestUI = isLive && requestEnabled;
    // 운영자는 paused/queueFull 등 일반 사용자에게 적용되는 신청 차단을 우회.
    // 단, 라이브가 아니거나 신청곡 자체가 비활성화된 상태(showRequestUI=false)는 큐 생성 불가이므로 우회 대상이 아니다.
    const canRequest = viewerIsOperator
      ? showRequestUI
      : showRequestUI && !paused && !isQueueFull;
    return {
      isLive,
      sessionId: publicSession?.sessionId ?? null,
      requestEnabled,
      paused,
      maxQueueSize,
      queueCount,
      isQueueFull,
      canRequest,
      showRequestUI,
      loading: isPublicSessionLoading,
      preventDuplicateSongs: Boolean(settings?.preventDuplicateSongs),
      blockedCategoryIds: settings?.blockedCategoryIds ?? [],
      allowAnonymous: Boolean(settings?.allowAnonymous),
      randomRequestEnabled: settings?.randomRequestEnabled ?? true,
      viewerIsOperator,
    };
  }, [publicSession, isPublicSessionLoading, viewerIsOperator]);

  // 노래 추가 다이얼로그 상태 (채널 관리자용)
  const [songAddDialogOpen, setSongAddDialogOpen] = useState(false);

  // 시트(엑셀) 뷰는 채널 노래책 "전체"를 대상으로 정렬·필터해야 한다. 일부
  // 페이지만 로드된 상태에서 클라이언트 정렬/필터를 하면 결과가 틀리므로,
  // sheet 진입 시 남은 페이지를 모두 끌어온다. grid/list 는 기존처럼 스크롤
  // lazy 로딩 유지(부모가 sheet 일 때 limit 을 키워 요청 수를 줄인다).
  useEffect(() => {
    if (
      viewMode === "sheet" &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isLoading
    ) {
      fetchNextPage();
    }
  }, [viewMode, hasNextPage, isFetchingNextPage, isLoading, fetchNextPage]);

  // 중복 요청 방지를 위한 ref
  const isLoadingRef = useRef(false);

  // 무한스크롤을 위한 Intersection Observer
  const { elementRef, isIntersecting } = useIntersectionObserver({
    threshold: 0.1,
    rootMargin: "50px", // 100px에서 50px로 줄임
    enabled: hasNextPage && !isFetchingNextPage && !isLoading,
  });

  // 스크롤 감지 시 다음 페이지 로드 (디바운싱 포함)
  useEffect(() => {
    if (
      isIntersecting &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isLoading &&
      !isLoadingRef.current
    ) {
      isLoadingRef.current = true;

      // 약간의 지연을 두어 연속 호출 방지
      const timeoutId = setTimeout(() => {
        fetchNextPage();

        // 로딩 완료 후 플래그 리셋 (1초 후)
        setTimeout(() => {
          isLoadingRef.current = false;
        }, 1000);
      }, 100);

      return () => {
        clearTimeout(timeoutId);
        isLoadingRef.current = false;
      };
    }
  }, [
    isIntersecting,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    fetchNextPage,
  ]);

  // isFetchingNextPage가 false가 되면 플래그 리셋
  useEffect(() => {
    if (!isFetchingNextPage) {
      isLoadingRef.current = false;
    }
  }, [isFetchingNextPage]);

  // 로딩 상태 통합 (유저 정보 로딩 또는 노래 로딩)
  const isAnyLoading = isUserLoading || isLoading;

  // 중복 곡 제거 (React key 충돌 방지)
  const uniqueSongs = useMemo(() => {
    const seen = new Set<number>();
    const list: Song[] = [];
    for (const s of songs) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        list.push(s);
      }
    }
    return list;
  }, [songs]);

  const getSongAddRequestCtaProperties = useCallback(
    (placement: "toolbar" | "empty_state") => ({
      placement,
      channel_id: channel?.id ?? null,
      channel_identifier_present: Boolean(userId),
      viewer_authenticated: isAuthenticated,
      can_manage_songs: canManageSongs,
      can_request_song: canRequestSong,
      song_permission_loaded: Boolean(songPermission),
      view_mode: viewMode,
      sort_by: sortBy,
      is_favorite_mode: isFavoriteMode,
      is_mobile: isMobile,
      is_wide: isWide,
      loaded_song_count: uniqueSongs.length,
      loaded_song_count_bucket: countBucket(uniqueSongs.length),
      total_song_count: totalCount,
      total_song_count_bucket: countBucket(totalCount),
      live_request_visible: liveRequestState.showRequestUI,
      live_request_enabled: liveRequestState.requestEnabled,
      live_request_can_request: liveRequestState.canRequest,
      live_request_paused: liveRequestState.paused,
      live_request_queue_full: liveRequestState.isQueueFull,
    }),
    [
      canManageSongs,
      canRequestSong,
      channel?.id,
      isAuthenticated,
      isFavoriteMode,
      isMobile,
      isWide,
      liveRequestState.canRequest,
      liveRequestState.isQueueFull,
      liveRequestState.paused,
      liveRequestState.requestEnabled,
      liveRequestState.showRequestUI,
      songPermission,
      sortBy,
      totalCount,
      uniqueSongs.length,
      userId,
      viewMode,
    ]
  );

  const captureSongAddRequestCtaViewed = useCallback(
    (placement: "toolbar" | "empty_state") => {
      const signature = `${channel?.id ?? userId}:${placement}`;
      if (songAddRequestCtaViewedRef.current.has(signature)) return;
      songAddRequestCtaViewedRef.current.add(signature);
      captureIntentEvent("channel_songbook_add_request_cta_viewed", {
        ...getSongAddRequestCtaProperties(placement),
      });
    },
    [channel?.id, getSongAddRequestCtaProperties, userId]
  );

  const handleSongAddRequestCtaClick = useCallback(
    (placement: "toolbar" | "empty_state") => {
      captureIntentEvent("channel_songbook_add_request_cta_clicked", {
        ...getSongAddRequestCtaProperties(placement),
      });
      setSongRequestDialogOpen(true);
      captureIntentEvent("channel_songbook_add_request_dialog_opened", {
        ...getSongAddRequestCtaProperties(placement),
      });
    },
    [getSongAddRequestCtaProperties]
  );

  useEffect(() => {
    if (!isAuthenticated || !canRequestSong || canManageSongs) return;

    captureSongAddRequestCtaViewed("toolbar");

    if (!isAnyLoading && !error && uniqueSongs.length === 0 && !isFavoriteMode) {
      captureSongAddRequestCtaViewed("empty_state");
    }
  }, [
    canManageSongs,
    canRequestSong,
    captureSongAddRequestCtaViewed,
    error,
    isAnyLoading,
    isAuthenticated,
    isFavoriteMode,
    uniqueSongs.length,
  ]);

  // 랜덤 추천 데이터는 분리된 Dialog 컴포넌트에서 관리합니다
  const [randomOpen, setRandomOpen] = useState(false);

  return (
    <section
      id="channel-songs"
      className={clsx(
        "w-full bg-sidebar min-h-140 shadow-sm p-4 channel-box relative",
        isMobile ? "p-2" : "p-4 rounded-lg",
        liveRequestState.showRequestUI && "ring-2 ring-fuchsia-500/30 dark:ring-fuchsia-400/20"
      )}
    >
      {/* Live Request Mode Banner */}
      {liveRequestState.showRequestUI && (
        <div className={clsx(
          "mb-4 px-4 py-3 bg-gradient-to-r from-fuchsia-600 via-pink-600 to-violet-600 text-white relative overflow-hidden",
          isMobile ? "-mx-2 -mt-2" : "-mx-4 -mt-4 rounded-t-lg"
        )}>
          <div className="absolute inset-0 bg-white/5" />

          <div className="relative flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="size-8 bg-white/20 rounded-full flex items-center justify-center">
                <Radio className="size-4" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm sm:text-base">
                    {liveRequestState.paused ? "신청곡 일시정지" : "신청곡 받는 중"}
                  </span>
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-white/20 rounded-full text-xs font-medium">
                    <Sparkles className="size-3" />
                    LIVE
                  </span>
                </div>
                <p className="text-xs text-white/80 mt-0.5">
                  {liveRequestState.paused
                    ? "스트리머가 신청곡을 잠시 멈췄습니다."
                    : "원하는 노래를 신청해보세요!"}
                  {liveRequestState.maxQueueSize > 0 && (
                    <span className="ml-2">
                      ({liveRequestState.queueCount}/{liveRequestState.maxQueueSize}곡)
                    </span>
                  )}
                </p>
              </div>
            </div>

            {liveRequestState.isQueueFull && (
              <div className="px-3 py-1.5 bg-white/20 rounded-full text-xs font-medium">
                대기열이 가득 찼어요
              </div>
            )}
          </div>
        </div>
      )}

      <div
        id="channel-songs-header"
        className="flex flex-row justify-between items-center flex-wrap"
      >
        <div className="text-sm text-gray-500">
          {isAnyLoading && songs.length === 0
            ? "로딩 중..."
            : totalCount === 0
            ? isFavoriteMode
              ? "좋아요한 노래가 없습니다"
              : "검색 결과가 없습니다"
            : isFavoriteMode
            ? `좋아요 ${totalCount}곡 중 ${songs.length}곡`
            : `총 ${totalCount}곡 중 ${songs.length}곡`}
        </div>

        <div className="flex flex-row gap-2 items-center">
          {isAuthenticated && (
            <Button
              variant={isFavoriteMode ? "default" : "outline"}
              onClick={() => onFavoriteModeChange?.(!isFavoriteMode)}
            >
              <HeartIcon
                size={14}
                fill={isFavoriteMode ? "currentColor" : "none"}
              />
              {!isMobile && (isFavoriteMode ? "전체 보기" : "좋아요만 보기")}
            </Button>
          )}

          <Button variant="outline" onClick={() => setRandomOpen(true)}>
            <ShuffleIcon size={14} />
            {!isMobile && "랜덤"}
          </Button>

          {liveRequestState.showRequestUI && liveRequestState.randomRequestEnabled && (
            <RandomSongRequestButton
              requestState={liveRequestState}
              size="default"
              variant="default"
              iconOnly={isMobile}
            />
          )}

          <div>
            {/* Grid/List/Sheet 전환 탭 */}
            <Tabs
              value={viewMode}
              onValueChange={(value) => onViewModeChange(value as ViewMode)}
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger
                  value="grid"
                  className="gap-1 cursor-pointer"
                  title="그리드"
                >
                  <Grid3X3 size={14} />
                </TabsTrigger>
                <TabsTrigger
                  value="list"
                  className="gap-1 cursor-pointer"
                  title="리스트"
                >
                  <List size={14} />
                </TabsTrigger>
                <TabsTrigger
                  value="sheet"
                  className="gap-1 cursor-pointer"
                  title="시트 (엑셀 모드)"
                >
                  <TableIcon size={14} />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={handleWideToggleClick}
            title={isWide ? "기본 너비" : "와이드 보기"}
          >
            {isWide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>

          {/* 시트(엑셀) 뷰는 테이블 헤더에서 직접 정렬하므로 서버 정렬
              콤보박스를 숨긴다. grid/list 에서만 노출. */}
          {viewMode !== "sheet" && (
            <div>
              <SortCombobox value={sortBy} onValueChange={onSortChange} />
            </div>
          )}

          {canManageSongs ? (
            <Button
              variant="indigo-outline"
              className="self-start gap-1"
              onClick={() => setSongAddDialogOpen(true)}
            >
              <PlusIcon size={12} />
              {!isMobile && "노래 추가"}
            </Button>
          ) : isAuthenticated && canRequestSong && (
            <Button
              variant="indigo-outline"
              className="self-start gap-1"
              onClick={() => handleSongAddRequestCtaClick("toolbar")}
            >
              <PlusIcon size={12} />
              {!isMobile && "노래 추가 요청"}
            </Button>
          )}
        </div>
      </div>

      {/* 첫 로딩 상태 (유저 정보 로딩 또는 노래 로딩) */}
      {isAnyLoading &&
        uniqueSongs.length === 0 &&
        (viewMode === "grid" ? (
          <SkeletonMusicCardGrid count={20} />
        ) : (
          <SkeletonMusicCardListGrid count={20} />
        ))}
      {/* sheet 모드는 별도 스켈레톤 없이 빈 테이블 헤더로 진행 */}

      {/* 에러 상태 */}
      {error && (
        <Alert variant="destructive" className="my-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex flex-col gap-3">
              <div>
                <strong>노래 목록을 불러올 수 없습니다</strong>
                <br />
                <span className="text-sm">
                  {isAxiosError(error) && error.response?.status === 404
                    ? "해당 사용자를 찾을 수 없습니다."
                    : isAxiosError(error) &&
                      error.response?.status &&
                      error.response.status >= 500
                    ? "서버에 일시적인 문제가 발생했습니다."
                    : "네트워크 연결을 확인해주세요."}
                </span>
              </div>
              <Button
                onClick={() => refetch()}
                variant="outline"
                size="sm"
                className="self-start gap-1"
              >
                <RefreshCw size={12} />
                다시 시도
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* 노래 목록 렌더링 */}
      {uniqueSongs.length > 0 && (
        <>
          {viewMode === "grid" && (
            <div
              id="channel-songs-grid"
              className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 mt-4"
            >
              {uniqueSongs.map((song) => {
                const shouldAutoOpen = Boolean(
                  openSongId &&
                    song.id === openSongId &&
                    consumedOpenSongId !== openSongId
                );

                return (
                  <SectionErrorBoundary key={song.id} section="음악 카드">
                    <MusicCard
                      song={song}
                      pricingSettings={pricingSettings}
                      liveRequestState={liveRequestState}
                      primaryRatingField={primaryRatingField}
                      autoOpen={shouldAutoOpen}
                      autoOpenEdit={shouldAutoOpen && editSongId === song.id}
                      onAutoOpenConsumed={() =>
                        setConsumedOpenSongId(openSongId)
                      }
                    />
                  </SectionErrorBoundary>
                );
              })}
            </div>
          )}
          {viewMode === "list" && (
            <div id="channel-songs-list" className="space-y-3 mt-4">
              {uniqueSongs.map((song) => {
                const shouldAutoOpen = Boolean(
                  openSongId &&
                    song.id === openSongId &&
                    consumedOpenSongId !== openSongId
                );

                return (
                  <SectionErrorBoundary key={song.id} section="음악 카드">
                    <MusicCardList
                      song={song}
                      pricingSettings={pricingSettings}
                      liveRequestState={liveRequestState}
                      primaryRatingField={primaryRatingField}
                      autoOpen={shouldAutoOpen}
                      autoOpenEdit={shouldAutoOpen && editSongId === song.id}
                      onAutoOpenConsumed={() =>
                        setConsumedOpenSongId(openSongId)
                      }
                    />
                  </SectionErrorBoundary>
                );
              })}
            </div>
          )}
          {viewMode === "sheet" && (
            <SectionErrorBoundary section="음악 시트">
              <MusicSheet
                songs={uniqueSongs}
                pricingSettings={pricingSettings}
                liveRequestState={liveRequestState}
                openSongId={openSongId}
                editSongId={editSongId}
                consumedOpenSongId={consumedOpenSongId}
                onAutoOpenConsumed={() => setConsumedOpenSongId(openSongId)}
                persistSortKey={`musicbook-sheet-sort:${userId}`}
              />
            </SectionErrorBoundary>
          )}

          {/* 무한스크롤 트리거 요소 */}
          {hasNextPage && (
            <div ref={elementRef} className="flex justify-center mt-8 py-4">
              {viewMode === "sheet" ? (
                // sheet 는 전체를 끌어오는 중 — 부분 정렬/필터 오해 방지용 안내
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  노래책 전체를 불러오는 중... ({uniqueSongs.length}/{totalCount}
                  곡)
                </div>
              ) : isFetchingNextPage ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />더 많은 노래를
                  불러오는 중...
                </div>
              ) : (
                <div className="h-8 flex items-center justify-center text-xs text-gray-400">
                  {/* 스크롤하여 더 보기 힌트 */}
                  스크롤하여 더 많은 노래 보기
                </div>
              )}
            </div>
          )}

          {/* 모든 데이터 로드 완료 */}
          {!hasNextPage && uniqueSongs.length > 0 && (
            <div className="flex justify-center mt-8">
              <div className="text-sm text-gray-500">
                모든 노래를 불러왔습니다
              </div>
            </div>
          )}
        </>
      )}

      {/* 데이터가 없을 때 (에러가 아닌 경우) */}
      {!isAnyLoading && !error && uniqueSongs.length === 0 && (
        <div className="flex flex-col justify-center items-center py-12 gap-4">
          <div className="text-gray-500 text-center">
            {isFavoriteMode
              ? "좋아요한 노래가 없습니다."
              : "검색 결과가 없습니다."}
          </div>
          {!isFavoriteMode && (
            <>
              {canManageSongs ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-muted-foreground text-center">
                    부를 수 있는 곡이라면 바로 추가해보세요
                  </p>
                  <Button
                    variant="indigo-outline"
                    onClick={() => setSongAddDialogOpen(true)}
                  >
                    <PlusIcon size={14} className="mr-1" />
                    노래 추가
                  </Button>
                </div>
              ) : isAuthenticated && canRequestSong ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-muted-foreground text-center">
                    스트리머가 부를 수 있는 곡일 경우 노래 추가를 요청해보세요
                  </p>
                  <Button
                    variant="indigo-outline"
                    onClick={() => handleSongAddRequestCtaClick("empty_state")}
                  >
                    <PlusIcon size={14} className="mr-1" />
                    노래 추가 요청
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {/* 랜덤 추천 모달 */}
      <RandomSongsDialog
        open={randomOpen}
        onOpenChange={setRandomOpen}
        identifier={userId}
        liveRequestState={liveRequestState}
      />

      {/* 노래 추가 요청 다이얼로그 */}
      {channel && (
        <SongAddRequestDialog
          open={songRequestDialogOpen}
          onOpenChange={setSongRequestDialogOpen}
          channelIdentifier={userId}
          channelId={channel.id}
          channelName={channel.name}
          channelProfileImageUrl={channel.profileImageUrl}
        />
      )}

      {/* 노래 추가 다이얼로그 (채널 관리자용) */}
      {channel && (
        <SongAddDialog
          open={songAddDialogOpen}
          onOpenChange={setSongAddDialogOpen}
          channelIdentifier={userId}
          channelId={channel.id}
        />
      )}

      <LiveSongRequestFloating requestState={liveRequestState} settings={publicSession?.settings} />

      {/* 1단계: PRO 전용 기능 안내 모달 */}
      <Dialog open={wideProInfoOpen} onOpenChange={setWideProInfoOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown size={20} className="text-indigo-500" />
              PRO 전용 기능이에요
            </DialogTitle>
            <DialogDescription>
              와이드 보기는 채널에 PRO가 활성화되어 있어야 사용할 수 있는 기능이에요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setWideProInfoOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 와이드 보기 - 로그인 필요 모달 */}
      <LoginRequiredDialog
        open={wideLoginDialogOpen}
        onOpenChange={setWideLoginDialogOpen}
      />
    </section>
  );
}
