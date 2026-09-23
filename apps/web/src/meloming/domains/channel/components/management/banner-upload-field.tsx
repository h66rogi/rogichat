"use client";

import { useRef } from "react";
import { Camera, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Label } from "@/meloming/shared/components/ui/label";
import { useImageUpload } from "@/meloming/shared/hooks/use-image-upload";
import { toast } from "sonner";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface BannerUploadFieldProps {
  label: string;
  description?: string;
  imageUrl: string | null;
  onImageChange: (url: string | null) => void;
  previewClassName?: string;
  disabled?: boolean;
}

export function BannerUploadField({
  label,
  description,
  imageUrl,
  onImageChange,
  previewClassName = "w-full h-32",
  disabled = false,
}: BannerUploadFieldProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadImage, isUploading } = useImageUpload({
    onSuccess: (data) => onImageChange(data.imageUrl),
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("파일 크기는 10MB 이하여야 합니다.");
      return;
    }

    await uploadImage(file);
    e.currentTarget.value = "";
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}

      {imageUrl ? (
        <div className="relative group rounded-lg overflow-hidden border">
          <img
            src={imageUrl}
            alt={label}
            className={`${previewClassName} object-cover`}
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || disabled}
            >
              {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              변경
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => onImageChange(null)}
              disabled={disabled}
            >
              <Trash2 className="size-4" />
              제거
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={`${previewClassName} rounded-lg border-2 border-dashed flex items-center justify-center transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/50"}`}
          onClick={() => !isUploading && !disabled && fileInputRef.current?.click()}
        >
          {isUploading ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <Camera className="size-6" />
              <span className="text-xs">클릭하여 업로드</span>
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
