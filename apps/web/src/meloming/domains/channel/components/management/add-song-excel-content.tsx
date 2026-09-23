"use client";

import { useParams } from "next/navigation";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  MusicIcon,
  SaveIcon,
  UploadIcon,
  DownloadIcon,
  CopyIcon,
  ExternalLinkIcon,
  InfoIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as React from "react";
import type { SongFormValues } from "./song-form.schema";
import { useAtomValue } from "jotai";
import { themeColorAtom } from "@/meloming/domains/channel/atoms/channel-atom";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import type { PostSongsAlbumArtBulkSearchRequestBody } from "@/meloming/domains/channel/types/song";
import { toast } from "sonner";
import { useChannel } from "../../hooks/use-channel";
import { useSongsManagement } from "@/meloming/domains/channel/hooks/use-songs-management";
import {
  AddSongExcelInput,
  type AddSongExcelInputHandle,
} from "./add-song-excel-input-new";
import { AddSongExcelPreview } from "./add-song-excel-preview";
import * as XLSX from "xlsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/meloming/shared/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/meloming/shared/components/ui/alert";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import {
  ADD_SONG_EXCEL_COLUMN_LABELS,
  applyAlbumArtMappings,
  buildAlbumArtMappingRequests,
  buildBulkCreateSongs,
  formatValidationIssue,
  getSongKey,
  getSuccessfulAlbumArtResults,
  parseExcelRows,
  toPreviewSongs,
  type SheetRow,
} from "./add-song-excel-utils";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  countBucket,
  getApiErrorStatus,
  getErrorName,
  getExcelRowsSummary,
  getExcelValidationSummary,
  getFileSummary,
} from "./songbook-analytics";

// Liquid Glass 스타일 버튼 컴포넌트
type LiquidGlassButtonProps = {
  onClick: () => void;
  onAttempt?: (disabledReason: "empty" | "busy" | null) => void;
  onEmptyDialogChange?: (open: boolean) => void;
  disabledReason: "empty" | "busy" | null;
  songCount: number;
};

