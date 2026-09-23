"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Music, Plus, Download } from "lucide-react";
import { ManagementHeader } from "../management-header";
import { Button } from "@/meloming/shared/components/ui/button";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { InlineError } from "@/meloming/shared/components/common/error-boundary";
import {
  usePublicUserSongs,
  useSongByChannelIdentifierSongId,
  songsKeys,
} from "@/meloming/domains/channel/hooks/use-songs";
import {
  patchSongsChannelChannelIdSongId,
  deleteSongsChannelChannelIdSongId,
  deleteSongsChannelChannelIdBulk,
  patchSongsChannelChannelIdBulk,
  getSongAffectedClips,
  getSongBulkAffectedClips,
} from "@/meloming/domains/channel/apis/songs";
import type { BulkUpdateSongItem } from "@/meloming/domains/channel/apis/songs";
import type {
  PatchSongsChannelIdentifierSongIdRequestBody,
  Song,
} from "@/meloming/domains/channel/types/song";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useChannel, useChannelPermission } from "@/meloming/domains/channel/hooks/use-channel";
import { useQueryClient } from "@tanstack/react-query";
import { useMusicbookFilters } from "@/meloming/domains/channel/hooks/use-musicbook-filters";
import { toast } from "sonner";
import { SongFormV2 } from "../song-form-v2";
import type { SongFormValues } from "../song-form.schema";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";

import { useSongsTable } from "./use-songs-table";
import { SongsTable } from "./songs-table";
import { SongsTableToolbar } from "./songs-table-toolbar";
import { SongsTablePagination } from "./songs-table-pagination";
import { SongsTableSkeleton } from "./songs-table-skeleton";
import { useUserCategories } from "@/meloming/domains/channel/hooks/use-categories";
import { useUserArtists } from "@/meloming/domains/channel/hooks/use-artists";
import { usePricingSettings } from "@/meloming/domains/channel/hooks/use-pricing-settings";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  buildSongPatchBody,
  getSongFormInitialValues,
} from "../song-form-utils";
import {
  countBucket,
  getApiErrorStatus,
  getErrorName,
  getManagedSongSummary,
  getSelectionSummary,
  getSongFormSummary,
  getSongPatchSummary,
  getSongsListSummary,
  textLengthBucket,
} from "../songbook-analytics";

type BulkEditPreviewRow = {
  id: number;
  title: string;
  currentValue: string;
  nextValue: string;
  hasChange: boolean;
};

const BULK_EDIT_PREVIEW_COLUMNS: ColumnDef<BulkEditPreviewRow>[] = [
  {
    accessorKey: "title",
    header: "노래",
    cell: ({ row }) => (
      <div className="max-w-[150px] truncate font-medium">
        {row.original.title}
      </div>
    ),
  },
  {
    accessorKey: "currentValue",
    header: "현재",
    cell: ({ row }) => (
      <span
        className={
          row.original.hasChange ? "text-muted-foreground line-through" : ""
        }
      >
        {row.original.currentValue}
      </span>
    ),
  },
  {
    id: "change",
    header: "→",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.hasChange ? "→" : "="}
      </span>
    ),
    meta: { headClassName: "w-8 text-center", cellClassName: "w-8 text-center" },
  },
  {
    accessorKey: "nextValue",
    header: "변경 후",
    cell: ({ row }) => (
      <span
        className={
          row.original.hasChange
            ? "font-medium text-primary"
            : "text-muted-foreground"
        }
      >
        {row.original.hasChange ? row.original.nextValue : "(변경 없음)"}
      </span>
    ),
  },
];

