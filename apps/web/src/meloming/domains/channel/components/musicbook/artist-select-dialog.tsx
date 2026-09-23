import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Input } from "@/meloming/shared/components/ui/input";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Button } from "@/meloming/shared/components/ui/button";
import { getChoseong, canBeChoseong } from "es-hangul";
import type { Artist } from "@/meloming/domains/channel/types/artist";

interface ArtistSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artists: Artist[] | undefined;
  selectedArtistIds: readonly string[];
  onSelect: (artistIds: readonly string[]) => void;
}

export function ArtistSelectDialog({
  open,
  onOpenChange,
  artists,
  selectedArtistIds,
  onSelect,
}: ArtistSelectDialogProps) {
  const [artistModalQuery, setArtistModalQuery] = useState("");
  const selectedIdSet = new Set(selectedArtistIds);

  const handleClose = (shouldOpen: boolean) => {
    onOpenChange(shouldOpen);
    if (!shouldOpen) {
      setArtistModalQuery("");
    }
  };

  const handleArtistClick = (artistId: string) => {
    const next = new Set(selectedArtistIds);
    if (next.has(artistId)) {
      next.delete(artistId);
    } else {
      next.add(artistId);
    }
    onSelect(Array.from(next).sort((a, b) => Number(a) - Number(b)));
  };

  const handleSelectAll = () => {
    onSelect([]);
    setArtistModalQuery("");
    handleClose(false);
  };

  const sortedArtists =
    artists
      ?.slice()
      .filter((artist) => (artist.songCount || 0) > 0)
      .sort((a, b) => (b.songCount || 0) - (a.songCount || 0)) || [];

  // Filter with modal query (supports choseong)
  const q = artistModalQuery.trim();
  const filteredArtists = q
    ? (() => {
        const isChoseongOnly = [...q].every((ch) => canBeChoseong(ch));
        if (isChoseongOnly) {
          return sortedArtists.filter((artist) =>
            getChoseong(artist.name).includes(q)
          );
        }
        const lowerQ = q.toLowerCase();
        return sortedArtists.filter((artist) =>
          artist.name.toLowerCase().includes(lowerQ)
        );
      })()
    : sortedArtists;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>가수 전체 보기</DialogTitle>
        </DialogHeader>
        <div className="mb-2">
          <Input
            placeholder="가수 검색 (초성 가능)"
            value={artistModalQuery}
            onChange={(e) => setArtistModalQuery(e.target.value)}
            autoFocus={false}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {/* 선택 초기화 버튼 */}
          <Button
            variant={selectedArtistIds.length > 0 ? "outline" : "default"}
            size="sm"
            className="h-8 text-xs px-3 py-1"
            onClick={handleSelectAll}
          >
            선택 초기화
          </Button>

          {filteredArtists.map((artist) => {
            const isSelected = selectedIdSet.has(artist.id.toString());
            return (
              <Badge
                key={artist.id}
                variant={isSelected ? "default" : "outline"}
                className={`px-3 py-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1 transition-colors ${
                  isSelected
                    ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
                    : ""
                }`}
                onClick={() => handleArtistClick(artist.id.toString())}
              >
                {artist.name}
                {artist.songCount !== undefined && (
                  <span
                    className={`text-xs ml-1 ${
                      isSelected
                        ? "text-white/80 dark:text-gray-900/80"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {artist.songCount}
                  </span>
                )}
              </Badge>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
