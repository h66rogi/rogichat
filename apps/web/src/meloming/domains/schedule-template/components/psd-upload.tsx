"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileImage, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import { Label } from "@/meloming/shared/components/ui/label";
import {
  useParsePsd,
  type UseParsePsdVariables,
} from "@/meloming/domains/schedule-template/hooks";
import type { ParsePsdResponse } from "@/meloming/domains/schedule-template/types";
import { classifyPsdParseError } from "@/meloming/domains/schedule-template/utils/psd-parse-error";
import { PsdWarningsDialog } from "./psd-warnings-dialog";

/**
 * Photoshop ships two related document formats from the same lineage:
 *   .psd — standard Photoshop document (header version 1)
 *   .psb — Large Document Format (header version 2, used by designers when
 *          their template exceeds PSD's 2GB / 30000px ceiling)
 * The backend's worker validates the 26-byte 8BPS header and accepts both
 * version=1 and version=2, so accepting .psb at the input is safe — the
 * binary check is the real defense, the extension is just a fast reject.
 */
const ACCEPTED_EXTS = [".psd", ".psb"] as const;
// `accept` attribute fed to <input type="file">. We list the two extensions
// plus the IANA mimetype Adobe registered for PSD (PSB shares it). We also
// include `application/octet-stream` as a fallback because some browsers /
// OSes report unknown binary types that way for .psd / .psb.
const ACCEPTED_INPUT_FILTER =
  ".psd,.psb,image/vnd.adobe.photoshop,application/octet-stream";
/**
 * 클라이언트 측 size warning. 300MB 초과여도 즉시 막진 않고 안내만 한다 —
 * 서버가 PSD_OVERSIZED 로 최종 판정해야 일관된 UX 가 된다.
 *
 * 단, 너무 큰 파일을 그대로 업로드 시도하면 네트워크 손해이므로 상한은 두고,
 * 아주 미세한 초과 (예: 305MB) 는 그대로 시도시킨다.
 */
const SIZE_WARN_THRESHOLD = 300 * 1024 * 1024;
const SIZE_HARD_LIMIT = 350 * 1024 * 1024;

export interface PsdUploadProps {
  /**
   * 파싱 성공 시 호출. 부모는 form 의 다른 필드 (이름, baseImage*, templateSpec)
   * 를 채우고 사용자를 다음 단계로 보낸다.
   */
  onParsed: (result: ParsePsdResponse, file: File) => void;
  /**
   * 외부 disabled (예: 부모 form 이 제출 중). 업로드 자체는 disable 되며
   * 진행 중인 업로드는 abort 되지 않는다.
   */
  disabled?: boolean;
}

/**
 * PSD 업로드 + 파싱 UI (F8 Phase 1).
 *
 * 동작:
 *  1) `.psd` / `.psb` 만 파일 선택 가능 (PSB 는 Large Document Format).
 *     다른 확장자는 즉시 toast 로 안내.
 *  2) 선택 시 즉시 `useParsePsd` 호출. 진행 중에는 spinner + 취소 버튼.
 *  3) 성공: warnings 가 있으면 toast.warning + "자세히 보기" 다이얼로그.
 *           이후 `onParsed(result, file)` 호출.
 *  4) 실패:
 *     - PSD_QUEUE_FULL: toast.warning + "다시 시도" 액션. 액션을 누르면
 *       서버가 보낸 Retry-After 만큼 대기한 뒤 자동 1회 재시도 (silent).
 *       재시도가 또 실패하면 일반 에러 toast.
 *     - 그 외: 에러 코드별 메시지 매핑 후 toast.error.
 *  5) 사용자 취소(AbortController.abort): toast 없이 idle 상태로 복귀.
 *
 * 컴포넌트 자체는 PSD 파싱 결과를 보존하지 않는다. 부모 (create dialog) 에서
 * `onParsed` 으로 받아 form/state 에 반영한다 — value/onChange 패턴이 아니라
 * "이벤트 발신기" 로 다루는 편이 컴포넌트 책임 분리에 자연스럽기 때문.
 */
