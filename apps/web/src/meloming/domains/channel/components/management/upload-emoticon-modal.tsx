"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { isAxiosError } from "@/meloming/shared/lib/axios-error";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
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
import { useUploadEmoticon } from "@/meloming/domains/emoticon/hooks/use-emoticon-mutations";

const ACCEPTED_MIME = "image/png,image/webp,image/gif";
const ACCEPTED_MIME_SET = new Set(["image/png", "image/webp", "image/gif"]);
const SHORTCODE_PATTERN = /^[a-zA-Z0-9_]{2,20}$/;

// 클라이언트 측 사이즈 프리체크 (최종 검증은 서버가 수행)
const MAX_ANIMATED_BYTES = 1 * 1024 * 1024; // 1MB
const MAX_STATIC_BYTES = 256 * 1024; // 256KB

interface UploadEmoticonModalProps {
  channelId: number | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 서버가 내려주는 에러 코드 → 사용자용 메시지
function mapErrorCodeToMessage(code: string | undefined): string | null {
  switch (code) {
    case "MAX_EMOTICONS_REACHED":
      return "이모티콘은 최대 10개까지 등록할 수 있어요. 기존 이모티콘을 삭제 후 다시 시도해 주세요.";
    case "SHORTCODE_DUPLICATED":
      return "이미 사용 중인 이모티콘 코드에요. 다른 코드를 입력해 주세요.";
    case "UNSUPPORTED_FORMAT":
    case "INVALID_IMAGE":
      return "PNG, WebP, GIF 형식만 지원해요.";
    case "INVALID_SHORTCODE_FORMAT":
      return "이모티콘 코드는 영문 소문자, 숫자, _만 사용할 수 있어요 (2~20자).";
    case "INVALID_DIMENSIONS":
      return "이미지 크기는 정사각형 64~256px이어야 해요.";
    case "FILE_TOO_LARGE":
      return "파일 크기가 너무 커요. 정적 이미지 256KB, 애니메이션 1MB까지 가능해요.";
    case "TOO_MANY_FRAMES":
      return "GIF 프레임이 너무 많아요 (최대 60프레임).";
    case "PRO_REQUIRED":
      return "멜로밍 PRO 구독 후 이용할 수 있어요.";
    default:
      return null;
  }
}

export function UploadEmoticonModal({
  channelId,
  open,
  onOpenChange,
}: UploadEmoticonModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [shortcode, setShortcode] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadMutation = useUploadEmoticon(channelId);

  // 미리보기 URL — blob URL은 반드시 revoke 해야 한다
  const previewUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // 모달이 닫힐 때 내부 상태 초기화
  useEffect(() => {
    if (!open) {
      setFile(null);
      setShortcode("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [open]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_MIME_SET.has(selected.type)) {
      toast.error("PNG, WEBP, GIF만 업로드할 수 있습니다.");
      e.target.value = "";
      return;
    }
    // 애니메이션(gif) vs 정적 이미지로 사이즈 상한 분리
    const isAnimated = selected.type === "image/gif";
    const limit = isAnimated ? MAX_ANIMATED_BYTES : MAX_STATIC_BYTES;
    if (selected.size > limit) {
      toast.error(
        isAnimated
          ? "애니메이션 이모티콘은 최대 1MB까지 업로드할 수 있습니다."
          : "정적 이모티콘은 최대 256KB까지 업로드할 수 있습니다.",
      );
      e.target.value = "";
      return;
    }
    setFile(selected);
  };

  const isShortcodeValid = SHORTCODE_PATTERN.test(shortcode);
  const canSubmit =
    !!channelId &&
    !!file &&
    isShortcodeValid &&
    !uploadMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("shortcode", shortcode);

    try {
      await uploadMutation.mutateAsync(formData);
      toast.success("이모티콘을 업로드했습니다. 검수 후 사용할 수 있습니다.");
      onOpenChange(false);
    } catch (error: unknown) {
      let serverCode: string | undefined;
      if (isAxiosError(error)) {
        const payload = error.response?.data as
          | { code?: unknown; message?: unknown }
          | undefined;
        if (typeof payload?.code === "string") {
          serverCode = payload.code;
        } else if (typeof payload?.message === "string") {
          serverCode = payload.message;
        }
      }
      const mapped = mapErrorCodeToMessage(serverCode);
      const extracted = extractApiErrorMessage(error, "");
      toast.error(
        mapped ??
          extracted ??
          "이모티콘 업로드에 실패했어요. 잠시 후 다시 시도해 주세요."
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>이모티콘 업로드</DialogTitle>
          <DialogDescription>
            PNG / WEBP / GIF 파일을 업로드하면 검수 후 채널에 공개됩니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 파일 선택 + 미리보기 */}
          <div className="space-y-2">
            <Label htmlFor="emoticon-file">이미지 파일</Label>
            <div className="flex items-center gap-3">
              <div className="w-20 h-20 rounded-md border bg-muted flex items-center justify-center overflow-hidden shrink-0">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="미리보기"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImagePlus className="size-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-1">
                <Input
                  id="emoticon-file"
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_MIME}
                  onChange={handleFileSelect}
                  disabled={uploadMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  정적: 최대 256KB · 애니메이션(GIF): 최대 1MB
                </p>
              </div>
            </div>
          </div>

          {/* Shortcode 입력 */}
          <div className="space-y-2">
            <Label htmlFor="emoticon-shortcode">이모티콘 코드</Label>
            <Input
              id="emoticon-shortcode"
              value={shortcode}
              onChange={(e) => setShortcode(e.target.value)}
              placeholder="예: smile"
              maxLength={20}
              disabled={uploadMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              2~20자 영문/숫자/언더스코어. 채팅에서{" "}
              <code className="font-mono">
                :{shortcode.trim().toLowerCase() || "shortcode"}:
              </code>{" "}
              형식으로 사용됩니다.
            </p>
            {shortcode && !isShortcodeValid && (
              <p className="text-xs text-destructive">
                영문/숫자/언더스코어 2~20자로 입력해주세요.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={uploadMutation.isPending}
            >
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  업로드 중…
                </>
              ) : (
                <>
                  <Upload className="size-4" />
                  업로드
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
