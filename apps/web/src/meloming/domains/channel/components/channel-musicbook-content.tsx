"use client";

import NoticeAlert from "@/meloming/domains/channel/components/section/notice-alert";
import { SectionErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import { useState, useEffect, useCallback } from "react";
import {
  useInfinitePublicUserSongs,
  useInfiniteFavoriteUserSongs,
} from "@/meloming/domains/channel/hooks/use-songs";
import {
  useChannel,
  useChannelMusicbookSettings,
  useChannelPermission,
} from "@/meloming/domains/channel/hooks/use-channel";
import { debounce } from "es-toolkit";
import type { GetSongsChannelIdentifierResponse } from "@/meloming/domains/channel/types/song";
import type { InfiniteData } from "@tanstack/react-query";
import SongListSection, {
  type ViewMode,
} from "@/meloming/domains/channel/components/section/song-list";
import FilterSection from "@/meloming/domains/channel/components/musicbook/filter";
import { FilterBar } from "@/meloming/domains/channel/components/musicbook/filter-bar";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import clsx from "clsx";
import { cn } from "@/meloming/shared/lib/utils";
import { useMusicbookFilters } from "@/meloming/domains/channel/hooks/use-musicbook-filters";
import type { MusicbookRatingFilterField } from "@/meloming/domains/channel/hooks/use-musicbook-filters";
import { useSearchParams } from "next/navigation";
import { useChannelSongAddRequests } from "@/meloming/domains/channel/hooks/use-song-requests";
import { useSyncContentWidth } from "@/meloming/domains/channel/hooks/use-content-width";
import { RequestManagementAlert } from "@/meloming/domains/channel/components/request-management-alert";
import { SongRequestGuideBanner } from "@/meloming/domains/channel/components/song-request-guide-banner";
import { GlobalLinkHint } from "@/meloming/domains/channel/components/section/global-link-hint";

type SortBy = "newest" | "oldest" | "title" | "artist" | "likes_desc";

const SEARCH_DEBOUNCE_DELAY_MS = 300;

export function ChannelMusicbookContent({ user }: { user: string }) {
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const [openSongId, setOpenSongId] = useState<number | undefined>(undefined);
  const [editSongId, setEditSongId] = useState<number | undefined>(undefined);
  const [isFavoriteMode, setIsFavoriteMode] = useState(false);

  const { data: userData, isLoading: isUserLoading } = useChannel(user || "");
  const { data: userPermission } = useChannelPermission(user || "");
  const { data: musicbookSettings } = useChannelMusicbookSettings(user || "");
  const primaryRatingField: MusicbookRatingFilterField =
    musicbookSettings?.useProficiencyAsPrimary ? "proficiency" : "difficulty";
  const ratingFilterLabel =
    primaryRatingField === "proficiency" ? "숙련도" : "난이도";

  // 로컬 레이아웃 설정 (유저가 노래책에서 직접 변경 가능, 채널 설정보다 우선)
  const channelLayoutWidth = userData?.layoutWidth ?? "default";
  // SSR 과 첫 CSR render 에서 동일한 null 로 시작해야 hydration mismatch 방지
  // (React error #418). localStorage 는 mount 후 useEffect 에서 읽음.
  const [localLayout, setLocalLayout] = useState<"default" | "wide" | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`musicbook-layout:${user}`);
      if (stored === "default" || stored === "wide") {
        setLocalLayout(stored);
      }
    } catch {}
  }, [user]);

  const isOwnerPro = userData?.isOwnerProSubscriber ?? false;
  const isWide = isOwnerPro && (localLayout !== null ? localLayout === "wide" : channelLayoutWidth === "wide");

  // 사이드 배너 배치를 노래책의 wide 상태에 맞게 동기화
  // unmount 시 채널 기본 설정으로 복원
  useSyncContentWidth(isWide, isOwnerPro && channelLayoutWidth === "wide");

  const handleToggleLayout = useCallback(() => {
    const next = isWide ? "default" : "wide";
    setLocalLayout(next);
    try {
      localStorage.setItem(`musicbook-layout:${user}`, next);
    } catch {}
  }, [isWide, user]);
  const canManageSongRequests = Boolean(
    userPermission?.isOwner || userPermission?.manageContent
  );

  const { data: pendingSongRequests } = useChannelSongAddRequests(
    userData?.id,
    {
      status: "PENDING",
      take: 1,
    },
    {
      enabled: Boolean(userData?.id && canManageSongRequests),
    }
  );

  const pendingSongRequestCount =
    pendingSongRequests?.pendingCount ??
    pendingSongRequests?.items?.length ??
    0;

  const {
    filters,
    setSearchQuery,
    setCategories,
    toggleCategory,
    setArtists,
    toggleArtist,
    setRatingFilter,
    clearFilters,
  } = useMusicbookFilters();

  const { searchQuery, categoryIds, artistIds, difficulty, proficiency } =
    filters;
  const categoryIdsParam =
    categoryIds.length > 0 ? categoryIds.join(",") : undefined;
  const artistIdsParam =
    artistIds.length > 0 ? artistIds.join(",") : undefined;
  const activeRatingFilter =
    primaryRatingField === "proficiency" ? proficiency : difficulty;
  const handleRatingFilterChange = useCallback(
    (level: string | undefined) => {
      setRatingFilter(primaryRatingField, level);
    },
    [primaryRatingField, setRatingFilter]
  );

  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(
    searchQuery || ""
  );

  useEffect(() => {
    const handler = debounce((query: string) => {
      setDebouncedSearchQuery(query);
    }, SEARCH_DEBOUNCE_DELAY_MS);

    handler(searchQuery || "");

    return () => {
      handler.cancel();
    };
  }, [searchQuery]);

  // 뷰 모드(Grid/List/Sheet). localStorage 에 채널별 영속. SSR/첫 CSR 은
  // "grid" 로 시작해 hydration mismatch 방지, mount 후 복원.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`musicbook-view-mode:${user}`);
      if (stored === "grid" || stored === "list" || stored === "sheet") {
        // SSR-safe: localStorage 는 mount 후에만 읽어 hydration mismatch 회피.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setViewMode(stored);
      }
    } catch {}
  }, [user]);
  const handleViewModeChange = useCallback(
    (next: ViewMode) => {
      setViewMode(next);
      try {
        localStorage.setItem(`musicbook-view-mode:${user}`, next);
      } catch {}
    },
    [user]
  );

  // 정렬 기준도 채널별로 영속(이전엔 새로고침 시 항상 "최신순"으로 리셋됨).
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`musicbook-sort:${user}`);
      if (
        stored === "newest" ||
        stored === "oldest" ||
        stored === "title" ||
        stored === "artist" ||
        stored === "likes_desc"
      ) {
        // SSR-safe: mount 후 복원 (hydration mismatch 회피).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSortBy(stored);
      }
    } catch {}
  }, [user]);
  const handleSortChange = useCallback(
    (newSortBy: SortBy) => {
      setSortBy(newSortBy);
      try {
        localStorage.setItem(`musicbook-sort:${user}`, newSortBy);
      } catch {}
    },
    [user]
  );

  // sheet(엑셀) 뷰는 전체 노래책을 끌어와야 하므로 페이지 크기를 키워 요청
  // 수를 줄인다(백엔드 limit 상한 100). grid/list 는 기존 40 유지.
  const songsLimit = viewMode === "sheet" ? 100 : 40;

  const apiParams: Omit<
    {
      page?: number;
      limit?: number;
      sortBy?: SortBy;
      categoryId?: string;
      artistId?: string;
      categoryIds?: string;
      artistIds?: string;
      difficulties?: string;
      proficiencies?: string;
      search?: string;
      difficulty?: number;
      proficiency?: number;
    },
    "page"
  > = {
    limit: songsLimit,
    sortBy: sortBy,
    search: debouncedSearchQuery || undefined,
    categoryIds: categoryIdsParam,
    artistIds: artistIdsParam,
    difficulties:
      primaryRatingField === "difficulty" && activeRatingFilter
        ? activeRatingFilter
        : undefined,
    proficiencies:
      primaryRatingField === "proficiency" && activeRatingFilter
        ? activeRatingFilter
        : undefined,
    difficulty:
      primaryRatingField === "difficulty" && activeRatingFilter
        ? parseInt(activeRatingFilter, 10)
        : undefined,
    proficiency:
      primaryRatingField === "proficiency" && activeRatingFilter
        ? parseInt(activeRatingFilter, 10)
        : undefined,
  };

  const normalSongsQuery = useInfinitePublicUserSongs(user || "", apiParams, {
    enabled: !isFavoriteMode,
  });

  const favoriteSongsQuery = useInfiniteFavoriteUserSongs(
    userData?.id,
    {
      limit: songsLimit,
      sortBy: sortBy,
    },
    {
      enabled: isFavoriteMode,
    }
  );

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = isFavoriteMode ? favoriteSongsQuery : normalSongsQuery;

  const infiniteData = data as
    | InfiniteData<GetSongsChannelIdentifierResponse, unknown>
    | undefined;
  const allSongs = infiniteData?.pages?.flatMap((page) => page.songs) || [];
  const totalCount = infiniteData?.pages?.[0]?.total || 0;

  useEffect(() => {
    const openSongIdParam = searchParams.get("openSongId");
    const editSongIdParam = searchParams.get("editSongId");
    const parsedOpenSongId = openSongIdParam
      ? Number(openSongIdParam)
      : undefined;
    const parsedEditSongId = editSongIdParam
      ? Number(editSongIdParam)
      : undefined;
    const nextEditSongId =
      parsedEditSongId && Number.isFinite(parsedEditSongId)
        ? parsedEditSongId
        : undefined;
    const nextOpenSongId =
      nextEditSongId ??
      (parsedOpenSongId && Number.isFinite(parsedOpenSongId)
        ? parsedOpenSongId
        : undefined);

    setOpenSongId(nextOpenSongId);
    setEditSongId(nextEditSongId);
  }, [searchParams]);

  const [isSticky, setIsSticky] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const triggerPoint = 200;
      setIsSticky(scrollY > triggerPoint);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <div
        className={clsx(
          "xl:hidden sticky top-[var(--channel-sticky-top)] z-30 bg-background border-b"
        )}
      >
        <div
          className={cn(
            !isWide && "container",
            "mx-auto",
            isMobile ? "px-2 py-3" : "px-4 md:px-6 py-3"
          )}
        >
          <SectionErrorBoundary section="필터">
            <FilterBar
              username={user || ""}
              filters={filters}
              setSearchQuery={setSearchQuery}
              setCategories={setCategories}
              setArtists={setArtists}
              ratingValue={activeRatingFilter}
              ratingLabel={ratingFilterLabel}
              ratingField={primaryRatingField}
              setRating={handleRatingFilterChange}
              clearFilters={clearFilters}
            />
          </SectionErrorBoundary>
        </div>
      </div>

      <section
        id="musicbook-section"
        className={cn(
          "relative",
          !isWide && "container",
          "mx-auto mt-8 md:px-6 mb-12",
          isMobile ? "mt-4" : "mt-8 px-4"
        )}
      >
        <div className="flex flex-col xl:flex-row gap-6">
          <div className="hidden xl:block">
            <SectionErrorBoundary section="필터">
              <FilterSection
                isSticky={isSticky}
                username={user || ""}
                filters={filters}
                setSearchQuery={setSearchQuery}
                setCategories={setCategories}
                toggleCategory={toggleCategory}
                setArtists={setArtists}
                toggleArtist={toggleArtist}
                ratingValue={activeRatingFilter}
                ratingLabel={ratingFilterLabel}
                ratingField={primaryRatingField}
                setRating={handleRatingFilterChange}
                clearFilters={clearFilters}
              />
            </SectionErrorBoundary>
          </div>

          <div className="flex-1 min-w-0">
            <SectionErrorBoundary section="노래 추가 요청 알림">
              <RequestManagementAlert
                type="song"
                pendingCount={pendingSongRequestCount}
                manageHref={`/channel/${user || ""}/manage/song-requests`}
                className="mb-4"
              />
            </SectionErrorBoundary>

            <SectionErrorBoundary section="신청곡 안내">
              <SongRequestGuideBanner userId={user || ""} />
            </SectionErrorBoundary>

            <SectionErrorBoundary section="공지사항">
              <div
                className={clsx(
                  userData?.channelDescription &&
                    userData?.channelDescription.trim() !== ""
                    ? "mb-6"
                    : "mb-0"
                )}
              >
                <NoticeAlert userId={user || ""} userData={userData} />
              </div>
            </SectionErrorBoundary>

            <SectionErrorBoundary section="글로벌 안내">
              <GlobalLinkHint
                channelId={userData?.id}
                webPath={userData?.webPath}
              />
            </SectionErrorBoundary>

            <SectionErrorBoundary section="노래 목록">
              <SongListSection
                userId={user || ""}
                songs={allSongs}
                totalCount={Number(totalCount)}
                isLoading={isLoading}
                error={error}
                refetch={refetch}
                fetchNextPage={fetchNextPage}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                sortBy={sortBy}
                onSortChange={handleSortChange}
                isUserLoading={isUserLoading}
                openSongId={openSongId}
                editSongId={editSongId}
                isFavoriteMode={isFavoriteMode}
                onFavoriteModeChange={setIsFavoriteMode}
                isWide={isWide}
                onToggleLayout={handleToggleLayout}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                primaryRatingField={primaryRatingField}
              />
            </SectionErrorBoundary>
          </div>
        </div>
      </section>
    </>
  );
}
