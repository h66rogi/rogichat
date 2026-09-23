"use client";

import { useState, useMemo } from "react";
import { Search, Star, X, Loader2, ArrowLeft, Music, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Input } from "@/meloming/shared/components/ui/input";
import { Button } from "@/meloming/shared/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/meloming/shared/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/meloming/shared/components/ui/command";
import { useFavoriteChannels } from "@/meloming/domains/channel/hooks/use-favorites";
import { useInfiniteChannelSearch } from "@/meloming/domains/channel/hooks/use-channel-search";
import { usePublicUserSongs } from "@/meloming/domains/channel/hooks/use-songs";
import { useDebounce } from "@/meloming/shared/hooks/use-debounce";
import type { FavoriteChannelItem } from "@/meloming/domains/channel/types/favorite";
import type { GetChannelSearchResponse } from "@/meloming/domains/channel/types/channel";
import type { TaggedChannelItem } from "./tagged-channels-list";

type SearchChannel = GetChannelSearchResponse["channels"][number];

interface SelectedChannel {
  channelId: number;
  channelName: string;
  webPath: string;
  profileImageUrl: string | null;
}

interface ChannelTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (item: TaggedChannelItem) => void;
  /** 이미 태그된 채널 ID 목록 (중복 방지) */
  excludeChannelIds?: number[];
  /** 클립 제목 (노래 fuzzy search용) */
  clipTitle?: string;
}

