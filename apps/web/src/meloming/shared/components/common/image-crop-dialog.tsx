import { useCallback, useMemo, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Slider } from "@/meloming/shared/components/ui/slider";

export interface ImageCropDialogProps {
  open: boolean;
  imageSrc: string | null;
  aspect?: number;
  description?: string;
  outputType?: "image/jpeg" | "image/png" | "image/webp";
  quality?: number; // 0~1
  onOpenChange?: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

/**
 * Canvas로 이미지를 잘라 Blob으로 반환
 */
async function getCroppedBlob(
  imageSrc: string,
  croppedAreaPixels: Area,
  outputType: NonNullable<ImageCropDialogProps["outputType"]>,
  quality: number
): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const width = Math.round(croppedAreaPixels.width);
  const height = Math.round(croppedAreaPixels.height);
  canvas.width = width;
  canvas.height = height;

  ctx.drawImage(
    image,
    Math.round(croppedAreaPixels.x),
    Math.round(croppedAreaPixels.y),
    width,
    height,
    0,
    0,
    width,
    height
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      outputType,
      quality
    );
  });
  return blob;
}

export function ImageCropDialog({
  open,
  imageSrc,
  aspect = 1,
  description = "정사각형으로 잘라서 프로필에 사용할 수 있습니다.",
  outputType = "image/jpeg",
  quality = 0.92,
  onOpenChange,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const canConfirm = useMemo(
    () => Boolean(imageSrc && croppedAreaPixels),
    [imageSrc, croppedAreaPixels]
  );

  const handleCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    const blob = await getCroppedBlob(
      imageSrc,
      croppedAreaPixels,
      outputType,
      quality
    );
    onConfirm(blob);
  }, [imageSrc, croppedAreaPixels, onConfirm, outputType, quality]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>이미지 편집</DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="relative h-[320px] w-full overflow-hidden rounded-md bg-muted/50">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
              objectFit="contain"
              restrictPosition={false}
            />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Zoom</span>
            <span>{zoom.toFixed(2)}x</span>
          </div>
          <Slider
            min={1}
            max={3}
            step={0.01}
            value={[zoom]}
            onValueChange={(v) => setZoom(v[0] ?? 1)}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            취소
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ImageCropDialog;
