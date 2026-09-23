import { useCallback, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import clsx from "clsx";

interface ImageDropzoneProps {
  onFileSelected: (file: File) => void;
  isUploading?: boolean;
  uploadedImageUrl?: string;
  onRemove?: () => void;
  maxSizeMB?: number;
  accept?: string;
}

/**
 * 이미지 업로드를 위한 Dropzone 컴포넌트
 * - Drag & Drop 지원
 * - 클릭하여 파일 선택
 * - 미리보기
 */
export function ImageDropzone({
  onFileSelected,
  isUploading = false,
  uploadedImageUrl,
  onRemove,
  maxSizeMB = 10,
  accept = "image/*",
}: ImageDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback(
    (file: File): string | null => {
      // 파일 타입 검증
      if (!file.type.startsWith("image/")) {
        return "이미지 파일만 업로드 가능합니다.";
      }

      // 파일 크기 검증
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxSizeBytes) {
        return `파일 크기는 ${maxSizeMB}MB 이하여야 합니다.`;
      }

      return null;
    },
    [maxSizeMB]
  );

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      const validationError = validateFile(file);

      if (validationError) {
        setError(validationError);
        return;
      }

      onFileSelected(file);
    },
    [validateFile, onFileSelected]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
      // input을 리셋하여 같은 파일을 다시 선택할 수 있도록 함
      e.target.value = "";
    },
    [handleFile]
  );

  const handleClick = useCallback(() => {
    if (!isUploading) {
      inputRef.current?.click();
    }
  }, [isUploading]);

  // 업로드된 이미지가 있으면 미리보기 표시
  if (uploadedImageUrl) {
    return (
      <div className="relative">
        <div className="border-2 border-dashed border-border rounded-lg p-2 bg-background">
          <div className="flex items-center gap-2">
            <img
              src={uploadedImageUrl}
              alt="업로드된 이미지"
              className="w-12 h-12 object-cover rounded"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">업로드 완료</p>
            </div>
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemove}
                disabled={isUploading}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={clsx(
          "border-2 border-dashed rounded-lg p-3 transition-colors cursor-pointer",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-background hover:border-primary/50",
          isUploading && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className="flex flex-col items-center justify-center gap-1.5 text-center">
          {isUploading ? (
            <>
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
              <p className="text-xs font-medium">업로드 중...</p>
            </>
          ) : (
            <>
              <p className="text-xs font-medium">
                {isDragging
                  ? "여기에 이미지를 놓아주세요"
                  : "클릭하거나 드래그하여 이미지 업로드"}
              </p>
              <p className="text-xs text-muted-foreground">
                {maxSizeMB}MB 이하
              </p>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFileInput}
          className="hidden"
          disabled={isUploading}
        />
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
          <X className="w-3 h-3" />
          {error}
        </p>
      )}
    </div>
  );
}
