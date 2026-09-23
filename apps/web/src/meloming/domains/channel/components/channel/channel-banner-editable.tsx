"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useImageUpload } from "@/meloming/shared/hooks/use-image-upload";
import { putChannelIdentifier } from "@/meloming/domains/channel/apis/channels";
import { useQueryClient } from "@tanstack/react-query";
import { channelKeys } from "@/meloming/domains/channel/hooks/use-channel";
import type { Channel } from "@/meloming/domains/channel/types/channel";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface ChannelBannerEditableProps {
  identifier: string;
  channel: Channel;
  canEdit: boolean;
}

/**
 * 분리형 채널 상단 배너 (클라이언트 컴포넌트)
 * 소유자/관리자일 경우 호버 시 편집 오버레이 표시
 */
export function ChannelBannerEditable({
  identifier,
  channel,
  canEdit,
}: ChannelBannerEditableProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [localBannerUrl, setLocalBannerUrl] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const { uploadImage, isUploading } = useImageUpload();

  const isBusy = isUploading || isUpdating;
  const displayBannerUrl = localBannerUrl ?? channel.topBannerUrl;

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

    try {
      const { imageUrl } = await uploadImage(file);
      setLocalBannerUrl(imageUrl);
      setIsUpdating(true);
      await putChannelIdentifier(identifier, {
        name: channel.name,
        webPath: channel.webPath,
        platformUrl: channel.platformUrl ?? "",
        profileImageUrl: channel.profileImageUrl,
        topBannerUrl: imageUrl,
        leftBannerUrl: channel.leftBannerUrl,
        leftBannerLink: channel.leftBannerLink,
        rightBannerUrl: channel.rightBannerUrl,
        rightBannerLink: channel.rightBannerLink,
        additionalLinks: channel.additionalLinks,
        themeColor: channel.themeColor,
        channelDescription: channel.channelDescription,
      });
      queryClient.invalidateQueries({ queryKey: channelKeys.identifier(identifier) });
      router.refresh();
      toast.success("상단 배너가 변경되었습니다.");
    } catch {
      setLocalBannerUrl(null);
      toast.error("배너 변경에 실패했습니다.");
    } finally {
      setIsUpdating(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="relative overflow-hidden rounded-xl group">
      {displayBannerUrl ? (
        <div style={{ backgroundColor: channel.themeColor }}>
          <img
            src={displayBannerUrl}
            alt={`${channel.name} 상단 배너`}
            className="w-full h-48 object-cover"
          />
        </div>
      ) : (
        <div
          className="w-full h-48"
          style={{ backgroundColor: channel.themeColor }}
        />
      )}

      {canEdit && (
        <>
          <div
            className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors cursor-pointer flex items-center justify-center"
            onClick={() => !isBusy && fileInputRef.current?.click()}
          >
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center gap-2 text-white">
              {isBusy ? (
                <Loader2 className="size-8 animate-spin" />
              ) : (
                <>
                  <Camera className="size-8" />
                  <span className="text-sm font-medium">배너 변경</span>
                </>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </>
      )}
    </div>
  );
}
