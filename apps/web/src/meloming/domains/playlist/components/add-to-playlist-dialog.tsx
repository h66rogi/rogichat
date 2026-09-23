"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Button } from "@/meloming/shared/components/ui/button";
import { Plus, ListMusic, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMyOwnedPlaylists, playlistKeys } from "@/meloming/domains/playlist/hooks/use-playlists";
import { addClipToPlaylist } from "@/meloming/domains/playlist/apis/playlists";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/meloming/shared/lib/utils";
import { PlaylistCreateDialog } from "./playlist-create-dialog";
import { isAxiosError } from "@/meloming/shared/lib/axios-error";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";

interface AddToPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clipId: number;
}

export function AddToPlaylistDialog({
  open,
  onOpenChange,
  clipId,
}: AddToPlaylistDialogProps) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const { data: owned, isLoading } = useMyOwnedPlaylists(
    { take: 50 },
    { enabled: open && isAuthenticated }
  );
  const [showCreate, setShowCreate] = useState(false);
  const [addingTo, setAddingTo] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    captureIntentEvent("playlist_add_clip_dialog_opened", {
      clip_id: clipId,
      user_authenticated: isAuthenticated,
    });
  }, [clipId, isAuthenticated, open]);

  useEffect(() => {
    if (!open || isLoading || !owned) return;
    captureIntentEvent("playlist_add_clip_owned_playlists_loaded", {
      clip_id: clipId,
      owned_playlist_count: owned.items.length,
      empty: owned.items.length === 0,
    });
  }, [clipId, isLoading, open, owned]);

  const handleAdd = async (playlistId: number) => {
    const targetPlaylist = owned?.items.find((playlist) => playlist.id === playlistId);
    captureIntentEvent("playlist_add_clip_target_clicked", {
      clip_id: clipId,
      playlist_id: playlistId,
      target_clip_count: targetPlaylist?.stat?.clipCount ?? 0,
      target_visibility: targetPlaylist?.visibility,
      target_has_thumbnail: Boolean(targetPlaylist?.thumbnailUrl),
    });
    setAddingTo(playlistId);
    try {
      await addClipToPlaylist(playlistId, { clipId });
      toast.success("재생목록에 추가되었습니다.");
      captureIntentEvent("playlist_add_clip_succeeded", {
        clip_id: clipId,
        playlist_id: playlistId,
        target_clip_count: targetPlaylist?.stat?.clipCount ?? 0,
        target_visibility: targetPlaylist?.visibility,
      });
      // Manually invalidate since we're not using the mutation hook
      queryClient.invalidateQueries({ queryKey: playlistKeys.detail(playlistId) });
      queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    } catch (err: unknown) {
      if (isAxiosError(err) && err.response?.status === 400) {
        toast.info("이미 재생목록에 포함된 클립입니다.");
        captureIntentEvent("playlist_add_clip_duplicate_blocked", {
          clip_id: clipId,
          playlist_id: playlistId,
          target_clip_count: targetPlaylist?.stat?.clipCount ?? 0,
          target_visibility: targetPlaylist?.visibility,
        });
      } else {
        toast.error("추가에 실패했습니다.");
        captureIntentEvent("playlist_add_clip_failed", {
          clip_id: clipId,
          playlist_id: playlistId,
          target_clip_count: targetPlaylist?.stat?.clipCount ?? 0,
          target_visibility: targetPlaylist?.visibility,
          status: isAxiosError(err) ? err.response?.status : undefined,
        });
      }
    } finally {
      setAddingTo(null);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && open) {
            captureIntentEvent("playlist_add_clip_dialog_closed", {
              clip_id: clipId,
              owned_playlist_count: owned?.items.length ?? 0,
              create_dialog_opened: showCreate,
            });
          }
          onOpenChange(nextOpen);
        }}
      >
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>재생목록에 추가</DialogTitle>
          </DialogHeader>

          <div className="py-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-2 mb-3"
              onClick={() => {
                captureIntentEvent("playlist_add_clip_create_clicked", {
                  clip_id: clipId,
                  owned_playlist_count: owned?.items.length ?? 0,
                });
                setShowCreate(true);
                onOpenChange(false);
              }}
            >
              <Plus className="size-4" />
              새 재생목록 만들기
            </Button>

            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {owned?.items.length === 0 && !isLoading && (
              <p className="text-center text-sm text-muted-foreground py-8">
                아직 재생목록이 없습니다.
              </p>
            )}

            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {owned?.items.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => handleAdd(pl.id)}
                  disabled={addingTo === pl.id}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left",
                    "hover:bg-accent transition-colors",
                    addingTo === pl.id && "opacity-50"
                  )}
                >
                  <div className="shrink-0 size-10 rounded bg-muted flex items-center justify-center overflow-hidden">
                    {pl.thumbnailUrl ? (
                      <img
                        src={pl.thumbnailUrl}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <ListMusic className="size-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pl.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {pl.stat?.clipCount ?? 0}곡
                    </p>
                  </div>
                  {addingTo === pl.id ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Plus className="size-4 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PlaylistCreateDialog open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}