function LiquidGlassButton({
  onClick,
  onAttempt,
  onEmptyDialogChange,
  disabledReason,
  songCount,
}: LiquidGlassButtonProps) {
  const filterId = `liquid-glass-${React.useId()}`;
  const [showAlertDialog, setShowAlertDialog] = React.useState(false);

  const handleClick = () => {
    onAttempt?.(disabledReason);
    if (disabledReason === "empty") {
      onEmptyDialogChange?.(true);
      setShowAlertDialog(true);
      return;
    }
    if (disabledReason === "busy") return;
    onClick();
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="fixed bottom-6 right-6 z-40 group cursor-pointer"
        title="노래 확인하고 저장"
      >
        <div className="relative flex items-center gap-3 rounded-full px-6 py-4 text-indigo-500 shadow-2xl ring-2 ring-indigo-500/20 dark:ring-indigo-900 overflow-hidden transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
          {/* SVG Filter */}
          <svg
            aria-hidden
            style={{ position: "absolute", width: 0, height: 0 }}
          >
            <filter
              id={filterId}
              x="0%"
              y="0%"
              width="100%"
              height="100%"
              filterUnits="objectBoundingBox"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.001 0.005"
                numOctaves={1}
                seed={17}
                result="turbulence"
              />
              <feComponentTransfer in="turbulence" result="mapped">
                <feFuncR
                  type="gamma"
                  amplitude={1}
                  exponent={10}
                  offset={0.5}
                />
                <feFuncG type="gamma" amplitude={0} exponent={1} offset={0} />
                <feFuncB type="gamma" amplitude={0} exponent={1} offset={0.5} />
              </feComponentTransfer>
              <feGaussianBlur
                in="turbulence"
                stdDeviation={3}
                result="softMap"
              />
              <feSpecularLighting
                in="softMap"
                surfaceScale={5}
                specularConstant={1}
                specularExponent={100}
                lightingColor="white"
                result="specLight"
              >
                <fePointLight x={-200} y={-200} z={300} />
              </feSpecularLighting>
              <feComposite
                in="specLight"
                operator="arithmetic"
                k1={0}
                k2={1}
                k3={1}
                k4={0}
                result="litImage"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="softMap"
                scale={200}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </svg>

          {/* Liquid Glass layers */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backdropFilter: "blur(3px)",
              filter: `url(#${filterId})`,
              isolation: "isolate",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/30 to-transparent"
            style={{ opacity: 0.25 }}
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              boxShadow:
                "inset 2px 2px 1px 0 rgba(255,255,255,0.5), inset -1px -1px 1px 1px rgba(255,255,255,0.5)",
            }}
          />

          {/* Content */}
          <SaveIcon className="relative z-10 h-5 w-5" strokeWidth={2.5} />
          <div className="relative z-10 flex flex-col items-start">
            <span className="text-sm font-bold whitespace-nowrap">
              노래 확인하고 저장
            </span>
            {songCount > 0 && (
              <span className="text-xs opacity-90">{songCount}곡 인식됨</span>
            )}
          </div>
        </div>
      </button>

      <AlertDialog
        open={showAlertDialog}
        onOpenChange={(open) => {
          onEmptyDialogChange?.(open);
          setShowAlertDialog(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="paperlogy">
              입력된 곡이 없습니다
            </AlertDialogTitle>
            <AlertDialogDescription>
              먼저 데이터를 입력해주세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowAlertDialog(false)}>
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function AddSongExcelContent() {
  const params = useParams();
  const user = params?.user as string | undefined;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sheetInputRef = useRef<AddSongExcelInputHandle>(null);
  const pageViewEventKeyRef = useRef("");
  const sheetRowsChangedEventKeyRef = useRef("");
  const validationIssueEventKeyRef = useRef("");

  const { data: channel } = useChannel(user || "");
  const channelId = channel?.id;
  const isChannelReady = typeof channelId === "number" && channelId > 0;
  const { bulkMapAlbumArt, bulkCreateSongs } = useSongsManagement(
    channelId ?? 0
  );

  const columnLabels = ADD_SONG_EXCEL_COLUMN_LABELS;
  const [sheetData, setSheetDataState] = useState<SheetRow[]>([]);
  const sheetDataRef = useRef<SheetRow[]>([]);
  // FortuneSheet 원본 입력값만 저장
  const [albumArtByKey, setAlbumArtByKey] = useState<
    Record<string, string | undefined>
  >({});

  const [isMapping, setIsMapping] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const updateSheetData = useCallback((rows: SheetRow[]): void => {
    sheetDataRef.current = rows;
    setSheetDataState(rows);
  }, []);

  const handleSheetDataChange = useCallback(
    (rows: SheetRow[]): void => {
      updateSheetData(rows);
      const summary = getExcelRowsSummary(rows, albumArtByKey);
      const eventKey = [
        summary.row_count,
        summary.rows_with_required_triplet_count,
        summary.rows_with_album_art_count,
      ].join(":");
      if (sheetRowsChangedEventKeyRef.current !== eventKey) {
        sheetRowsChangedEventKeyRef.current = eventKey;
        captureIntentEvent("channel_songbook_excel_sheet_rows_changed", {
          channel_id: channelId ?? null,
          channel_ready: isChannelReady,
          has_channel_identifier: Boolean(user),
          ...summary,
        });
      }
      setAlbumArtByKey((prev) => {
        const currentKeys = new Set(
          rows.map((row) => getSongKey(row.title, row.artist))
        );
        const nextEntries = Object.entries(prev).filter(([key]) =>
          currentKeys.has(key)
        );
        if (nextEntries.length === Object.keys(prev).length) return prev;
        return Object.fromEntries(nextEntries);
      });
    },
    [albumArtByKey, channelId, isChannelReady, updateSheetData, user]
  );

  const themeColor = useAtomValue(themeColorAtom);
  const DefaultImage = () => {
    const textColor = getContrastingTextColor(themeColor);
    return (
      <div
        style={{ backgroundColor: themeColor }}
        className="w-16 h-16 rounded-xl overflow-hidden flex items-center justify-center"
      >
        <div
          className={textColor === "black" ? "text-gray-900" : "text-gray-100"}
        >
          <MusicIcon className="w-6 h-6" />
        </div>
      </div>
    );
  };

  // 엑셀 파일 업로드 처리
  const handleUploadButtonClick = (): void => {
    captureIntentEvent("channel_songbook_excel_file_upload_clicked", {
      channel_id: channelId ?? null,
      channel_ready: isChannelReady,
      has_channel_identifier: Boolean(user),
      existing_row_count: sheetData.length,
      existing_row_count_bucket: countBucket(sheetData.length),
    });
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;

      const fileProperties = getFileSummary(file);
      captureIntentEvent("channel_songbook_excel_file_selected", {
        channel_id: channelId ?? null,
        channel_ready: isChannelReady,
        has_channel_identifier: Boolean(user),
        existing_row_count: sheetDataRef.current.length,
        existing_row_count_bucket: countBucket(sheetDataRef.current.length),
        ...fileProperties,
      });

      const fileName = file.name.toLowerCase();
      let rows: unknown[][] = [];

      if (fileName.endsWith(".csv")) {
        const text = await file.text();
        const wb = XLSX.read(text, { type: "string" });
        const firstSheetName = wb.SheetNames[0];
        const sheet = firstSheetName ? wb.Sheets[firstSheetName] : undefined;
        if (!sheet) {
          captureIntentEvent("channel_songbook_excel_file_parse_failed", {
            channel_id: channelId ?? null,
            channel_ready: isChannelReady,
            has_channel_identifier: Boolean(user),
            parse_failure_reason: "missing_sheet",
            ...fileProperties,
          });
          toast.error("파일에서 시트를 찾을 수 없습니다.");
          return;
        }
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
      } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const firstSheetName = wb.SheetNames[0];
        const sheet = firstSheetName ? wb.Sheets[firstSheetName] : undefined;
        if (!sheet) {
          captureIntentEvent("channel_songbook_excel_file_parse_failed", {
            channel_id: channelId ?? null,
            channel_ready: isChannelReady,
            has_channel_identifier: Boolean(user),
            parse_failure_reason: "missing_sheet",
            ...fileProperties,
          });
          toast.error("파일에서 시트를 찾을 수 없습니다.");
          return;
        }
        rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
      } else {
        captureIntentEvent(
          "channel_songbook_excel_file_rejected_unsupported_type",
          {
            channel_id: channelId ?? null,
            channel_ready: isChannelReady,
            has_channel_identifier: Boolean(user),
            ...fileProperties,
          }
        );
        toast.error(
          "지원하지 않는 파일 형식입니다. xlsx, xls 또는 csv를 업로드해주세요."
        );
        return;
      }

      const parseResult = parseExcelRows(rows);
      if (!parseResult.ok) {
        captureIntentEvent("channel_songbook_excel_file_parse_failed", {
          channel_id: channelId ?? null,
          channel_ready: isChannelReady,
          has_channel_identifier: Boolean(user),
          parse_failure_reason:
            parseResult.headerRowIndex < 0
              ? "header_not_found"
              : "required_header_missing",
          raw_row_count: rows.length,
          raw_row_count_bucket: countBucket(rows.length),
          ...fileProperties,
        });
        toast.error("파일 형식을 확인해주세요.", {
          description: parseResult.message,
        });
        return;
      }

      const parsedData = parseResult.rows;

      updateSheetData(parsedData);
      setAlbumArtByKey({});
      captureIntentEvent("channel_songbook_excel_file_parse_succeeded", {
        channel_id: channelId ?? null,
        channel_ready: isChannelReady,
        has_channel_identifier: Boolean(user),
        raw_row_count: rows.length,
        raw_row_count_bucket: countBucket(rows.length),
        header_row_index: parseResult.headerRowIndex,
        ...getExcelRowsSummary(parsedData),
        ...fileProperties,
      });
      // Load data into the FortuneSheet component
      sheetInputRef.current?.loadData(parsedData);
      toast.success("파일을 불러왔어요.", {
        description: `${parsedData.length}개 행이 입력되었습니다.`,
      });
    } catch (error: unknown) {
      captureIntentEvent("channel_songbook_excel_file_read_failed", {
        channel_id: channelId ?? null,
        channel_ready: isChannelReady,
        has_channel_identifier: Boolean(user),
        error_name: getErrorName(error),
      });
      toast.error("파일을 읽는 중 오류가 발생했어요.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const bulkCreateValidation = useMemo(
    () => buildBulkCreateSongs(sheetData, albumArtByKey),
    [sheetData, albumArtByKey]
  );
  const validationIssues = bulkCreateValidation.issues;
  const skippedRows = bulkCreateValidation.skippedRows;
  const registerableSongCount = bulkCreateValidation.songs.length;

  // 가벼운 파생 데이터: 미리보기/등록 시점에만 변환
  const processedData: SongFormValues[] = useMemo(() => {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[AddSongExcel] raw sheet rows (count):",
        sheetData.length,
        sheetData.slice(0, 5)
      );
    }
    const skippedRowNumbers = new Set(
      skippedRows.map((row) => row.rowNumber)
    );
    const previewRows = sheetData.filter(
      (row, index) => !skippedRowNumbers.has(row.rowNumber ?? index + 1)
    );
    const derived = toPreviewSongs(previewRows, albumArtByKey);
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[AddSongExcel] processedData (count):",
        derived.length,
        derived.slice(0, 5)
      );
    }
    return derived;
  }, [albumArtByKey, sheetData, skippedRows]);

  const handleAutoMapAlbumArt = async (): Promise<void> => {
    let candidateCount = 0;
    let chunkCount = 0;
    let completedChunkCount = 0;
    captureIntentEvent("channel_songbook_excel_album_art_auto_map_clicked", {
      channel_id: channelId ?? null,
      channel_ready: isChannelReady,
      has_channel_identifier: Boolean(user),
      ...getExcelRowsSummary(sheetDataRef.current, albumArtByKey),
    });
    try {
      setIsMapping(true);
      // 요청에 포함할 항목: title + artistName이 존재하는 것만
      const requestPairs = buildAlbumArtMappingRequests(sheetDataRef.current);
      candidateCount = requestPairs.length;

      if (requestPairs.length === 0) {
        captureIntentEvent(
          "channel_songbook_excel_album_art_auto_map_blocked_no_candidates",
          {
            channel_id: channelId ?? null,
            channel_ready: isChannelReady,
            has_channel_identifier: Boolean(user),
            candidate_count: 0,
            ...getExcelRowsSummary(sheetDataRef.current, albumArtByKey),
          }
        );
        toast.info("매핑할 곡이 없습니다. 제목과 가수를 입력해 주세요.");
        return;
      }

      // Chunk into 300 per request
      const chunkSize = 300;
      const chunks: (typeof requestPairs)[] = [];
      for (let i = 0; i < requestPairs.length; i += chunkSize) {
        chunks.push(requestPairs.slice(i, i + chunkSize));
      }
      chunkCount = chunks.length;

      captureIntentEvent("channel_songbook_excel_album_art_auto_map_submitted", {
        channel_id: channelId ?? null,
        channel_ready: isChannelReady,
        has_channel_identifier: Boolean(user),
        candidate_count: candidateCount,
        candidate_count_bucket: countBucket(candidateCount),
        chunk_count: chunkCount,
        chunk_count_bucket: countBucket(chunkCount),
        ...getExcelRowsSummary(sheetDataRef.current, albumArtByKey),
      });

      let matchedCount = 0;
      for (const [chunkIndex, chunk] of chunks.entries()) {
        const body: PostSongsAlbumArtBulkSearchRequestBody = {
          songs: chunk.map((item) => ({
            title: item.title,
            artist: item.artist,
          })),
          includeDetails: false,
          onlyMatched: true,
        };
        const data = await bulkMapAlbumArt.mutateAsync(body);
        const matchedResults = getSuccessfulAlbumArtResults(data.results);
        const applied = applyAlbumArtMappings(
          sheetDataRef.current,
          chunk,
          matchedResults
        );
        matchedCount += applied.appliedCount;
        completedChunkCount += 1;
        captureIntentEvent(
          "channel_songbook_excel_album_art_auto_map_chunk_succeeded",
          {
            channel_id: channelId ?? null,
            channel_ready: isChannelReady,
            has_channel_identifier: Boolean(user),
            chunk_index: chunkIndex,
            chunk_size: chunk.length,
            chunk_size_bucket: countBucket(chunk.length),
            chunk_matched_count: applied.appliedCount,
            chunk_matched_count_bucket: countBucket(applied.appliedCount),
            candidate_count: candidateCount,
            chunk_count: chunkCount,
          }
        );

        if (applied.appliedCount > 0) {
          updateSheetData(applied.rows);
          setAlbumArtByKey((prev) => ({
            ...prev,
            ...applied.albumArtByKey,
          }));
          try {
            sheetInputRef.current?.loadData(applied.rows);
          } catch {
            // ignore UI refresh errors
          }
        }
      }

      if (matchedCount === 0) {
        captureIntentEvent(
          "channel_songbook_excel_album_art_auto_map_completed_zero_match",
          {
            channel_id: channelId ?? null,
            channel_ready: isChannelReady,
            has_channel_identifier: Boolean(user),
            candidate_count: candidateCount,
            candidate_count_bucket: countBucket(candidateCount),
            chunk_count: chunkCount,
            completed_chunk_count: completedChunkCount,
            matched_count: 0,
          }
        );
        toast.info("매칭된 앨범아트가 없습니다.");
        return;
      }

      captureIntentEvent("channel_songbook_excel_album_art_auto_map_succeeded", {
        channel_id: channelId ?? null,
        channel_ready: isChannelReady,
        has_channel_identifier: Boolean(user),
        candidate_count: candidateCount,
        candidate_count_bucket: countBucket(candidateCount),
        chunk_count: chunkCount,
        completed_chunk_count: completedChunkCount,
        matched_count: matchedCount,
        matched_count_bucket: countBucket(matchedCount),
      });
      toast.success("앨범아트 자동 매핑 완료", {
        description: `${matchedCount}개 항목에 앨범아트를 적용했어요.`,
      });
    } catch (error: unknown) {
      captureIntentEvent("channel_songbook_excel_album_art_auto_map_failed", {
        channel_id: channelId ?? null,
        channel_ready: isChannelReady,
        has_channel_identifier: Boolean(user),
        candidate_count: candidateCount,
        candidate_count_bucket: countBucket(candidateCount),
        chunk_count: chunkCount,
        completed_chunk_count: completedChunkCount,
        error_status: getApiErrorStatus(error),
        error_name: getErrorName(error),
      });
      toast.error("앨범아트 매핑 중 오류가 발생했어요.");
    } finally {
      setIsMapping(false);
    }
  };

  const hasInputRows = sheetData.length > 0;
  const canRegister =
    isChannelReady &&
    registerableSongCount > 0 &&
    validationIssues.length === 0;

  const excelBaseProperties = useMemo(
    () => ({
      channel_id: channelId ?? null,
      channel_ready: isChannelReady,
      has_channel_identifier: Boolean(user),
      processed_song_count: processedData.length,
      processed_song_count_bucket: countBucket(processedData.length),
      can_register: canRegister,
      is_mapping: isMapping,
      is_registering: isRegistering,
      mapped_album_art_count: Object.keys(albumArtByKey).length,
      mapped_album_art_count_bucket: countBucket(Object.keys(albumArtByKey).length),
      ...getExcelRowsSummary(sheetData, albumArtByKey),
      ...getExcelValidationSummary(validationIssues),
      skipped_duplicate_count: skippedRows.length,
      skipped_duplicate_count_bucket: countBucket(skippedRows.length),
    }),
    [
      albumArtByKey,
      canRegister,
      channelId,
      isChannelReady,
      isMapping,
      isRegistering,
      processedData.length,
      sheetData,
      skippedRows.length,
      user,
      validationIssues,
    ]
  );

  useEffect(() => {
    const eventKey = `${user ?? "unknown"}:${channelId ?? "pending"}`;
    if (pageViewEventKeyRef.current === eventKey) return;
    pageViewEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_excel_add_viewed", {
      ...excelBaseProperties,
    });
  }, [channelId, excelBaseProperties, user]);

  useEffect(() => {
    if (validationIssues.length === 0) return;
    const eventKey = [
      validationIssues.length,
      validationIssues.map((issue) => issue.field).join(","),
    ].join(":");
    if (validationIssueEventKeyRef.current === eventKey) return;
    validationIssueEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_excel_validation_issues_viewed", {
      ...excelBaseProperties,
    });
  }, [excelBaseProperties, validationIssues]);

  const handleRegister = async (): Promise<void> => {
    captureIntentEvent("channel_songbook_excel_register_clicked", {
      ...excelBaseProperties,
    });
    if (!user) {
      captureIntentEvent("channel_songbook_excel_register_blocked_missing_user", {
        ...excelBaseProperties,
      });
      return;
    }
    if (!isChannelReady) {
      captureIntentEvent("channel_songbook_excel_register_blocked_channel_unready", {
        ...excelBaseProperties,
      });
      toast.error("채널 정보를 불러오는 중입니다.", {
        description: "잠시 후 다시 시도해주세요.",
      });
      return;
    }
    try {
      setIsRegistering(true);

      const { issues, songs, skippedRows: submitSkippedRows } =
        buildBulkCreateSongs(sheetData, albumArtByKey);
      if (issues.length > 0) {
        captureIntentEvent("channel_songbook_excel_register_blocked_validation", {
          ...excelBaseProperties,
          ...getExcelValidationSummary(issues),
        });
        toast.error("등록 전 입력값을 확인해주세요.", {
          description: formatValidationIssue(issues[0]),
        });
        return;
      }

      if (songs.length === 0) {
        captureIntentEvent("channel_songbook_excel_register_blocked_empty", {
          ...excelBaseProperties,
        });
        toast.info("등록할 곡이 없습니다.");
        return;
      }

      captureIntentEvent("channel_songbook_excel_register_submitted", {
        ...excelBaseProperties,
        submit_song_count: songs.length,
        submit_song_count_bucket: countBucket(songs.length),
        submit_skipped_duplicate_count: submitSkippedRows.length,
        submit_skipped_duplicate_count_bucket: countBucket(
          submitSkippedRows.length
        ),
      });
      const data = await bulkCreateSongs.mutateAsync({ songs });
      const serverSkippedCount = data.skippedCount ?? 0;
      const totalSkippedCount = submitSkippedRows.length + serverSkippedCount;

      // 등록 성공 후 입력값 초기화
      updateSheetData([]);
      setAlbumArtByKey({});
      sheetInputRef.current?.clearData();

      captureIntentEvent("channel_songbook_excel_register_succeeded", {
        ...excelBaseProperties,
        submit_song_count: songs.length,
        submit_song_count_bucket: countBucket(songs.length),
        submit_skipped_duplicate_count: submitSkippedRows.length,
        submit_skipped_duplicate_count_bucket: countBucket(
          submitSkippedRows.length
        ),
        created_song_count: data.createdCount,
        created_song_count_bucket: countBucket(data.createdCount),
        server_skipped_duplicate_count: serverSkippedCount,
        server_skipped_duplicate_count_bucket: countBucket(serverSkippedCount),
      });
      const skippedDescription =
        totalSkippedCount > 0
          ? ` 중복 ${totalSkippedCount}개는 건너뛰었어요.`
          : "";
      if (data.createdCount > 0) {
        toast.success("일괄 등록 완료", {
          description: `${data.createdCount}개 곡이 등록되었어요.${skippedDescription}`,
        });
      } else {
        toast.info("새로 등록된 곡이 없습니다.", {
          description:
            totalSkippedCount > 0
              ? `중복 ${totalSkippedCount}개를 건너뛰었어요.`
              : undefined,
        });
      }
    } catch (e) {
      captureIntentEvent("channel_songbook_excel_register_failed", {
        ...excelBaseProperties,
        error_status: getApiErrorStatus(e),
        error_name: getErrorName(e),
      });
      toast.error(
        "일괄 등록 중 오류가 발생했어요. - " +
          extractApiErrorMessage(e, "잠시 후 다시 시도해 주세요.")
      );
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 p-4 border rounded-lg h-fit z-10 bg-background overflow-x-auto max-w-full mb-4">
        <h3 className="text-lg font-semibold paperlogy">파일 가져오기</h3>
        <p className="text-sm text-muted-foreground">
          엑셀 파일을 직접 업로드하거나, 구글 스프레드시트 템플릿을 복사하여
          파일을 업로드해주세요. (파일 업로드시 기존에 입력된 데이터는 모두
          삭제됩니다.)
        </p>

        <div className="flex gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button variant="default" onClick={handleUploadButtonClick}>
            <UploadIcon className="w-4 h-4" />
            엑셀 파일 업로드
          </Button>
          <a
            href="https://cdn.meloming.com/static/%E1%84%86%E1%85%A6%E1%86%AF%E1%84%85%E1%85%A9%E1%84%86%E1%85%B5%E1%86%BC%20%E1%84%8B%E1%85%B5%E1%86%AF%E1%84%80%E1%85%AA%E1%86%AF%20%E1%84%83%E1%85%B3%E1%86%BC%E1%84%85%E1%85%A9%E1%86%A8%20%E1%84%90%E1%85%A6%E1%86%B7%E1%84%91%E1%85%B3%E1%86%AF%E1%84%85%E1%85%B5%E1%86%BA%20(ver%20250914).xlsx"
            target="_blank"
            onClick={() =>
              captureIntentEvent(
                "channel_songbook_excel_template_download_clicked",
                {
                  ...excelBaseProperties,
                }
              )
            }
          >
            <Button variant="outline">
              <DownloadIcon className="w-4 h-4" />
              템플릿 다운로드
            </Button>
          </a>
          <a
            href="https://docs.google.com/spreadsheets/d/1d9opLorKzb1C1i9XxxbHV89UjCqL5uTqC8M_JCHCg2Y/copy?usp=sharing"
            target="_blank"
            onClick={() =>
              captureIntentEvent(
                "channel_songbook_excel_spreadsheet_copy_clicked",
                {
                  ...excelBaseProperties,
                }
              )
            }
          >
            <Button
              variant="outline"
              className="bg-green-300 dark:bg-green-800 hover:bg-green-400 dark:hover:bg-green-900"
            >
              <CopyIcon className="w-4 h-4" />
              스프레드시트 템플릿 복사
            </Button>
          </a>
          <a
            href="https://docs.google.com/spreadsheets/d/1d9opLorKzb1C1i9XxxbHV89UjCqL5uTqC8M_JCHCg2Y/edit?usp=sharing"
            target="_blank"
            onClick={() =>
              captureIntentEvent(
                "channel_songbook_excel_spreadsheet_open_clicked",
                {
                  ...excelBaseProperties,
                }
              )
            }
          >
            <Button
              variant="outline"
              className="bg-green-300 dark:bg-green-800 hover:bg-green-400 dark:hover:bg-green-900"
            >
              <ExternalLinkIcon className="w-4 h-4" />
              스프레드시트 템플릿 열기
            </Button>
          </a>
        </div>
      </div>

      <div className="w-full mb-6">
        <Alert variant="indigo">
          <InfoIcon className="h-4 w-4" />
          <AlertDescription className="ml-2">
            <div className="font-semibold mb-1 text-indigo-500">
              시트 이용법
            </div>
            <div className="text-sm text-indigo-700 dark:text-indigo-300">
              <ul className="list-disc list-inside">
                <li>
                  엑셀의 첫 행은 임의로 수정하지 마세요. 예상치 못한 오류가
                  발생할 수 있습니다.
                </li>
                <li>
                  카테고리는 ,(콤마)로 구분하여 여러 개를 지정할 수 있습니다.
                </li>
                <li>
                  난이도와 숙련도는 1부터 5까지의 숫자로 입력하며, 숙련도는
                  선택 입력입니다. 숙련도 기본 사용 채널에서 비워두면 난이도
                  값으로 저장됩니다.
                </li>
                <li>앨범아트 이미지는 이미지 파일의 URL로 입력해주세요.</li>
              </ul>
            </div>
          </AlertDescription>
        </Alert>
      </div>

      {validationIssues.length > 0 && (
        <div className="w-full mb-6">
          <Alert variant="destructive">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>등록 전 수정이 필요한 항목</AlertTitle>
            <AlertDescription className="ml-2">
              <ul className="list-disc list-inside space-y-1">
                {validationIssues.slice(0, 6).map((issue, index) => (
                  <li key={`${issue.rowNumber ?? "all"}-${issue.field}-${index}`}>
                    {formatValidationIssue(issue)}
                  </li>
                ))}
              </ul>
              {validationIssues.length > 6 && (
                <p className="text-xs">
                  외 {validationIssues.length - 6}개 항목이 더 있습니다.
                </p>
              )}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {skippedRows.length > 0 && validationIssues.length === 0 && (
        <div className="w-full mb-6">
          <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertTitle>중복 곡은 건너뜁니다</AlertTitle>
            <AlertDescription className="ml-2">
              <p>
                같은 제목/아티스트 조합 {skippedRows.length}개는 등록 대상에서
                제외됩니다.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className="w-full mb-6">
        <AddSongExcelInput
          ref={sheetInputRef}
          onChange={handleSheetDataChange}
          columnLabels={columnLabels}
        />
      </div>

      {/* 우측 하단 고정 버튼 - Liquid Glass 스타일 */}
      <LiquidGlassButton
        onClick={() => {
          captureIntentEvent("channel_songbook_excel_preview_sheet_opened", {
            ...excelBaseProperties,
            open_source: "floating_cta",
          });
          setIsSheetOpen(true);
        }}
        onAttempt={(disabledReason) =>
          captureIntentEvent("channel_songbook_excel_preview_cta_clicked", {
            ...excelBaseProperties,
            disabled_reason: disabledReason ?? "none",
          })
        }
        onEmptyDialogChange={(open) =>
          captureIntentEvent(
            open
              ? "channel_songbook_excel_empty_preview_dialog_opened"
              : "channel_songbook_excel_empty_preview_dialog_closed",
            {
              ...excelBaseProperties,
            }
          )
        }
        disabledReason={!hasInputRows ? "empty" : isRegistering ? "busy" : null}
        songCount={registerableSongCount}
      />

      {/* Sheet로 미리보기 표시 */}
      <Sheet
        open={isSheetOpen}
        onOpenChange={(open) => {
          if (isSheetOpen !== open) {
            captureIntentEvent(
              open
                ? "channel_songbook_excel_preview_sheet_opened"
                : "channel_songbook_excel_preview_sheet_closed",
              {
                ...excelBaseProperties,
                open_source: "sheet_state_change",
              }
            );
          }
          setIsSheetOpen(open);
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>미리보기 및 등록</SheetTitle>
            <SheetDescription>
              {registerableSongCount > 0 ? (
                <>
                  등록 대상{" "}
                  <strong className="text-indigo-500">
                    {registerableSongCount}곡
                  </strong>
                  이 준비되었습니다.
                  {skippedRows.length > 0 ? (
                    <>
                      {" "}
                      중복 {skippedRows.length}곡은 건너뜁니다.
                    </>
                  ) : null}{" "}
                  앨범아트를 자동으로 매핑하거나 곡을 등록할 수 있습니다.
                </>
              ) : (
                "입력한 데이터를 확인하고 앨범아트를 자동으로 매핑하거나 곡을 등록할 수 있습니다."
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="">
            <AddSongExcelPreview
              processedData={processedData}
              onAutoMap={handleAutoMapAlbumArt}
              onRegister={handleRegister}
              isMapping={isMapping}
              isRegistering={isRegistering}
              canRegister={canRegister}
              validationIssues={validationIssues}
              skippedDuplicateCount={skippedRows.length}
              DefaultImage={DefaultImage}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
