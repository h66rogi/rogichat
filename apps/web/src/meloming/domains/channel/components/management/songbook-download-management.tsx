"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Download, FileSpreadsheet, Music } from "lucide-react";
import { toast } from "sonner";
import { exportSongsToCSV } from "@/meloming/domains/channel/apis/songs";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import { usePublicUserSongs } from "@/meloming/domains/channel/hooks/use-songs";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/meloming/shared/components/ui/card";
import { ManagementHeader } from "./management-header";
import {
  countBucket,
  fileSizeBucket,
  getApiErrorStatus,
  getErrorName,
} from "./songbook-analytics";

const CSV_FIELDS = [
  "노래 제목",
  "아티스트",
  "카테고리",
  "난이도",
  "숙련도",
] as const;

export function SongbookDownloadManagement({ user }: { user: string }) {
  const [isExporting, setIsExporting] = useState(false);
  const hasCapturedView = useRef(false);
  const { data: channel } = useChannel(user);
  const { data: songsData, isLoading } = usePublicUserSongs(user, {
    page: 1,
    limit: 1,
  });
  const totalCount = songsData?.total ?? 0;

  useEffect(() => {
    if (hasCapturedView.current || !channel || isLoading) return;
    hasCapturedView.current = true;
    captureIntentEvent("channel_songbook_download_page_viewed", {
      channel_id: channel.id,
      song_count_bucket: countBucket(totalCount),
    });
  }, [channel, isLoading, totalCount]);

  const handleDownload = async () => {
    if (isExporting || totalCount === 0) return;

    captureIntentEvent("channel_songbook_download_submitted", {
      channel_id: channel?.id ?? null,
      song_count_bucket: countBucket(totalCount),
    });

    try {
      setIsExporting(true);
      const blob = await exportSongsToCSV(user);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `songs_${channel?.name ?? user}_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      captureIntentEvent("channel_songbook_download_succeeded", {
        channel_id: channel?.id ?? null,
        song_count_bucket: countBucket(totalCount),
        csv_blob_size_bucket: fileSizeBucket(blob.size),
        csv_blob_type: blob.type || "unknown",
      });
      toast.success("노래책 다운로드 완료");
    } catch (error: unknown) {
      captureIntentEvent("channel_songbook_download_failed", {
        channel_id: channel?.id ?? null,
        song_count_bucket: countBucket(totalCount),
        error_status: getApiErrorStatus(error),
        error_name: getErrorName(error),
      });
      toast.error("다운로드 실패", {
        description: "잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-6">
      <ManagementHeader
        title="노래책 다운로드"
        description="등록한 노래 목록을 CSV 파일로 간편하게 보관하세요."
        icon={Download}
      />

      <div className="mx-auto max-w-2xl">
        <Card className="gap-0 overflow-hidden border-primary/20 py-0 shadow-md">
          <CardHeader className="border-b border-primary/10 bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 px-6 py-6 sm:px-7">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <FileSpreadsheet className="size-6" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-xl">
                  {channel?.name ?? "내 채널"} 노래책
                </CardTitle>
                <CardDescription className="mt-2">
                  {isLoading
                    ? "등록된 노래 수를 확인하고 있어요."
                    : totalCount > 0
                      ? `등록된 노래 ${totalCount.toLocaleString()}곡을 다운로드할 수 있어요.`
                      : "다운로드할 노래가 아직 없어요."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 px-6 py-6 sm:px-7 sm:py-7">
            <div>
              <p className="mb-3 text-sm font-semibold">CSV에 포함되는 정보</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {CSV_FIELDS.map((field) => (
                  <li
                    key={field}
                    className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-sm text-foreground"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Check className="size-3.5 text-primary" />
                    </span>
                    {field}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/50 p-4 text-sm leading-6 text-muted-foreground">
              CSV 파일은 Excel, Numbers, Google 스프레드시트에서 열 수 있습니다.
              개인 데이터 보관 목적으로 이용해주세요.
            </div>

            <Button
              size="lg"
              className="h-12 w-full text-base shadow-sm"
              onClick={handleDownload}
              disabled={isLoading || isExporting || totalCount === 0}
            >
              {isExporting ? (
                "다운로드 중..."
              ) : (
                <>
                  <Download className="size-5" />
                  CSV 파일 다운로드
                </>
              )}
            </Button>

            {totalCount === 0 && !isLoading && (
              <Button variant="outline" className="w-full" asChild>
                <Link href={`/channel/${user}/manage/add-song`}>
                  <Music className="size-4" />
                  노래 추가하기
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