export function PsdUpload({ onParsed, disabled = false }: PsdUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 마운트 해제 후 setState 를 막기 위한 플래그. axios 응답이 unmount 이후에
  // 도착하더라도 React 가 dev 환경에서 경고를 띄우지 않도록 한다.
  const isMountedRef = useRef(true);
  const mutation = useParsePsd();

  const [warningsToShow, setWarningsToShow] = useState<string[] | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const isParsing = mutation.isPending;
  const isDisabled = disabled || isParsing;

  const runParse = useCallback(
    async (variables: UseParsePsdVariables) => {
      return mutation.mutateAsync(variables);
    },
    [mutation]
  );

  const handleParseError = useCallback(
    (error: unknown, file: File, signal: AbortSignal) => {
      const info = classifyPsdParseError(error);

      if (info.kind === "ABORTED") {
        // 사용자가 취소한 경우 toast 없음 — UX 잡음 방지.
        return;
      }

      if (info.kind === "PSD_QUEUE_FULL") {
        // 503: queue full → 사용자가 명시적으로 "다시 시도" 누르면 silent 재시도 1회.
        const retryAfterMs = (info.retryAfterSec ?? 5) * 1000;
        toast.warning(info.message, {
          action: {
            label: "다시 시도",
            onClick: () => {
              // 마운트 해제됐으면 무시. 새 abort signal 도 살아있어야 함.
              if (!isMountedRef.current || signal.aborted) return;
              window.setTimeout(() => {
                if (!isMountedRef.current || signal.aborted) return;
                runParse({ file, signal })
                  .then((result) => {
                    if (!isMountedRef.current) return;
                    handleSuccess(result, file);
                  })
                  .catch((retryError) => {
                    if (!isMountedRef.current) return;
                    const retryInfo = classifyPsdParseError(retryError);
                    if (retryInfo.kind !== "ABORTED") {
                      toast.error(retryInfo.message);
                    }
                  });
              }, retryAfterMs);
            },
          },
        });
        return;
      }

      toast.error(info.message);
    },
    // handleSuccess / runParse 는 클로저 안에서 동일 인스턴스 사용. 의존성 누락 X.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runParse]
  );

  const handleSuccess = useCallback(
    (result: ParsePsdResponse, file: File) => {
      if (result.warnings && result.warnings.length > 0) {
        const first = result.warnings[0];
        const remaining = result.warnings.length - 1;
        toast.warning(
          remaining > 0
            ? `경고 ${result.warnings.length}건: ${first} 외 ${remaining}건`
            : `경고: ${first}`,
          {
            action: {
              label: "자세히 보기",
              onClick: () => {
                if (!isMountedRef.current) return;
                setWarningsToShow(result.warnings);
              },
            },
          }
        );
      }

      onParsed(result, file);
    },
    [onParsed]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const file = e.target.files?.[0];

      // input 초기화는 모든 경로에서 보장 — 같은 파일 재선택 가능하게.
      const resetInput = () => {
        input.value = "";
      };

      if (!file) return;

      const lowered = file.name.toLowerCase();
      if (!ACCEPTED_EXTS.some((ext) => lowered.endsWith(ext))) {
        toast.error(".psd 또는 .psb 확장자 파일만 업로드 가능합니다.");
        resetInput();
        return;
      }

      if (file.size > SIZE_HARD_LIMIT) {
        toast.error(
          "파일이 너무 큽니다(최대 300MB). 더 작게 export 해 주세요."
        );
        resetInput();
        return;
      }

      // SIZE_WARN_THRESHOLD ~ SIZE_HARD_LIMIT 사이는 서버 판정에 위임하지만
      // 사용자에게 미리 알린다 (네트워크 시간 낭비 위험을 감수했음을 안내).
      if (file.size > SIZE_WARN_THRESHOLD) {
        toast.warning(
          "PSD 파일이 300MB를 초과합니다. 서버가 거부할 수 있어요."
        );
      }

      // 새 abort controller — 이전 진행분이 있다면 정리.
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const result = await runParse({ file, signal: controller.signal });
        if (!isMountedRef.current) return;
        handleSuccess(result, file);
      } catch (error) {
        if (!isMountedRef.current) return;
        handleParseError(error, file, controller.signal);
      } finally {
        resetInput();
      }
    },
    [handleParseError, handleSuccess, runParse]
  );

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  return (
    <div className="space-y-2">
      <Label>PSD 업로드</Label>
      <p className="text-xs text-muted-foreground">
        Photoshop PSD/PSB 파일을 업로드하면 텍스트 레이어가 자동으로 슬롯으로
        추출됩니다. (최대 300MB, 8-bit)
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_INPUT_FILTER}
        className="hidden"
        onChange={handleFileChange}
        disabled={isDisabled}
        data-testid="psd-upload-input"
      />

      {isParsing ? (
        <div className="w-full min-h-[10rem] rounded-lg border-2 border-dashed border-primary/40 bg-muted/30 flex flex-col items-center justify-center gap-3 p-4">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm font-medium">PSD를 변환하는 중…</p>
          <p className="text-xs text-muted-foreground text-center">
            텍스트 레이어를 추출하고 있어요. 최대 30초까지 걸릴 수 있어요.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
          >
            <X className="size-4" />
            취소
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isDisabled}
            className="w-full min-h-[8rem] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileImage className="size-6" />
            <span className="text-xs font-medium">클릭하여 PSD 업로드</span>
            <span className="text-[10px]">.psd · .psb · 최대 300MB · 8-bit</span>
          </button>
          {mutation.isError && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <RotateCcw className="size-4" />
              다른 PSD 다시 선택
            </Button>
          )}
        </div>
      )}

      <PsdWarningsDialog
        warnings={warningsToShow}
        onClose={() => setWarningsToShow(null)}
      />
    </div>
  );
}