export function ChannelTagDialog({
  open,
  onOpenChange,
  onComplete,
  excludeChannelIds = [],
  clipTitle,
}: ChannelTagDialogProps) {
  // Step: "channel" | "song"
  const [step, setStep] = useState<"channel" | "song">("channel");
  const [selectedChannel, setSelectedChannel] = useState<SelectedChannel | null>(null);

  // Channel search
  const [channelSearch, setChannelSearch] = useState("");
  const debouncedChannelSearch = useDebounce(channelSearch, 300);
  const isSearchingChannel = debouncedChannelSearch.length > 0;

  // Song search
  const [songSearch, setSongSearch] = useState("");
  const debouncedSongSearch = useDebounce(songSearch, 300);

  // 즐겨찾기 채널
  const { data: favoritesData, isLoading: isFavoritesLoading } = useFavoriteChannels(
    { limit: 50 },
    { enabled: open && step === "channel" && !isSearchingChannel }
  );

  // 채널 검색
  const {
    data: searchData,
    isLoading: isSearchLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteChannelSearch({
    keyword: debouncedChannelSearch,
    limit: 20,
    enabled: open && step === "channel" && isSearchingChannel,
  });

  // 선택된 채널의 노래 검색
  const { data: songsData, isLoading: isSongsLoading } = usePublicUserSongs(
    selectedChannel?.webPath ?? "",
    {
      search: debouncedSongSearch || undefined,
      limit: 20,
    },
    { enabled: open && step === "song" && !!selectedChannel }
  );

  // 검색 결과 평탄화 (excludeChannelIds 제외)
  const searchResults = useMemo((): SearchChannel[] => {
    // @ts-expect-error - InfiniteData type inference issue
    const pages = searchData?.pages as GetChannelSearchResponse[] | undefined;
    if (!pages) return [];
    return pages
      .flatMap((page) => page.channels)
      .filter((ch) => !excludeChannelIds.includes(ch.id));
  }, [searchData, excludeChannelIds]);

  // 즐겨찾기 (excludeChannelIds 제외)
  const filteredFavorites = useMemo(() => {
    return (favoritesData?.favorites ?? []).filter(
      (fav) => !excludeChannelIds.includes(fav.channelId)
    );
  }, [favoritesData, excludeChannelIds]);

  const songs = useMemo(() => songsData?.songs ?? [], [songsData]);

  // 다이얼로그 열림/닫힘 핸들러
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // 닫힐 때 초기화
      setStep("channel");
      setSelectedChannel(null);
      setChannelSearch("");
      setSongSearch("");
    }
    onOpenChange(newOpen);
  };

  // 채널 선택
  const handleChannelSelect = (channel: SelectedChannel) => {
    setSelectedChannel(channel);
    setStep("song");
    setChannelSearch("");
  };

  // 뒤로가기
  const handleBack = () => {
    setStep("channel");
    setSelectedChannel(null);
    setSongSearch("");
  };

  // 노래 선택 완료
  const handleSongSelect = (song: {
    id: number;
    title: string;
    artist: { name: string };
  }) => {
    if (!selectedChannel) return;

    onComplete({
      channelId: selectedChannel.channelId,
      channelName: selectedChannel.channelName,
      webPath: selectedChannel.webPath,
      profileImageUrl: selectedChannel.profileImageUrl,
      songId: song.id,
      songTitle: song.title,
      artistName: song.artist.name,
    });

    handleOpenChange(false);
  };

  // 즐겨찾기 채널 클릭
  const handleFavoriteClick = (fav: FavoriteChannelItem) => {
    handleChannelSelect({
      channelId: fav.channelId,
      channelName: fav.channelName,
      webPath: fav.webPath,
      profileImageUrl: fav.profileImageUrl,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === "song" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 -ml-2"
                onClick={handleBack}
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            {step === "channel" ? "함께 출연 채널 태그" : "노래 선택"}
          </DialogTitle>
          <DialogDescription>
            {step === "channel"
              ? "함께 출연한 채널을 검색하여 태그하세요"
              : `${selectedChannel?.channelName}의 노래를 선택하세요`}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: 채널 선택 */}
        {step === "channel" && (
          <>
            {/* 검색 입력 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="채널명으로 검색..."
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                className="pl-9 pr-9"
                autoFocus
              />
              {channelSearch && (
                <button
                  onClick={() => setChannelSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* 채널 목록 */}
            <div className="max-h-[50vh] overflow-y-auto">
              {isSearchingChannel ? (
                // 검색 결과
                <div className="space-y-1">
                  {isSearchLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      검색 결과가 없습니다
                    </div>
                  ) : (
                    <>
                      {searchResults.map((channel) => (
                        <button
                          key={channel.id}
                          onClick={() =>
                            handleChannelSelect({
                              channelId: channel.id,
                              channelName: channel.name,
                              webPath: channel.webPath,
                              profileImageUrl: channel.profileImageUrl,
                            })
                          }
                          className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                        >
                          <Avatar className="size-10 shrink-0">
                            <AvatarImage src={channel.profileImageUrl ?? undefined} />
                            <AvatarFallback>
                              {channel.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{channel.name}</p>
                            <p className="text-sm text-muted-foreground truncate">
                              @{channel.webPath}
                            </p>
                          </div>
                          {channel.isFavorite && (
                            <Star className="size-4 text-yellow-500 fill-yellow-500 shrink-0" />
                          )}
                        </button>
                      ))}

                      {/* 더 보기 */}
                      {hasNextPage && (
                        <div className="pt-2 pb-1">
                          <Button
                            variant="ghost"
                            className="w-full"
                            onClick={() => fetchNextPage()}
                            disabled={isFetchingNextPage}
                          >
                            {isFetchingNextPage ? (
                              <>
                                <Loader2 className="size-4 mr-2 animate-spin" />
                                불러오는 중...
                              </>
                            ) : (
                              "더 보기"
                            )}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                // 즐겨찾기 채널 목록
                <div className="space-y-1">
                  <div className="flex items-center gap-2 py-2 text-sm font-medium text-muted-foreground">
                    <Star className="size-4" />
                    내 즐겨찾기 채널
                  </div>

                  {isFavoritesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredFavorites.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>태그 가능한 즐겨찾기 채널이 없습니다</p>
                      <p className="text-sm mt-1">채널을 검색하여 선택해주세요</p>
                    </div>
                  ) : (
                    filteredFavorites.map((fav) => (
                      <button
                        key={fav.id}
                        onClick={() => handleFavoriteClick(fav)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                      >
                        <Avatar className="size-10 shrink-0">
                          <AvatarImage src={fav.profileImageUrl ?? undefined} />
                          <AvatarFallback>
                            {fav.channelName.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{fav.channelName}</p>
                          <p className="text-sm text-muted-foreground truncate">
                            @{fav.webPath}
                          </p>
                        </div>
                        <Star className="size-4 text-yellow-500 fill-yellow-500 shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 2: 노래 선택 */}
        {step === "song" && selectedChannel && (
          <div className="space-y-3">
            {/* 선택된 채널 표시 */}
            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
              <Avatar className="size-8 shrink-0">
                <AvatarImage src={selectedChannel.profileImageUrl ?? undefined} />
                <AvatarFallback className="text-xs">
                  {selectedChannel.channelName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {selectedChannel.channelName}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  @{selectedChannel.webPath}
                </p>
              </div>
            </div>

            {/* 노래 검색 */}
            <Command shouldFilter={false} className="border rounded-lg">
              <CommandInput
                placeholder="노래 제목 또는 아티스트로 검색..."
                value={songSearch}
                onValueChange={setSongSearch}
              />
              <CommandList className="max-h-[300px]">
                {isSongsLoading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    검색 중...
                  </div>
                ) : songs.length === 0 ? (
                  <CommandEmpty>
                    {songSearch
                      ? "검색 결과가 없습니다"
                      : "이 채널에 등록된 노래가 없습니다"}
                  </CommandEmpty>
                ) : (
                  <CommandGroup>
                    {songs.map((song) => (
                      <CommandItem
                        key={song.id}
                        value={`${song.id}`}
                        onSelect={() => handleSongSelect(song)}
                        className="flex items-center gap-2 py-2"
                      >
                        <Music className="size-4 shrink-0 text-muted-foreground" />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-medium truncate">{song.title}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {song.artist.name}
                          </span>
                        </div>
                        <Check className="size-4 shrink-0 opacity-0" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
