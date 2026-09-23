"use client";

import { useState } from "react";
import { appendSongsChannelIdentifierSongIdSheetMusic } from "@/meloming/domains/channel/apis/songs";
import { isAxiosError } from "@/meloming/shared/lib/axios-error";
import type { SheetMusicSlot } from "@/meloming/domains/channel/types/song";
import { detectSheetMusicType } from "./utils/detectSheetMusicType";
import { SheetMusicDropzone } from "./SheetMusicDropzone";

export interface SheetMusicUploaderProps {
  /** 업로드 대상 채널 식별자 (webPath). Round 2 새 endpoint 경로 파라미터. */
  channelIdentifier: string;
  /** 업로드 대상 곡 ID. Round 2 새 endpoint 경로 파라미터. */
  songId: number;
  /**
   * Phase 2: 슬롯 추가 성공 후 호출. 부모가 slots state 에 append 하고 currentIndex 이동.
   */
  onSlotAdded: (slot: SheetMusicSlot) => void;
  className?: string;
}

const MAX_SIZE = 30 * 1024 * 1024;

/**
 * 백엔드 에러 응답을 사용자 친화 한국어 메시지로 변환. 큐 업로드 시 파일 단위
 * 실패 reason 으로도 그대로 사용.
 */
function explainError(fileName: string, e: unknown): string {
  const maybeAxios = e as { code?: string; message?: string } | undefined;
  const isTimeout =
    maybeAxios?.code === 'ECONNABORTED' ||
    (typeof maybeAxios?.message === 'string' &&
      maybeAxios.message.toLowerCase().includes('timeout'));
  if (isTimeout) {
    return `${fileName} (업로드 시간 초과)`;
  }
  if (isAxiosError(e)) {
    const status = e.response?.status;
    const data = e.response?.data as
      | { code?: string; message?: string }
      | undefined;
    const code = data?.code;
    if (typeof code === 'string' && code.startsWith('mxl_')) {
      return `${fileName} (MusicXML 파일을 열 수 없음)`;
    }
    if (code === 'sheet_music_capacity_exceeded') {
      return '곡당 악보 슬롯은 최대 10개까지 등록할 수 있습니다.';
    }
    if (status === 413) {
      return `${fileName} (30MB 초과)`;
    }
    if (code === 'unsupported_or_mismatched') {
      return `${fileName} (지원하지 않는 형식)`;
    }
    return `${fileName} (업로드 실패)`;
  }
  return `${fileName} (네트워크 오류)`;
}

export function SheetMusicUploader({
  channelIdentifier,
  songId,
  onSlotAdded,
  className,
}: SheetMusicUploaderProps) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 선택된 한 파일을 업로드 후 결과 반환. 큐에서 호출.
   *  - return slot if success
   *  - return Error description if fail
   */
  async function uploadOne(
    file: File,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (file.size > MAX_SIZE) {
      return { ok: false, reason: `${file.name} (30MB 초과)` };
    }
    const detected = detectSheetMusicType(file.type, file.name);
    if (!detected) {
      return { ok: false, reason: `${file.name} (지원하지 않는 형식)` };
    }
    try {
      const slot = await appendSongsChannelIdentifierSongIdSheetMusic(
        channelIdentifier,
        songId,
        file,
        {
          onProgress: (percent) => setProgress(percent ?? 0),
        },
      );
      onSlotAdded(slot);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: explainError(file.name, e) };
    }
  }

  /**
   * Phase 2 Step 2 — multiple 파일을 순차 큐로 업로드. 한 파일 실패해도 나머지
   * 시도. 끝나고 실패 목록은 error 메시지로 종합 안내.
   */
  async function handleFiles(files: File[]) {
    setError(null);
    if (files.length === 0) return;

    const failures: string[] = [];
    setProgress(0);
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const queueSuffix =
        files.length > 1 ? ` (${i + 1}/${files.length})` : '';
      setError(`업로드 중${queueSuffix}…`);
      const result = await uploadOne(file);
      if (!result.ok) failures.push(result.reason);
    }

    setTimeout(() => setProgress(null), 500);

    if (failures.length === 0) {
      setError(null);
    } else if (failures.length === files.length) {
      setError(failures[0]!);
    } else {
      setError(
        `${files.length - failures.length}/${files.length} 업로드 완료. 실패: ${failures.join(', ')}`,
      );
    }
  }

  return (
    <SheetMusicDropzone
      onFilesSelect={(files) => void handleFiles(files)}
      ariaLabel="악보 파일 업로드"
      className={className}
      multiple
    >
      <p className="text-sm text-muted-foreground">
        악보 파일을 드래그하거나 클릭하여 업로드 (PDF / 이미지 / MusicXML, 30MB
        이하 · 한 번에 여러 장 가능)
      </p>
      {progress !== null && (
        <div className="mt-3">
          <div
            className="h-2 bg-muted rounded overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label="악보 업로드 진행률"
          >
            <div
              className="h-full bg-primary rounded motion-safe:transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/*
            B2: progress 변경마다 announce 되면 스크린리더가 "업로드 중 1%, 2%…"
            로 verbose 해진다. role=progressbar + aria-valuenow 가 표준 채널이라
            텍스트 자체는 시각만 (aria-hidden) 으로 두고, 별도 sr-only 영역에서
            phase 전환 (업로드 중 → 처리 중) 만 한 번씩 announce.
          */}
          <p className="mt-1 text-xs text-muted-foreground" aria-hidden="true">
            {progress === 100 ? "처리 중..." : `업로드 중... ${progress}%`}
          </p>
          <span className="sr-only" aria-live="polite">
            {progress === 100 ? "업로드 완료, 처리 중" : "업로드 중"}
          </span>
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </SheetMusicDropzone>
  );
}
