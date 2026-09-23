"use client";

import { X, Music, Crown } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/meloming/shared/components/ui/avatar";

export interface TaggedChannelItem {
  channelId: number;
  channelName: string;
  webPath: string;
  profileImageUrl: string | null;
  songId: number;
  songTitle: string;
  artistName: string;
}

interface TaggedChannelsListProps {
  channels: TaggedChannelItem[];
  onRemove: (channelId: number) => void;
  /** 메인 채널 ID (제거 불가 표시용) */
  primaryChannelId?: number;
}

export function TaggedChannelsList({
  channels,
  onRemove,
  primaryChannelId,
}: TaggedChannelsListProps) {
  if (channels.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {channels.map((channel) => {
        const isPrimary = channel.channelId === primaryChannelId;

        return (
          <div
            key={channel.channelId}
            className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border"
          >
            {/* 채널 아바타 */}
            <div className="relative">
              <Avatar className="size-8 shrink-0">
                <AvatarImage src={channel.profileImageUrl ?? undefined} />
                <AvatarFallback className="text-xs">
                  {channel.channelName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {isPrimary && (
                <div className="absolute -top-1 -right-1">
                  <Crown className="size-3.5 text-amber-500" />
                </div>
              )}
            </div>

            {/* 채널 정보 */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate flex items-center gap-1">
                {channel.channelName}
                {isPrimary && (
                  <span className="text-xs text-muted-foreground">(메인)</span>
                )}
              </p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Music className="size-3" />
                <span className="truncate">
                  {channel.songTitle} - {channel.artistName}
                </span>
              </div>
            </div>

            {/* 삭제 버튼 (메인 채널은 비활성화) */}
            {!isPrimary && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(channel.channelId)}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
