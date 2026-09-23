"use client";

import { useRef } from "react";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import { Label } from "@/meloming/shared/components/ui/label";
import { useImageUpload } from "@/meloming/shared/hooks/use-image-upload";

/**
 * 업로드된 이미지에서 실제 픽셀 치수(naturalWidth/Height)를 추출.
 *
 * 업로드 직후 S3 URL 로부터 다시 로드한다. baseImageUrl + baseImageW/H 를
 * 한 번에 채우기 위한 헬퍼. `new Image()` 로드 실패 시 reject.
 */
async function getImageDimensions(
  url: string,
): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      reject(new Error("이미지 치수 확인에 실패했습니다."));
    };
    img.src = url;
  });
}

const ACCEPTED_MIME = "image/png,image/jpeg";
const ACCEPTED_MIME_SET = new Set(["image/png", "image/jpeg"]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export interface BaseImageUploadValue {
  url: string;
  width: number;
  height: number;
}

interface BaseImageUploadProps {
  label: string;
  description?: string;
  value: BaseImageUploadValue | null;
  onChange: (value: BaseImageUploadValue | null) => void;
  disabled?: boolean;
}

/**
 * 시간표 템플릿 베이스 이미지 업로드 UI.
 *
 * PNG/JPEG 만 허용 (MVP). PSD 는 서버 측 파싱이 필요해 향후 지원.
 * 업로드 완료 시 `{ url, width, height }` 를 한꺼번에 상위에 전달한다 —
 * 슬롯 좌표계가 baseImageW/H 기준이므로 URL 과 치수를 분리해 저장하면
 * 편집/렌더 단계에서 불일치가 생길 수 있어 원자 단위로 다룬다.
 */
export function BaseImageUpload({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: BaseImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadImage, isUploading } = useImageUpload();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = e.target.files?.[0];

    // input 초기화는 모든 경로에서 보장 (같은 파일을 다시 선택할 수 있게).
    // 클로저 내부에서 stale `e.currentTarget` 을 참조하지 않도록 변수로 캐시.
    const resetInput = () => {
      input.value = "";
    };

    if (!file) return;

    if (!ACCEPTED_MIME_SET.has(file.type)) {
      toast.error("PNG 또는 JPEG 이미지만 업로드할 수 있습니다.");
      resetInput();
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("파일 크기는 10MB 이하여야 합니다.");
      resetInput();
      return;
    }

    // 1) 업로드 자체 실패는 useImageUpload 훅이 이미 toast 처리. 여기서는
    //    추가 toast 없이 조용히 종료 (중복 토스트 방지).
    let uploaded: Awaited<ReturnType<typeof uploadImage>>;
    try {
      uploaded = await uploadImage(file);
    } catch {
      resetInput();
      return;
    }

    // 2) 치수 추출 실패는 업로드는 성공한 상태이므로 별도 안내 필요.
    try {
      const { w, h } = await getImageDimensions(uploaded.imageUrl);
      onChange({ url: uploaded.imageUrl, width: w, height: h });
    } catch {
      toast.error("이미지 치수를 확인할 수 없어요. 다시 시도해 주세요.");
    } finally {
      resetInput();
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_MIME}
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || isUploading}
      />

      {value ? (
        <div className="relative group rounded-lg overflow-hidden border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.url}
            alt={label}
            className="w-full max-h-64 object-contain bg-muted"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || disabled}
            >
              {isUploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Camera className="size-4" />
              )}
              변경
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => onChange(null)}
              disabled={isUploading || disabled}
            >
              <Trash2 className="size-4" />
              제거
            </Button>
          </div>
          <div className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white tabular-nums">
            {value.width} × {value.height}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || disabled}
          className="w-full min-h-[8rem] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <>
              <ImagePlus className="size-6" />
              <span className="text-xs">클릭하여 업로드</span>
              <span className="text-[10px]">PNG / JPEG (최대 10MB)</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
