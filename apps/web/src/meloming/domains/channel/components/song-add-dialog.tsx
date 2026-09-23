"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Music, Plus } from "lucide-react";
import { AddSongManualContent } from "@/meloming/domains/channel/components/management/add-song-manual-content";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SongAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 채널 identifier (webPath) */
  channelIdentifier: string;
  /** 채널 ID */
  channelId: number;
  onSuccess?: () => void;
  /**
   * GlobalSong 페이지에서 열릴 때 전달. 있으면 submit 시 quick-add API로 가서
   * Song.globalSongId 매핑이 즉시 박힌다. 없으면 기존 free-form createSong 경로.
   */
  globalSongId?: number;
  /** prefill — title/artistName/albumArt 자동 입력 (사용자가 수정 가능). */
  prefillTitle?: string;
  prefillArtistName?: string;
  prefillAlbumArt?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SongAddDialog({
  open,
  onOpenChange,
  channelIdentifier,
  channelId,
  onSuccess,
  globalSongId,
  prefillTitle,
  prefillArtistName,
  prefillAlbumArt,
}: SongAddDialogProps) {
  const handleSuccess = () => {
    onOpenChange(false);
    onSuccess?.();
  };

  const isGlobalSongMode = globalSongId !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <Plus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Music className="size-5" />
                {isGlobalSongMode ? "내 노래책에 추가" : "노래 추가"}
              </div>
              <p className="text-sm text-muted-foreground font-normal mt-1">
                {isGlobalSongMode
                  ? "곡 정보가 자동으로 채워졌어요. 카테고리와 추가 정보를 입력하고 저장하세요."
                  : "노래 정보를 직접 입력해서 노래책에 추가해보세요."}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">
            노래 정보를 입력하여 채널의 노래책에 추가합니다.
          </DialogDescription>
        </DialogHeader>

        <AddSongManualContent
          channelIdentifier={channelIdentifier}
          channelIdProp={channelId}
          onSuccess={handleSuccess}
          hideSaveAndContinue={true}
          globalSongId={globalSongId}
          prefillTitle={prefillTitle}
          prefillArtistName={prefillArtistName}
          prefillAlbumArt={prefillAlbumArt}
        />
      </DialogContent>
    </Dialog>
  );
}