function BulkEditPreviewTable({ rows }: { rows: BulkEditPreviewRow[] }) {
  const table = useReactTable({
    data: rows,
    columns: BULK_EDIT_PREVIEW_COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  return (
    <div className="max-h-64 overflow-y-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`p-2 text-left font-medium ${
                    header.column.columnDef.meta?.headClassName ?? ""
                  }`}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={`p-2 ${
                    cell.column.columnDef.meta?.cellClassName ?? ""
                  }`}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SongsManagementV2() {
  const params = useParams();
  const user = params?.user as string | undefined;
  const identifier = user || "";
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const editIdParam = searchParams.get("editId");
  const editId = editIdParam ? Number(editIdParam) : undefined;

  const { filters, setSearchQuery, setCategory, setArtist, setDifficulty } =
    useMusicbookFilters();

  // 테이블 상태 훅
  const {
    sorting,
    pagination,
    apiSortBy,
    onSortingChange,
    onPaginationChange,
    onPageSizeChange,
    page,
    pageSize,
    pageIndex,
  } = useSongsTable();

  // 페이지네이션 쿼리
  const {
    data,
    isLoading,
    error,
    refetch,
  } = usePublicUserSongs(identifier, {
    page,
    limit: pageSize,
    sortBy: apiSortBy,
    search: filters.searchQuery || undefined,
    categoryId: filters.categoryId || undefined,
    artistId: filters.artistId || undefined,
    difficulty: filters.difficulty ? Number(filters.difficulty) : undefined,
  });

  const songs = data?.songs ?? [];
  const totalCount = data?.total ?? 0;

  // 카테고리/아티스트 데이터 (필터용)
  const { data: categories } = useUserCategories(identifier);
  const { data: artists } = useUserArtists(identifier);

  const { data: publicUser } = useChannel(identifier);
  const channelId = publicUser?.id ?? 0;
  const queryClient = useQueryClient();
  const { data: pricingSettings } = usePricingSettings(channelId || undefined);
  const isPricingEnabled = pricingSettings?.pricingEnabled ?? false;
  const currencyUnit = pricingSettings?.currencyUnit ?? "";
  const currencyConfigs = useMemo(
    () =>
      (pricingSettings?.currencyConfigs ?? []).filter(
        (config) => config.key?.trim() && config.unit?.trim()
      ),
    [pricingSettings?.currencyConfigs]
  );

  // PRO 구독 상태 확인
  const { data: permission, isLoading: isPermissionLoading } =
    useChannelPermission(identifier);
  const isOwnerProSubscriber = permission?.isOwnerProSubscriber ?? false;

  // 상태들
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [deletingSong, setDeletingSong] = useState<Song | null>(null);
  const [orphanClipCount, setOrphanClipCount] = useState<number | null>(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [bulkOrphanClipCount, setBulkOrphanClipCount] = useState<number | null>(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkEditDialog, setShowBulkEditDialog] = useState(false);
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkEditField, setBulkEditField] = useState<"artist" | "category" | "difficulty" | null>(null);
  const [bulkEditArtistId, setBulkEditArtistId] = useState<number | null>(null);
  const [bulkEditCategoryIds, setBulkEditCategoryIds] = useState<number[]>([]);
  const [bulkEditDifficulty, setBulkEditDifficulty] = useState<number | null>(null);
  const pageViewEventKeyRef = useRef("");
  const listLoadedEventKeyRef = useRef("");
  const listErrorEventKeyRef = useRef("");
  const searchFocusCapturedRef = useRef(false);
  const searchStartedCapturedRef = useRef(false);
  const editDetailEventKeyRef = useRef("");
  const bulkEditPreviewEventKeyRef = useRef("");
  const deleteDialogCloseReasonRef = useRef<"dismissed" | "cancel" | "confirm">(
    "dismissed"
  );
  const bulkDeleteDialogCloseReasonRef = useRef<
    "dismissed" | "cancel" | "confirm"
  >("dismissed");
  const bulkEditDialogCloseReasonRef = useRef<"dismissed" | "cancel" | "saved">(
    "dismissed"
  );

  const MAX_BULK = 300;
  const isDialogOpen = Boolean(editingSong);
  const editingSongId = editingSong?.id ?? editId;
  const canFetchEditingSongDetail =
    Boolean(editingSongId) && !isPermissionLoading;
  const {
    data: editingSongDetail,
    isLoading: isEditingSongDetailLoading,
    isError: isEditingSongDetailError,
  } = useSongByChannelIdentifierSongId(identifier, editingSongId, {
    enabled: canFetchEditingSongDetail,
    staleTime: 0,
  });
  const isEditingSongDetailPending =
    Boolean(editingSongId) &&
    (isPermissionLoading || (isEditingSongDetailLoading && !editingSongDetail));

  // 선택된 ID 계산
  const selectedIds = useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map(Number);
  }, [rowSelection]);

  const listContextProperties = useMemo(
    () => ({
      channel_id: channelId || null,
      channel_ready: channelId > 0,
      has_channel_identifier: Boolean(identifier),
      page,
      page_size: pageSize,
      sort_by: apiSortBy,
      has_search: Boolean(filters.searchQuery),
      search_length_bucket: textLengthBucket(filters.searchQuery),
      selected_category_id: filters.categoryId ? Number(filters.categoryId) : null,
      selected_artist_id: filters.artistId ? Number(filters.artistId) : null,
      selected_difficulty: filters.difficulty ? Number(filters.difficulty) : null,
      active_filter_count: [
        filters.searchQuery,
        filters.categoryId,
        filters.artistId,
        filters.difficulty,
      ].filter(Boolean).length,
      category_option_count: categories?.length ?? null,
      artist_option_count: artists?.length ?? null,
      is_pricing_enabled: isPricingEnabled,
      is_owner_pro_subscriber: isOwnerProSubscriber,
      ...getSongsListSummary(songs, totalCount),
      ...getSelectionSummary(selectedIds, songs),
    }),
    [
      apiSortBy,
      artists?.length,
      categories?.length,
      channelId,
      filters.artistId,
      filters.categoryId,
      filters.difficulty,
      filters.searchQuery,
      identifier,
      isOwnerProSubscriber,
      isPricingEnabled,
      page,
      pageSize,
      selectedIds,
      songs,
      totalCount,
    ]
  );

  const bulkEditPreviewRows = useMemo<BulkEditPreviewRow[]>(() => {
    if (!bulkEditField) return [];

    return songs
      .filter((song) => selectedIds.includes(song.id))
      .map((song) => {
        let currentValue = "";
        let nextValue = "";
        let hasChange = false;

        if (bulkEditField === "artist") {
          currentValue = song.artist?.name ?? "-";
          const nextArtist = artists?.find((artist) => artist.id === bulkEditArtistId);
          nextValue = nextArtist?.name ?? "-";
          hasChange = song.artist?.id !== bulkEditArtistId;
        } else if (bulkEditField === "category") {
          currentValue = song.categories?.map((category) => category.name).join(", ") || "-";
          nextValue =
            categories
              ?.filter((category) => bulkEditCategoryIds.includes(category.id))
              .map((category) => category.name)
              .join(", ") || "-";
          const currentCategoryIds =
            song.categories?.map((category) => category.id).sort().join(",") || "";
          const nextCategoryIds = [...bulkEditCategoryIds].sort().join(",");
          hasChange = currentCategoryIds !== nextCategoryIds;
        } else if (bulkEditField === "difficulty") {
          currentValue = song.difficulty?.toString() ?? "-";
          nextValue = bulkEditDifficulty?.toString() ?? "-";
          hasChange = song.difficulty !== bulkEditDifficulty;
        }

        return {
          id: song.id,
          title: song.title,
          currentValue,
          nextValue,
          hasChange,
        };
      });
  }, [
    artists,
    bulkEditArtistId,
    bulkEditCategoryIds,
    bulkEditDifficulty,
    bulkEditField,
    categories,
    selectedIds,
    songs,
  ]);

  const bulkEditPreviewChangedCount = bulkEditPreviewRows.filter(
    (row) => row.hasChange,
  ).length;

  // 개별 삭제 시 고아 클립 수 조회
  useEffect(() => {
    if (!deletingSong || !channelId) {
      setOrphanClipCount(null);
      return;
    }
    captureIntentEvent("channel_songbook_manage_songs_delete_clip_impact_requested", {
      ...listContextProperties,
      ...getManagedSongSummary(deletingSong, "target_song"),
    });
    getSongAffectedClips(channelId, deletingSong.id)
      .then(({ orphanClipCount: count }) => {
        captureIntentEvent(
          "channel_songbook_manage_songs_delete_clip_impact_loaded",
          {
            ...listContextProperties,
            ...getManagedSongSummary(deletingSong, "target_song"),
            orphan_clip_count: count,
            orphan_clip_count_bucket: countBucket(count),
          }
        );
        setOrphanClipCount(count);
      })
      .catch((error: unknown) => {
        captureIntentEvent(
          "channel_songbook_manage_songs_delete_clip_impact_failed",
          {
            ...listContextProperties,
            ...getManagedSongSummary(deletingSong, "target_song"),
            error_status: getApiErrorStatus(error),
            error_name: getErrorName(error),
          }
        );
        setOrphanClipCount(null);
      });
  }, [deletingSong, channelId, listContextProperties]);

  // 벌크 삭제 시 고아 클립 수 조회
  useEffect(() => {
    if (!showBulkDeleteDialog || !channelId || selectedIds.length === 0) {
      setBulkOrphanClipCount(null);
      return;
    }
    captureIntentEvent(
      "channel_songbook_manage_songs_bulk_delete_clip_impact_requested",
      {
        ...listContextProperties,
      }
    );
    getSongBulkAffectedClips(channelId, selectedIds)
      .then(({ orphanClipCount: count }) => {
        captureIntentEvent(
          "channel_songbook_manage_songs_bulk_delete_clip_impact_loaded",
          {
            ...listContextProperties,
            orphan_clip_count: count,
            orphan_clip_count_bucket: countBucket(count),
          }
        );
        setBulkOrphanClipCount(count);
      })
      .catch((error: unknown) => {
        captureIntentEvent(
          "channel_songbook_manage_songs_bulk_delete_clip_impact_failed",
          {
            ...listContextProperties,
            error_status: getApiErrorStatus(error),
            error_name: getErrorName(error),
          }
        );
        setBulkOrphanClipCount(null);
      });
  }, [showBulkDeleteDialog, channelId, selectedIds, listContextProperties]);

  useEffect(() => {
    const eventKey = `${identifier}:${channelId || "pending"}`;
    if (pageViewEventKeyRef.current === eventKey) return;
    pageViewEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_manage_songs_viewed", {
      ...listContextProperties,
    });
  }, [channelId, identifier, listContextProperties]);

  useEffect(() => {
    if (isLoading || error || !data) return;
    const eventKey = [
      page,
      pageSize,
      apiSortBy,
      filters.searchQuery ? "search" : "no_search",
      filters.categoryId ?? "all_categories",
      filters.artistId ?? "all_artists",
      filters.difficulty ?? "all_difficulties",
      totalCount,
      songs.map((song) => song.id).join(","),
    ].join(":");
    if (listLoadedEventKeyRef.current === eventKey) return;
    listLoadedEventKeyRef.current = eventKey;

    captureIntentEvent("channel_songbook_manage_songs_list_loaded", {
      ...listContextProperties,
    });

    if (songs.length === 0) {
      captureIntentEvent(
        listContextProperties.active_filter_count
          ? "channel_songbook_manage_songs_filtered_empty_state_viewed"
          : "channel_songbook_manage_songs_empty_state_viewed",
        {
          ...listContextProperties,
        }
      );
    }
  }, [
    apiSortBy,
    data,
    error,
    filters.artistId,
    filters.categoryId,
    filters.difficulty,
    filters.searchQuery,
    isLoading,
    listContextProperties,
    page,
    pageSize,
    songs,
    totalCount,
  ]);

  useEffect(() => {
    if (!error) return;
    const eventKey = `${identifier}:${page}:${pageSize}:${apiSortBy}:${getErrorName(error)}`;
    if (listErrorEventKeyRef.current === eventKey) return;
    listErrorEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_manage_songs_list_load_failed", {
      ...listContextProperties,
      error_name: getErrorName(error),
    });
  }, [apiSortBy, error, identifier, listContextProperties, page, pageSize]);

  const closeDialog = (reason: "dismissed" | "saved" | "deleted" = "dismissed") => {
    if (editingSong || editingSongId) {
      captureIntentEvent("channel_songbook_manage_songs_edit_dialog_closed", {
        ...listContextProperties,
        ...getManagedSongSummary(editingSong, "target_song"),
        close_reason: reason,
      });
    }
    setEditingSong(null);
    if (editIdParam) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("editId");
      const queryString = next.toString();
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(newUrl);
    }
  };

  // 개별 삭제
  const onDeleteSong = async (songId: number) => {
    const targetSong =
      deletingSong ?? editingSong ?? songs.find((song) => song.id === songId);
    captureIntentEvent("channel_songbook_manage_songs_delete_submitted", {
      ...listContextProperties,
      ...getManagedSongSummary(targetSong, "target_song"),
      orphan_clip_count: orphanClipCount,
      orphan_clip_count_bucket: countBucket(orphanClipCount),
    });
    if (!channelId) {
      captureIntentEvent(
        "channel_songbook_manage_songs_delete_blocked_channel_unready",
        {
          ...listContextProperties,
          ...getManagedSongSummary(targetSong, "target_song"),
        }
      );
      return;
    }
    try {
      await deleteSongsChannelChannelIdSongId(channelId, songId);
      if (editingSong?.id === songId) {
        closeDialog("deleted");
      }
      // 선택 상태에서 제거
      setRowSelection((prev) => {
        const next = { ...prev };
        delete next[String(songId)];
        return next;
      });
      // 쿼리 무효화
      await queryClient.invalidateQueries({
        queryKey: songsKeys.publicUser(identifier),
      });
      captureIntentEvent("channel_songbook_manage_songs_delete_succeeded", {
        ...listContextProperties,
        ...getManagedSongSummary(targetSong, "target_song"),
        orphan_clip_count: orphanClipCount,
        orphan_clip_count_bucket: countBucket(orphanClipCount),
      });
      toast.success("노래가 삭제되었습니다.");
    } catch (error: unknown) {
      captureIntentEvent("channel_songbook_manage_songs_delete_failed", {
        ...listContextProperties,
        ...getManagedSongSummary(targetSong, "target_song"),
        error_status: getApiErrorStatus(error),
        error_name: getErrorName(error),
      });
      toast.error("노래 삭제에 실패했습니다.", {
        description: "잠시 후 다시 시도해주세요.",
      });
    }
  };

  // 일괄 삭제
  const handleBulkDelete = async () => {
    captureIntentEvent("channel_songbook_manage_songs_bulk_delete_submitted", {
      ...listContextProperties,
      orphan_clip_count: bulkOrphanClipCount,
      orphan_clip_count_bucket: countBucket(bulkOrphanClipCount),
      max_bulk_limit: MAX_BULK,
    });
    if (!channelId) {
      captureIntentEvent(
        "channel_songbook_manage_songs_bulk_delete_blocked_channel_unready",
        {
          ...listContextProperties,
        }
      );
      return;
    }
    if (selectedIds.length === 0) {
      captureIntentEvent("channel_songbook_manage_songs_bulk_delete_blocked_empty", {
        ...listContextProperties,
      });
      return;
    }
    if (selectedIds.length > MAX_BULK) {
      captureIntentEvent(
        "channel_songbook_manage_songs_bulk_delete_blocked_over_limit",
        {
          ...listContextProperties,
          max_bulk_limit: MAX_BULK,
        }
      );
      return;
    }
    try {
      setIsBulkDeleting(true);
      await deleteSongsChannelChannelIdBulk(channelId, selectedIds);
      captureIntentEvent("channel_songbook_manage_songs_bulk_delete_succeeded", {
        ...listContextProperties,
        deleted_count: selectedIds.length,
        deleted_count_bucket: countBucket(selectedIds.length),
        orphan_clip_count: bulkOrphanClipCount,
        orphan_clip_count_bucket: countBucket(bulkOrphanClipCount),
      });
      toast.success("일괄 삭제 완료", {
        description: `${selectedIds.length}개 항목이 삭제되었습니다.`,
      });
      setRowSelection({});
      await queryClient.invalidateQueries({
        queryKey: songsKeys.publicUser(identifier),
      });
    } catch (error: unknown) {
      captureIntentEvent("channel_songbook_manage_songs_bulk_delete_failed", {
        ...listContextProperties,
        error_status: getApiErrorStatus(error),
        error_name: getErrorName(error),
      });
      toast.error("일괄 삭제 실패", {
        description: "잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsBulkDeleting(false);
      setShowBulkDeleteDialog(false);
    }
  };

  // 일괄 수정
  const handleBulkEdit = async () => {
    captureIntentEvent("channel_songbook_manage_songs_bulk_edit_submitted", {
      ...listContextProperties,
      bulk_edit_field: bulkEditField,
      bulk_edit_changed_count: bulkEditPreviewChangedCount,
      bulk_edit_changed_count_bucket: countBucket(bulkEditPreviewChangedCount),
      selected_category_count: bulkEditCategoryIds.length,
      selected_category_count_bucket: countBucket(bulkEditCategoryIds.length),
      selected_artist_id: bulkEditArtistId,
      selected_difficulty: bulkEditDifficulty,
    });
    if (!channelId) {
      captureIntentEvent(
        "channel_songbook_manage_songs_bulk_edit_blocked_channel_unready",
        {
          ...listContextProperties,
          bulk_edit_field: bulkEditField,
        }
      );
      return;
    }
    if (selectedIds.length === 0) {
      captureIntentEvent("channel_songbook_manage_songs_bulk_edit_blocked_empty", {
        ...listContextProperties,
        bulk_edit_field: bulkEditField,
      });
      return;
    }
    if (!bulkEditField) {
      captureIntentEvent(
        "channel_songbook_manage_songs_bulk_edit_blocked_field_missing",
        {
          ...listContextProperties,
        }
      );
      return;
    }

    const updateItems: BulkUpdateSongItem[] = selectedIds.map((id) => {
      const item: BulkUpdateSongItem = { id };
      if (bulkEditField === "artist" && bulkEditArtistId) {
        item.artistId = bulkEditArtistId;
      }
      if (bulkEditField === "category" && bulkEditCategoryIds.length > 0) {
        item.categoryIds = bulkEditCategoryIds;
      }
      if (bulkEditField === "difficulty" && bulkEditDifficulty) {
        item.difficulty = bulkEditDifficulty;
      }
      return item;
    });

    try {
      setIsBulkEditing(true);
      await patchSongsChannelChannelIdBulk(channelId, updateItems);
      captureIntentEvent("channel_songbook_manage_songs_bulk_edit_succeeded", {
        ...listContextProperties,
        bulk_edit_field: bulkEditField,
        bulk_edit_changed_count: bulkEditPreviewChangedCount,
        bulk_edit_changed_count_bucket: countBucket(bulkEditPreviewChangedCount),
        updated_count: selectedIds.length,
        updated_count_bucket: countBucket(selectedIds.length),
      });
      toast.success("일괄 수정 완료", {
        description: `${selectedIds.length}개 항목이 수정되었습니다.`,
      });
      setRowSelection({});
      await queryClient.invalidateQueries({
        queryKey: songsKeys.publicUser(identifier),
      });
    } catch (error: unknown) {
      captureIntentEvent("channel_songbook_manage_songs_bulk_edit_failed", {
        ...listContextProperties,
        bulk_edit_field: bulkEditField,
        error_status: getApiErrorStatus(error),
        error_name: getErrorName(error),
      });
      toast.error("일괄 수정 실패", {
        description: "잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsBulkEditing(false);
      setShowBulkEditDialog(false);
      setBulkEditField(null);
      setBulkEditArtistId(null);
      setBulkEditCategoryIds([]);
      setBulkEditDifficulty(null);
    }
  };

  useEffect(() => {
    if (!editId) return;
    if (editingSong?.id === editId) return;

    const fromList = songs.find((s) => s.id === editId);
    if (fromList) {
      setEditingSong(fromList);
      return;
    }
    if (editingSongDetail) {
      setEditingSong(editingSongDetail);
    }
  }, [editId, songs, editingSongDetail, editingSong?.id]);

  // 모달이 열리면 editId를 URL에서 제거
  useEffect(() => {
    if (isDialogOpen && editIdParam) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("editId");
      const queryString = next.toString();
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(newUrl);
    }
  }, [isDialogOpen, editIdParam, searchParams, router, pathname]);

  // 폼 초기값
  const songForEdit = editingSongDetail ?? editingSong;
  const initialFormValues = useMemo(
    () => (songForEdit ? getSongFormInitialValues(songForEdit) : undefined),
    [songForEdit]
  );

  useEffect(() => {
    if (!isDialogOpen || !editingSong) return;
    const eventKey = `${editingSong.id}:opened`;
    if (editDetailEventKeyRef.current === eventKey) return;
    editDetailEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_manage_songs_edit_dialog_opened", {
      ...listContextProperties,
      ...getManagedSongSummary(editingSong, "target_song"),
      detail_status: editingSongDetail ? "loaded" : "pending",
      opened_from_url_param: Boolean(editIdParam),
    });
  }, [
    editIdParam,
    editingSong,
    editingSongDetail,
    isDialogOpen,
    listContextProperties,
  ]);

  useEffect(() => {
    if (!isDialogOpen || !editingSongId) return;
    if (editingSongDetail) {
      const eventKey = `${editingSongId}:detail_loaded`;
      if (editDetailEventKeyRef.current === eventKey) return;
      editDetailEventKeyRef.current = eventKey;
      captureIntentEvent("channel_songbook_manage_songs_edit_detail_loaded", {
        ...listContextProperties,
        ...getManagedSongSummary(editingSongDetail, "target_song"),
      });
      return;
    }

    if (isEditingSongDetailError) {
      const eventKey = `${editingSongId}:detail_failed`;
      if (editDetailEventKeyRef.current === eventKey) return;
      editDetailEventKeyRef.current = eventKey;
      captureIntentEvent("channel_songbook_manage_songs_edit_detail_failed", {
        ...listContextProperties,
        target_song_id: editingSongId,
      });
    }
  }, [
    editingSongDetail,
    editingSongId,
    isDialogOpen,
    isEditingSongDetailError,
    listContextProperties,
  ]);

  useEffect(() => {
    if (!showBulkEditDialog || !bulkEditField || bulkEditPreviewRows.length === 0) {
      return;
    }
    const eventKey = [
      bulkEditField,
      selectedIds.join(","),
      bulkEditArtistId ?? "no_artist",
      bulkEditCategoryIds.join(","),
      bulkEditDifficulty ?? "no_difficulty",
      bulkEditPreviewChangedCount,
    ].join(":");
    if (bulkEditPreviewEventKeyRef.current === eventKey) return;
    bulkEditPreviewEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_manage_songs_bulk_edit_preview_viewed", {
      ...listContextProperties,
      bulk_edit_field: bulkEditField,
      bulk_edit_preview_row_count: bulkEditPreviewRows.length,
      bulk_edit_preview_row_count_bucket: countBucket(bulkEditPreviewRows.length),
      bulk_edit_changed_count: bulkEditPreviewChangedCount,
      bulk_edit_changed_count_bucket: countBucket(bulkEditPreviewChangedCount),
      selected_category_count: bulkEditCategoryIds.length,
      selected_category_count_bucket: countBucket(bulkEditCategoryIds.length),
      selected_artist_id: bulkEditArtistId,
      selected_difficulty: bulkEditDifficulty,
    });
  }, [
    bulkEditArtistId,
    bulkEditCategoryIds,
    bulkEditDifficulty,
    bulkEditField,
    bulkEditPreviewChangedCount,
    bulkEditPreviewRows.length,
    listContextProperties,
    selectedIds,
    showBulkEditDialog,
  ]);

  // 수정/삭제 핸들러
  const handleEdit = useCallback((song: Song) => {
    captureIntentEvent("channel_songbook_manage_songs_edit_clicked", {
      ...listContextProperties,
      ...getManagedSongSummary(song, "target_song"),
      open_source: "table_action",
    });
    setEditingSong(song);
  }, [listContextProperties]);

  const handleDelete = useCallback((song: Song) => {
    captureIntentEvent("channel_songbook_manage_songs_delete_clicked", {
      ...listContextProperties,
      ...getManagedSongSummary(song, "target_song"),
      open_source: "table_action",
    });
    deleteDialogCloseReasonRef.current = "dismissed";
    setDeletingSong(song);
  }, [listContextProperties]);

  const handleSearchFocus = () => {
    if (searchFocusCapturedRef.current) return;
    searchFocusCapturedRef.current = true;
    captureIntentEvent("channel_songbook_manage_songs_search_focused", {
      ...listContextProperties,
    });
  };

  const handleSearchLocalChange = (query: string) => {
    if (!searchStartedCapturedRef.current && query.trim().length > 0) {
      searchStartedCapturedRef.current = true;
      captureIntentEvent("channel_songbook_manage_songs_search_started", {
        ...listContextProperties,
        next_search_length_bucket: textLengthBucket(query),
      });
    }
    if (filters.searchQuery && query.trim().length === 0) {
      captureIntentEvent("channel_songbook_manage_songs_search_local_cleared", {
        ...listContextProperties,
      });
    }
  };

  const handleSearchQueryChange = (query: string | undefined) => {
    captureIntentEvent(
      query
        ? "channel_songbook_manage_songs_search_applied"
        : "channel_songbook_manage_songs_search_removed",
      {
        ...listContextProperties,
        next_search_length_bucket: textLengthBucket(query),
      }
    );
    setSearchQuery(query);
  };

  const handleSearchClearIntent = () => {
    captureIntentEvent("channel_songbook_manage_songs_search_clear_clicked", {
      ...listContextProperties,
    });
  };

  const handleCategoryFilterChange = (
    id: string | undefined,
    source: "toolbar_badge" | "table_header"
  ) => {
    captureIntentEvent(
      id
        ? "channel_songbook_manage_songs_category_filter_selected"
        : "channel_songbook_manage_songs_category_filter_cleared",
      {
        ...listContextProperties,
        filter_source: source,
        next_category_id: id ? Number(id) : null,
      }
    );
    setCategory(id);
  };

  const handleArtistFilterChange = (
    id: string | undefined,
    source: "toolbar_badge" | "table_header"
  ) => {
    captureIntentEvent(
      id
        ? "channel_songbook_manage_songs_artist_filter_selected"
        : "channel_songbook_manage_songs_artist_filter_cleared",
      {
        ...listContextProperties,
        filter_source: source,
        next_artist_id: id ? Number(id) : null,
      }
    );
    setArtist(id);
  };

  const handleDifficultyFilterChange = (
    difficulty: string | undefined,
    source: "toolbar_badge" | "table_header"
  ) => {
    captureIntentEvent(
      difficulty
        ? "channel_songbook_manage_songs_difficulty_filter_selected"
        : "channel_songbook_manage_songs_difficulty_filter_cleared",
      {
        ...listContextProperties,
        filter_source: source,
        next_difficulty: difficulty ? Number(difficulty) : null,
      }
    );
    setDifficulty(difficulty);
  };

  const handleSortingChange = (
    updater: SortingState | ((prev: SortingState) => SortingState)
  ) => {
    const nextSorting =
      typeof updater === "function" ? updater(sorting) : updater;
    captureIntentEvent("channel_songbook_manage_songs_sort_changed", {
      ...listContextProperties,
      next_sort_column: nextSorting[0]?.id ?? "default",
      next_sort_direction: nextSorting[0]
        ? nextSorting[0].desc
          ? "desc"
          : "asc"
        : "default",
    });
    onSortingChange(updater);
  };

  const handleRowSelectionChange = (
    updater:
      | RowSelectionState
      | ((prev: RowSelectionState) => RowSelectionState)
  ) => {
    const nextSelection =
      typeof updater === "function" ? updater(rowSelection) : updater;
    const nextSelectedIds = Object.keys(nextSelection)
      .filter((key) => nextSelection[key])
      .map(Number);
    captureIntentEvent("channel_songbook_manage_songs_selection_changed", {
      ...listContextProperties,
      ...getSelectionSummary(nextSelectedIds, songs),
      previous_selected_count: selectedIds.length,
      next_selected_count: nextSelectedIds.length,
      selection_delta: nextSelectedIds.length - selectedIds.length,
      all_visible_selected: songs.length > 0 && nextSelectedIds.length >= songs.length,
    });
    setRowSelection(updater);
  };

  const handlePageChange = (newPageIndex: number) => {
    captureIntentEvent("channel_songbook_manage_songs_page_changed", {
      ...listContextProperties,
      previous_page: pageIndex + 1,
      next_page: newPageIndex + 1,
    });
    onPaginationChange({ pageIndex: newPageIndex, pageSize });
  };

  const handlePageSizeChange = (newPageSize: number) => {
    captureIntentEvent("channel_songbook_manage_songs_page_size_changed", {
      ...listContextProperties,
      previous_page_size: pageSize,
      next_page_size: newPageSize,
    });
    onPageSizeChange(newPageSize);
  };

  const handleBulkDeleteOpen = () => {
    captureIntentEvent("channel_songbook_manage_songs_bulk_delete_clicked", {
      ...listContextProperties,
      max_bulk_limit: MAX_BULK,
      over_bulk_limit: selectedIds.length > MAX_BULK,
    });
    bulkDeleteDialogCloseReasonRef.current = "dismissed";
    setShowBulkDeleteDialog(true);
  };

  const handleBulkEditOpen = () => {
    captureIntentEvent("channel_songbook_manage_songs_bulk_edit_clicked", {
      ...listContextProperties,
    });
    bulkEditDialogCloseReasonRef.current = "dismissed";
    setShowBulkEditDialog(true);
  };

  if (error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="노래 관리"
          description="등록된 노래 목록을 조회하고 수정할 수 있습니다."
          icon={Music}
        />
        <InlineError
          message="노래 목록을 불러오는데 실패했습니다."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="노래 관리"
        description="등록된 노래 목록을 조회하고 수정할 수 있습니다."
        icon={Music}
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link
              href={`/channel/${user}/manage/songbook-download`}
              onClick={() =>
                captureIntentEvent(
                  "channel_songbook_manage_songs_download_page_clicked",
                  {
                    ...listContextProperties,
                  },
                )
              }
            >
              <Download className="w-4 h-4 mr-2" />
              노래책 다운로드
            </Link>
          </Button>
          <Link href={`/channel/${user}/manage/add-song?tab=manual`}>
            <Button
              onClick={() =>
                captureIntentEvent("channel_songbook_manage_songs_add_song_clicked", {
                  ...listContextProperties,
                  destination_tab: "manual",
                })
              }
            >
              <Plus className="w-4 h-4 mr-2" /> 새 노래 추가
            </Button>
          </Link>
        </div>
      </ManagementHeader>

      {/* 툴바 */}
      <SongsTableToolbar
        searchQuery={filters.searchQuery}
        setSearchQuery={handleSearchQueryChange}
        selectedCount={selectedIds.length}
        onBulkDelete={handleBulkDeleteOpen}
        onBulkEdit={handleBulkEditOpen}
        isBulkDeleting={isBulkDeleting}
        isBulkEditing={isBulkEditing}
        categories={categories}
        artists={artists}
        selectedCategoryId={filters.categoryId}
        selectedArtistId={filters.artistId}
        selectedDifficulty={filters.difficulty}
        onCategoryChange={(id) => handleCategoryFilterChange(id, "toolbar_badge")}
        onArtistChange={(id) => handleArtistFilterChange(id, "toolbar_badge")}
        onDifficultyChange={(difficulty) =>
          handleDifficultyFilterChange(difficulty, "toolbar_badge")
        }
        onSearchFocus={handleSearchFocus}
        onSearchLocalChange={handleSearchLocalChange}
        onSearchClearIntent={handleSearchClearIntent}
      />

      {/* 테이블 */}
      {isLoading ? (
        <SongsTableSkeleton rowCount={10} />
      ) : songs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {filters.searchQuery ||
            filters.categoryId ||
            filters.artistId ||
            filters.difficulty
              ? "검색/필터 결과가 없습니다. 조건을 변경해보세요."
              : '아직 등록된 노래가 없습니다. 상단의 "새 노래 추가"를 눌러 등록해보세요.'}
          </CardContent>
        </Card>
      ) : (
        <>
          <SongsTable
            data={songs}
            sorting={sorting}
            onSortingChange={handleSortingChange}
            rowSelection={rowSelection}
            onRowSelectionChange={handleRowSelectionChange}
            onEdit={handleEdit}
            onDelete={handleDelete}
            totalCount={totalCount}
            // 필터 관련
            categories={categories}
            artists={artists}
            selectedCategoryId={filters.categoryId}
            selectedArtistId={filters.artistId}
            selectedDifficulty={filters.difficulty}
            onCategoryChange={(id) => handleCategoryFilterChange(id, "table_header")}
            onArtistChange={(id) => handleArtistFilterChange(id, "table_header")}
            onDifficultyChange={(difficulty) =>
              handleDifficultyFilterChange(difficulty, "table_header")
            }
            showPrice={isPricingEnabled}
            currencyUnit={currencyUnit}
            currencyConfigs={currencyConfigs}
          />

          {/* 페이지네이션 */}
          <SongsTablePagination
            totalCount={totalCount}
            pageIndex={pageIndex}
            pageSize={pageSize}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </>
      )}

      {/* 수정 모달 */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => !open && closeDialog("dismissed")}
      >
        <DialogContent className="min-w-full lg:min-w-5xl xl:min-w-7xl max-w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="paperlogy">노래 수정</DialogTitle>
          </DialogHeader>
          {editingSong && (
            <>
              {isEditingSongDetailPending ? (
                <div className="py-6 text-sm text-muted-foreground">
                  상세 정보를 불러오는 중입니다...
                </div>
              ) : (
                <SongFormV2
                  key={
                    editingSongDetail
                      ? `edit-${editingSongDetail.id}-detail`
                      : `edit-${editingSong.id}-list`
                  }
                  identifier={identifier}
                  channelId={channelId}
                  initialValues={initialFormValues}
                  editingSongId={editingSong.id}
	                  submitLabel="수정 저장"
	                  onSubmit={async (values) => {
	                    captureIntentEvent(
	                      "channel_songbook_manage_songs_edit_save_clicked",
	                      {
	                        ...listContextProperties,
	                        ...getManagedSongSummary(songForEdit, "target_song"),
	                        ...getSongFormSummary(values),
	                      }
	                    );
	                    if (!channelId) {
	                      captureIntentEvent(
	                        "channel_songbook_manage_songs_edit_save_blocked_channel_unready",
	                        {
	                          ...listContextProperties,
	                          ...getManagedSongSummary(songForEdit, "target_song"),
	                        }
	                      );
	                      return;
	                    }

	                    let patchBody: PatchSongsChannelIdentifierSongIdRequestBody;
	                    try {
	                      patchBody = buildSongPatchBody(initialFormValues, values);
	                    } catch (error: unknown) {
	                      captureIntentEvent(
	                        "channel_songbook_manage_songs_edit_save_blocked_initial_missing",
	                        {
	                          ...listContextProperties,
	                          ...getManagedSongSummary(songForEdit, "target_song"),
	                          error_name: getErrorName(error),
	                        }
	                      );
	                      toast.error("노래 정보를 불러오는 중입니다.", {
	                        description: "잠시 후 다시 시도해주세요.",
	                      });
	                      return;
	                    }
	                    captureIntentEvent(
	                      "channel_songbook_manage_songs_edit_save_submitted",
	                      {
	                        ...listContextProperties,
	                        ...getManagedSongSummary(songForEdit, "target_song"),
	                        ...getSongPatchSummary(patchBody),
	                        ...getSongFormSummary(values),
	                      }
	                    );

	                    try {
	                      await patchSongsChannelChannelIdSongId(
	                        channelId,
	                        editingSong.id,
	                        patchBody
	                      );
	                      await queryClient.invalidateQueries({
	                        queryKey: songsKeys.publicUser(identifier),
	                      });
	                      await queryClient.refetchQueries({
	                        queryKey: songsKeys.publicUser(identifier),
	                        type: "all",
	                      });
	                      captureIntentEvent(
	                        "channel_songbook_manage_songs_edit_save_succeeded",
	                        {
	                          ...listContextProperties,
	                          ...getManagedSongSummary(songForEdit, "target_song"),
	                          ...getSongPatchSummary(patchBody),
	                        }
	                      );
	                      closeDialog("saved");
	                    } catch (error: unknown) {
	                      captureIntentEvent(
	                        "channel_songbook_manage_songs_edit_save_failed",
	                        {
	                          ...listContextProperties,
	                          ...getManagedSongSummary(songForEdit, "target_song"),
	                          ...getSongPatchSummary(patchBody),
	                          error_status: getApiErrorStatus(error),
	                          error_name: getErrorName(error),
	                        }
	                      );
	                      toast.error("노래 수정에 실패했습니다.", {
	                        description: "잠시 후 다시 시도해주세요.",
	                      });
	                    }
	                  }}
	                />
              )}
              {isEditingSongDetailError && !editingSongDetail && (
                <p className="text-xs text-amber-600 mt-2">
                  상세 정보를 불러오지 못했습니다. 일부 필드가 비어 있을 수
                  있습니다.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 개별 삭제 확인 모달 */}
      <AlertDialog
        open={!!deletingSong}
        onOpenChange={(open) => {
          if (!open && deletingSong) {
            captureIntentEvent(
              "channel_songbook_manage_songs_delete_dialog_closed",
              {
                ...listContextProperties,
                ...getManagedSongSummary(deletingSong, "target_song"),
                close_reason: deleteDialogCloseReasonRef.current,
              }
            );
            deleteDialogCloseReasonRef.current = "dismissed";
            setDeletingSong(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="paperlogy">노래 삭제</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  &ldquo;{deletingSong?.title}&rdquo;를 삭제하시겠습니까? 이 작업은
                  되돌릴 수 없습니다.
                </p>
                {orphanClipCount != null && orphanClipCount > 0 && (
                  <p className="mt-2 text-amber-600 font-medium">
                    이 노래에만 연결된 클립 {orphanClipCount}개도 함께 삭제됩니다.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (deletingSong) {
                  deleteDialogCloseReasonRef.current = "cancel";
                  captureIntentEvent(
                    "channel_songbook_manage_songs_delete_cancel_clicked",
                    {
                      ...listContextProperties,
                      ...getManagedSongSummary(deletingSong, "target_song"),
                      orphan_clip_count: orphanClipCount,
                      orphan_clip_count_bucket: countBucket(orphanClipCount),
                    }
                  );
                }
              }}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingSong) {
                  deleteDialogCloseReasonRef.current = "confirm";
                  captureIntentEvent(
                    "channel_songbook_manage_songs_delete_confirm_clicked",
                    {
                      ...listContextProperties,
                      ...getManagedSongSummary(deletingSong, "target_song"),
                      orphan_clip_count: orphanClipCount,
                      orphan_clip_count_bucket: countBucket(orphanClipCount),
                    }
                  );
                  onDeleteSong(deletingSong.id);
                  setDeletingSong(null);
                }
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 일괄 삭제 확인 모달 */}
      <AlertDialog
        open={showBulkDeleteDialog}
        onOpenChange={(open) => {
          if (!open && showBulkDeleteDialog) {
            captureIntentEvent(
              "channel_songbook_manage_songs_bulk_delete_dialog_closed",
              {
                ...listContextProperties,
                close_reason: bulkDeleteDialogCloseReasonRef.current,
                orphan_clip_count: bulkOrphanClipCount,
                orphan_clip_count_bucket: countBucket(bulkOrphanClipCount),
                max_bulk_limit: MAX_BULK,
              }
            );
            bulkDeleteDialogCloseReasonRef.current = "dismissed";
          }
          setShowBulkDeleteDialog(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="paperlogy">
              선택한 노래 일괄 삭제
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  총 {selectedIds.length}개 항목을 삭제합니다. 이 작업은 되돌릴 수
                  없습니다.
                </p>
                {selectedIds.length > MAX_BULK && (
                  <p className="mt-2 text-destructive">
                    최대 {MAX_BULK}개까지 한 번에 삭제할 수 있습니다.
                  </p>
                )}
                {bulkOrphanClipCount != null && bulkOrphanClipCount > 0 && (
                  <p className="mt-2 text-amber-600 font-medium">
                    해당 노래에만 연결된 클립 {bulkOrphanClipCount}개도 함께
                    삭제됩니다.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                bulkDeleteDialogCloseReasonRef.current = "cancel";
                captureIntentEvent(
                  "channel_songbook_manage_songs_bulk_delete_cancel_clicked",
                  {
                    ...listContextProperties,
                    orphan_clip_count: bulkOrphanClipCount,
                    orphan_clip_count_bucket: countBucket(bulkOrphanClipCount),
                    max_bulk_limit: MAX_BULK,
                  }
                );
              }}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                selectedIds.length === 0 ||
                selectedIds.length > MAX_BULK ||
                isBulkDeleting
              }
              onClick={() => {
                bulkDeleteDialogCloseReasonRef.current = "confirm";
                captureIntentEvent(
                  "channel_songbook_manage_songs_bulk_delete_confirm_clicked",
                  {
                    ...listContextProperties,
                    orphan_clip_count: bulkOrphanClipCount,
                    orphan_clip_count_bucket: countBucket(bulkOrphanClipCount),
                    max_bulk_limit: MAX_BULK,
                  }
                );
                handleBulkDelete();
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 일괄 수정 다이얼로그 */}
      <Dialog
        open={showBulkEditDialog}
        onOpenChange={(open) => {
          if (!open && showBulkEditDialog) {
            captureIntentEvent(
              "channel_songbook_manage_songs_bulk_edit_dialog_closed",
              {
                ...listContextProperties,
                close_reason: bulkEditDialogCloseReasonRef.current,
                bulk_edit_field: bulkEditField,
                bulk_edit_changed_count: bulkEditPreviewChangedCount,
                bulk_edit_changed_count_bucket: countBucket(
                  bulkEditPreviewChangedCount
                ),
              }
            );
            bulkEditDialogCloseReasonRef.current = "dismissed";
          }
          setShowBulkEditDialog(open);
          if (!open) {
            setBulkEditField(null);
            setBulkEditArtistId(null);
            setBulkEditCategoryIds([]);
            setBulkEditDifficulty(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="paperlogy">
              선택한 노래 일괄 수정
            </DialogTitle>
            <DialogDescription>
              {selectedIds.length}개 노래를 일괄 수정합니다. 수정할 항목을 선택하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* 수정 항목 선택 */}
            <div className="flex gap-2">
              <Button
                variant={bulkEditField === "artist" ? "default" : "outline"}
	                size="sm"
	                onClick={() => {
	                  captureIntentEvent(
	                    "channel_songbook_manage_songs_bulk_edit_field_selected",
	                    {
	                      ...listContextProperties,
	                      bulk_edit_field: "artist",
	                    }
	                  );
	                  setBulkEditField("artist");
	                  setBulkEditCategoryIds([]);
	                  setBulkEditDifficulty(null);
                }}
              >
                가수
              </Button>
              <Button
                variant={bulkEditField === "category" ? "default" : "outline"}
	                size="sm"
	                onClick={() => {
	                  captureIntentEvent(
	                    "channel_songbook_manage_songs_bulk_edit_field_selected",
	                    {
	                      ...listContextProperties,
	                      bulk_edit_field: "category",
	                    }
	                  );
	                  setBulkEditField("category");
	                  setBulkEditArtistId(null);
	                  setBulkEditDifficulty(null);
                }}
              >
                카테고리
              </Button>
              <Button
                variant={bulkEditField === "difficulty" ? "default" : "outline"}
	                size="sm"
	                onClick={() => {
	                  captureIntentEvent(
	                    "channel_songbook_manage_songs_bulk_edit_field_selected",
	                    {
	                      ...listContextProperties,
	                      bulk_edit_field: "difficulty",
	                    }
	                  );
	                  setBulkEditField("difficulty");
	                  setBulkEditArtistId(null);
	                  setBulkEditCategoryIds([]);
                }}
              >
                난이도
              </Button>
            </div>

            {/* 가수 선택 */}
            {bulkEditField === "artist" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">가수 선택</label>
                <select
	                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
	                  value={bulkEditArtistId ?? ""}
	                  onChange={(e) => {
	                    const nextArtistId = e.target.value
	                      ? Number(e.target.value)
	                      : null;
	                    captureIntentEvent(
	                      nextArtistId
	                        ? "channel_songbook_manage_songs_bulk_edit_artist_selected"
	                        : "channel_songbook_manage_songs_bulk_edit_artist_cleared",
	                      {
	                        ...listContextProperties,
	                        selected_artist_id: nextArtistId,
	                        bulk_edit_field: "artist",
	                      }
	                    );
	                    setBulkEditArtistId(nextArtistId);
	                  }}
	                >
                  <option value="">선택하세요</option>
                  {artists?.map((artist) => (
                    <option key={artist.id} value={artist.id}>
                      {artist.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 카테고리 선택 */}
            {bulkEditField === "category" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">카테고리 선택 (복수 선택 가능)</label>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border rounded-md">
                  {categories?.map((category) => (
                    <Button
                      key={category.id}
                      variant={bulkEditCategoryIds.includes(category.id) ? "default" : "outline"}
	                      size="sm"
	                      onClick={() => {
	                        const nextSelected = bulkEditCategoryIds.includes(category.id)
	                          ? bulkEditCategoryIds.filter((id) => id !== category.id)
	                          : [...bulkEditCategoryIds, category.id];
	                        captureIntentEvent(
	                          bulkEditCategoryIds.includes(category.id)
	                            ? "channel_songbook_manage_songs_bulk_edit_category_removed"
	                            : "channel_songbook_manage_songs_bulk_edit_category_added",
	                          {
	                            ...listContextProperties,
	                            selected_category_id: category.id,
	                            selected_category_count: nextSelected.length,
	                            selected_category_count_bucket: countBucket(
	                              nextSelected.length
	                            ),
	                            bulk_edit_field: "category",
	                          }
	                        );
	                        setBulkEditCategoryIds((prev) =>
	                          prev.includes(category.id)
	                            ? prev.filter((id) => id !== category.id)
                            : [...prev, category.id]
                        );
                      }}
                      style={
                        bulkEditCategoryIds.includes(category.id)
                          ? { backgroundColor: category.color }
                          : undefined
                      }
                    >
                      {category.name}
                    </Button>
                  ))}
                </div>
                {bulkEditCategoryIds.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {bulkEditCategoryIds.length}개 선택됨
                  </p>
                )}
              </div>
            )}

            {/* 난이도 선택 */}
            {bulkEditField === "difficulty" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">난이도 선택</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((level) => (
                    <Button
	                      key={level}
	                      variant={bulkEditDifficulty === level ? "default" : "outline"}
	                      size="sm"
	                      onClick={() => {
	                        captureIntentEvent(
	                          "channel_songbook_manage_songs_bulk_edit_difficulty_selected",
	                          {
	                            ...listContextProperties,
	                            selected_difficulty: level,
	                            bulk_edit_field: "difficulty",
	                          }
	                        );
	                        setBulkEditDifficulty(level);
	                      }}
	                      className="flex-1"
                    >
                      {level}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* 미리보기 (Dry-Run) */}
            {bulkEditField && (
              (bulkEditField === "artist" && bulkEditArtistId) ||
              (bulkEditField === "category" && bulkEditCategoryIds.length > 0) ||
              (bulkEditField === "difficulty" && bulkEditDifficulty)
            ) && (
              <div className="space-y-2 pt-4 border-t">
                <label className="text-sm font-medium">변경 미리보기</label>
                <BulkEditPreviewTable rows={bulkEditPreviewRows} />
                <p className="text-xs text-muted-foreground">
                  {bulkEditPreviewChangedCount}개 노래가 실제로 변경됩니다.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
	            <Button
	              variant="outline"
	              onClick={() => {
	                bulkEditDialogCloseReasonRef.current = "cancel";
	                captureIntentEvent(
	                  "channel_songbook_manage_songs_bulk_edit_cancel_clicked",
	                  {
	                    ...listContextProperties,
	                    bulk_edit_field: bulkEditField,
	                    bulk_edit_changed_count: bulkEditPreviewChangedCount,
	                    bulk_edit_changed_count_bucket: countBucket(
	                      bulkEditPreviewChangedCount
	                    ),
	                  }
	                );
	                setShowBulkEditDialog(false);
	              }}
	            >
              취소
            </Button>
	            <Button
	              onClick={() => {
	                bulkEditDialogCloseReasonRef.current = "saved";
	                captureIntentEvent(
	                  "channel_songbook_manage_songs_bulk_edit_confirm_clicked",
	                  {
	                    ...listContextProperties,
	                    bulk_edit_field: bulkEditField,
	                    bulk_edit_changed_count: bulkEditPreviewChangedCount,
	                    bulk_edit_changed_count_bucket: countBucket(
	                      bulkEditPreviewChangedCount
	                    ),
	                  }
	                );
	                handleBulkEdit();
	              }}
              disabled={
                isBulkEditing ||
                !bulkEditField ||
                (bulkEditField === "artist" && !bulkEditArtistId) ||
                (bulkEditField === "category" && bulkEditCategoryIds.length === 0) ||
                (bulkEditField === "difficulty" && !bulkEditDifficulty)
              }
            >
              {isBulkEditing ? "수정 중..." : "수정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
