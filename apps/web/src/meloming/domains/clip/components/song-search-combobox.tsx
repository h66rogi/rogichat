"use client";

import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, Music, Plus, Loader2 } from "lucide-react";
import { cn } from "@/meloming/shared/lib/utils";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/meloming/shared/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/meloming/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/meloming/shared/components/ui/select";
import { usePublicUserSongs } from "@/meloming/domains/channel/hooks/use-songs";
import { useUserCategories } from "@/meloming/domains/channel/hooks/use-categories";
import {
  postSongsChannelIdentifier,
  getSongSuggestions,
} from "@/meloming/domains/channel/apis/songs";
import { useDebounce } from "@/meloming/shared/hooks/use-debounce";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface SelectedSong {
  channelId: number;
  songId: number;
  songTitle: string;
  artistName: string;
}

interface SongSearchComboboxProps {
  channelIdentifier: string;
  value: SelectedSong | null;
  onValueChange: (song: SelectedSong | null) => void;
  disabled?: boolean;
  /** 클립 제목 (fuzzy search용) */
  clipTitle?: string;
}

export function SongSearchCombobox({
  channelIdentifier,
  value,
  onValueChange,
  disabled = false,
  clipTitle,
}: SongSearchComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddArtist, setQuickAddArtist] = useState("");
  const [quickAddCategoryId, setQuickAddCategoryId] = useState<string>("");

  const debouncedSearch = useDebounce(searchQuery, 300);
  const queryClient = useQueryClient();

  const { data, isLoading } = usePublicUserSongs(
    channelIdentifier,
    {
      search: debouncedSearch || undefined,
      limit: 20,
    },
    { enabled: open && !showQuickAdd }
  );

  const { data: categories = [] } = useUserCategories(channelIdentifier, {
    enabled: open && showQuickAdd,
  });

  const songs = useMemo(() => data?.songs ?? [], [data]);

  // Fuzzy search로 추천 노래 조회
  const { data: suggestData } = useQuery({
    queryKey: ["song-suggest", channelIdentifier, clipTitle],
    queryFn: () => getSongSuggestions(channelIdentifier, clipTitle!, 5),
    enabled: !!clipTitle && !value,
    staleTime: 5 * 60 * 1000, // 5분
  });

  const suggestedSongs = useMemo(
    () => suggestData?.suggestions ?? [],
    [suggestData]
  );

  // 노래 빠른 추가 mutation
  const createSongMutation = useMutation({
    mutationFn: async () => {
      const body: {
        title: string;
        artistName: string;
        difficulty: number;
        categoryIds?: number[];
      } = {
        title: quickAddTitle,
        artistName: quickAddArtist,
        difficulty: 3,
      };
      if (quickAddCategoryId) {
        body.categoryIds = [parseInt(quickAddCategoryId)];
      }
      return postSongsChannelIdentifier(channelIdentifier, body);
    },
    onSuccess: (newSong) => {
      toast.success("노래가 추가되었습니다");
      queryClient.invalidateQueries({ queryKey: ["songs"] });
      queryClient.invalidateQueries({ queryKey: ["song-suggest"] });
      onValueChange({
        channelId: newSong.channelId,
        songId: newSong.id,
        songTitle: newSong.title,
        artistName: newSong.artist.name,
      });
      setShowQuickAdd(false);
      setQuickAddTitle("");
      setQuickAddArtist("");
      setQuickAddCategoryId("");
      setOpen(false);
    },
    onError: () => {
      toast.error("노래 추가에 실패했습니다");
    },
  });

  const handleQuickAdd = () => {
    if (!quickAddTitle.trim() || !quickAddArtist.trim()) {
      toast.error("제목과 아티스트를 입력해주세요");
      return;
    }
    createSongMutation.mutate();
  };

  const handleStartQuickAdd = () => {
    // 검색어를 제목으로 미리 채우기
    setQuickAddTitle(searchQuery);
    setShowQuickAdd(true);
  };

  const handleCancelQuickAdd = () => {
    setShowQuickAdd(false);
    setQuickAddTitle("");
    setQuickAddArtist("");
    setQuickAddCategoryId("");
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between h-auto min-h-10 py-2"
          >
            {value ? (
              <div className="flex items-center gap-2 text-left">
                <Music className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="font-medium">{value.songTitle}</span>
                  <span className="text-xs text-muted-foreground">
                    {value.artistName}
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-muted-foreground">노래를 검색하세요</span>
            )}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
        >
          {showQuickAdd ? (
            /* 빠른 노래 추가 UI */
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm">빠른 노래 추가</h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleCancelQuickAdd}
                >
                  취소
                </Button>
              </div>

              <div className="space-y-2">
                <div>
                  <Label htmlFor="quickAddTitle" className="text-xs">
                    제목 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="quickAddTitle"
                    value={quickAddTitle}
                    onChange={(e) => setQuickAddTitle(e.target.value)}
                    placeholder="노래 제목"
                    className="h-8 text-sm"
                  />
                </div>

                <div>
                  <Label htmlFor="quickAddArtist" className="text-xs">
                    아티스트 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="quickAddArtist"
                    value={quickAddArtist}
                    onChange={(e) => setQuickAddArtist(e.target.value)}
                    placeholder="아티스트명"
                    className="h-8 text-sm"
                  />
                </div>

                <div>
                  <Label htmlFor="quickAddCategory" className="text-xs">
                    카테고리
                  </Label>
                  <Select
                    value={quickAddCategoryId}
                    onValueChange={setQuickAddCategoryId}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="선택 (선택사항)" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          <div className="flex items-center gap-2">
                            <div
                              className="size-2 rounded-full"
                              style={{ backgroundColor: cat.color }}
                            />
                            {cat.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                type="button"
                size="sm"
                className="w-full h-8"
                onClick={handleQuickAdd}
                disabled={createSongMutation.isPending}
              >
                {createSongMutation.isPending ? (
                  <>
                    <Loader2 className="size-3 mr-1.5 animate-spin" />
                    추가 중...
                  </>
                ) : (
                  <>
                    <Plus className="size-3 mr-1.5" />
                    노래 추가
                  </>
                )}
              </Button>
            </div>
          ) : (
            /* 검색 UI */
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="노래 제목 또는 아티스트로 검색..."
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
              <CommandList className="max-h-[200px]">
                {isLoading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    검색 중...
                  </div>
                ) : songs.length === 0 ? (
                  <div className="py-4 space-y-2">
                    <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                    {searchQuery && (
                      <>
                        <CommandSeparator />
                        <div className="p-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full h-8 text-xs"
                            onClick={handleStartQuickAdd}
                          >
                            <Plus className="size-3 mr-1.5" />
                            &quot;{searchQuery}&quot; 노래 빠르게 추가
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <CommandGroup>
                    {songs.map((song) => (
                      <CommandItem
                        key={song.id}
                        value={`${song.id}`}
                        onSelect={() => {
                          onValueChange({
                            channelId: song.channelId,
                            songId: song.id,
                            songTitle: song.title,
                            artistName: song.artist.name,
                          });
                          setOpen(false);
                          setSearchQuery("");
                        }}
                        className="flex items-center gap-2 py-2"
                      >
                        <Check
                          className={cn(
                            "size-4 shrink-0",
                            value?.songId === song.id
                              ? "opacity-100"
                              : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col">
                          <span className="font-medium">{song.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {song.artist.name}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>

      {/* 추천 곡 버튼들 - Select 밑에 배치 */}
      {suggestedSongs.length > 0 && !value && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">추천:</span>
          {suggestedSongs.slice(0, 3).map((song) => (
            <Button
              key={song.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto py-1 px-2 text-xs"
              onClick={() => {
                onValueChange({
                  channelId: song.channelId,
                  songId: song.id,
                  songTitle: song.title,
                  artistName: song.artistName,
                });
              }}
            >
              {song.title} - {song.artistName}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
