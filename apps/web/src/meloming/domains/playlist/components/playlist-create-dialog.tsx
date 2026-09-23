"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Label } from "@/meloming/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { useCreatePlaylist } from "@/meloming/domains/playlist/hooks/use-playlists";
import type { PlaylistVisibility } from "@/meloming/domains/playlist/types/playlist";
import { toast } from "sonner";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";

interface PlaylistCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId?: number;
}

export function PlaylistCreateDialog({
  open,
  onOpenChange,
  channelId,
}: PlaylistCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<PlaylistVisibility>("PUBLIC");
  const titleStartedRef = useRef(false);
  const descriptionStartedRef = useRef(false);

  const { mutate: create, isPending } = useCreatePlaylist();
  const ownerType = channelId ? "CHANNEL" : "USER";

  useEffect(() => {
    if (!open) return;
    titleStartedRef.current = false;
    descriptionStartedRef.current = false;
    captureIntentEvent("playlist_create_dialog_opened", {
      owner_type: ownerType,
      channel_id: channelId,
      initial_visibility: "PUBLIC",
    });
  }, [channelId, open, ownerType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    captureIntentEvent("playlist_create_submit_clicked", {
      owner_type: ownerType,
      channel_id: channelId,
      visibility,
      title_length: trimmed.length,
      description_length: description.trim().length,
      has_description: Boolean(description.trim()),
    });

    if (!trimmed) {
      toast.error("제목을 입력해주세요.");
      captureIntentEvent("playlist_create_validation_failed", {
        owner_type: ownerType,
        channel_id: channelId,
        reason: "title_empty",
        visibility,
      });
      return;
    }

    create(
      {
        ownerType,
        channelId,
        title: trimmed,
        description: description.trim() || undefined,
        visibility,
      },
      {
        onSuccess: (playlist) => {
          toast.success("재생목록이 생성되었습니다.");
          captureIntentEvent("playlist_create_succeeded", {
            playlist_id: playlist.id,
            owner_type: ownerType,
            channel_id: channelId,
            visibility,
            title_length: trimmed.length,
            description_length: description.trim().length,
            has_description: Boolean(description.trim()),
          });
          onOpenChange(false);
          setTitle("");
          setDescription("");
          setVisibility("PUBLIC");
        },
        onError: (err) => {
          toast.error(err.message || "재생목록 생성에 실패했습니다.");
          captureIntentEvent("playlist_create_failed", {
            owner_type: ownerType,
            channel_id: channelId,
            visibility,
            title_length: trimmed.length,
            description_length: description.trim().length,
            has_description: Boolean(description.trim()),
          });
        },
      }
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && open) {
          captureIntentEvent("playlist_create_dialog_closed", {
            owner_type: ownerType,
            channel_id: channelId,
            visibility,
            title_length: title.trim().length,
            description_length: description.trim().length,
            has_dirty_fields: Boolean(title.trim() || description.trim()),
          });
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>새 재생목록</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="playlist-title">제목</Label>
              <Input
                id="playlist-title"
                value={title}
                onChange={(e) => {
                  if (!titleStartedRef.current) {
                    titleStartedRef.current = true;
                    captureIntentEvent("playlist_create_title_input_started", {
                      owner_type: ownerType,
                      channel_id: channelId,
                    });
                  }
                  setTitle(e.target.value);
                }}
                placeholder="재생목록 제목"
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="playlist-desc">설명 (선택)</Label>
              <Textarea
                id="playlist-desc"
                value={description}
                onChange={(e) => {
                  if (!descriptionStartedRef.current) {
                    descriptionStartedRef.current = true;
                    captureIntentEvent(
                      "playlist_create_description_input_started",
                      {
                        owner_type: ownerType,
                        channel_id: channelId,
                      },
                    );
                  }
                  setDescription(e.target.value);
                }}
                placeholder="재생목록에 대한 설명을 입력하세요"
                maxLength={500}
                rows={3}
              />
            </div>

            <div className="grid gap-2">
              <Label>공개 설정</Label>
              <Select
                value={visibility}
                onValueChange={(v) => {
                  captureIntentEvent("playlist_create_visibility_changed", {
                    owner_type: ownerType,
                    channel_id: channelId,
                    previous_visibility: visibility,
                    next_visibility: v,
                  });
                  setVisibility(v as PlaylistVisibility);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PUBLIC">공개</SelectItem>
                  <SelectItem value="UNLISTED">
                    일부 공개 (링크 공유)
                  </SelectItem>
                  <SelectItem value="PRIVATE">비공개</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                captureIntentEvent("playlist_create_cancel_clicked", {
                  owner_type: ownerType,
                  channel_id: channelId,
                  visibility,
                  has_dirty_fields: Boolean(title.trim() || description.trim()),
                });
                onOpenChange(false);
              }}
            >
              취소
            </Button>
            <Button type="submit" disabled={isPending || !title.trim()}>
              {isPending ? "생성 중..." : "생성"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
