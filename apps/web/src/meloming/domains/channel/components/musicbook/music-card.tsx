import { AspectRatio } from "@/meloming/shared/components/ui/aspect-ratio";
import { BirdIcon, Heart, MusicIcon } from "lucide-react";
import { useAtomValue } from "jotai";
import { themeColorAtom } from "@/meloming/domains/channel/atoms/channel-atom";
import type { Song, SongCategory } from "@/meloming/domains/channel/types/song";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import MusicModal from "./music-modal";
import { useClipboard } from "@/meloming/shared/hooks/use-clipboard";
import { toast } from "sonner";
import { LiveSongRequestButton } from "@/meloming/domains/channel/components/live-song-request-button";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import {
  useToggleFavoriteSong,
  useUnfavoriteSong,
  favoritesKeys,
} from "@/meloming/domains/channel/hooks/use-favorites";
import { songsKeys } from "@/meloming/domains/channel/hooks/use-songs";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import LoginRequiredDialog from "@/meloming/shared/components/common/login-required-dialog";
import clsx from "clsx";
import type { PricingSettings } from "@/meloming/domains/channel/types/pricing";
import { PRICE_SOURCE_LABELS } from "@/meloming/domains/channel/utils/song-price";
import { getSongRequestPriceItems } from "@/meloming/domains/channel/utils/song-request-price-display";
import { SongRequestPricePills } from "./song-request-price-pills";
import {
  SongRatingBadges,
  type SongPrimaryRatingField,
} from "./song-rating-badges";

interface MusicCardProps {
  song: Song;
  disableOpen?: boolean;
  onClick?: () => void;
  /** When true, open the modal automatically once without side effects */
  autoOpen?: boolean;
  /** When autoOpen opens the modal, start in edit mode */
  autoOpenEdit?: boolean;
  /** Called exactly once when autoOpen triggers so parent can clear state */
  onAutoOpenConsumed?: () => void;
  /** Hide favorite heart button overlay */
  hideFavorite?: boolean;
  /** Live song request state (optional) */
  liveRequestState?: LiveSongRequestState;
  /** Optional channel pricing settings for price display */
  pricingSettings?: PricingSettings;
  primaryRatingField?: SongPrimaryRatingField;
}

export const DefaultImage = ({
  themeColor,
  className,
  isContent = false,
}: {
  themeColor: string;
  className?: string;
  isContent?: boolean;
}) => {
  const textColor = themeColor === "black" ? "text-gray-900" : "text-gray-100";

  return (
    <div
      className={clsx(
        "w-full h-full bg-gray-200 rounded-lg flex flex-row justify-center items-center",
        className
      )}
      style={{ backgroundColor: themeColor }}
    >
      <div className={textColor}>
        {isContent ? <BirdIcon size={32} /> : <MusicIcon size={32} />}
      </div>
    </div>
  );
};

export default function MusicCard({
  song,
  disableOpen = false,
  onClick,
  autoOpen = false,
  autoOpenEdit = false,
  onAutoOpenConsumed,
  hideFavorite = false,
  liveRequestState,
  pricingSettings,
  primaryRatingField = "difficulty",
}: MusicCardProps) {
  const queryClient = useQueryClient();
  const themeColor = useAtomValue(themeColorAtom);
  const { user } = useParams();
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";
  const [open, setOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const hasAutoOpenedRef = useRef(false);
  const { copy } = useClipboard();
  const toggleFavoriteSong = useToggleFavoriteSong();
  const unFavoriteSong = useUnfavoriteSong();
  const { isAuthenticated } = useAuth();
  const globalSongHref =
    typeof song.globalSongId === "number"
      ? `/song/${song.globalSongId}`
      : null;
  const requestPriceItems = useMemo(
    () => getSongRequestPriceItems(song, pricingSettings),
    [song, pricingSettings]
  );
  const priceSourceLabel =
    requestPriceItems.length === 1
      ? PRICE_SOURCE_LABELS[requestPriceItems[0].source]
      : null;
  // Local optimistic UI state for favorite status
  const [isFavoriteLocal, setIsFavoriteLocal] = useState<boolean>(
    Boolean(song.isFavorite)
  );

  // Keep local state in sync when parent provides updated song prop
  useEffect(() => {
    setIsFavoriteLocal(Boolean(song.isFavorite));
  }, [song.isFavorite]);

  const handleOpen = useCallback(async () => {
    if (disableOpen) {
      if (onClick) onClick();
      return;
    }
    if (onClick) {
      onClick();
      return;
    }
    setOpen(true);
    const text = `${song.artist.name} - ${song.title}`;
    const ok = await copy(text);
    if (ok) {
      toast.success("클립보드에 복사되었습니다", { description: text });
    } else {
      toast.error("복사에 실패했습니다. 다시 시도해주세요.");
    }
  }, [copy, disableOpen, onClick, song.artist.name, song.title]);

  // Auto-open modal once if requested
  useEffect(() => {
    if (autoOpen && !hasAutoOpenedRef.current) {
      hasAutoOpenedRef.current = true;
      setOpen(true);
      if (onAutoOpenConsumed) onAutoOpenConsumed();
    }
  }, [autoOpen, onAutoOpenConsumed]);

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      setLoginDialogOpen(true);
      return;
    }
    const isUnfavorite = Boolean(isFavoriteLocal);

    try {
      // Optimistically flip UI state
      setIsFavoriteLocal(!isUnfavorite);
      if (isUnfavorite) {
        await unFavoriteSong.mutateAsync({ songId: song.id });
      } else {
        await toggleFavoriteSong.mutateAsync({ songId: song.id });
      }

      await Promise.all([
        // Favorites: songs list/status/count and overall stats
        queryClient.invalidateQueries({ queryKey: favoritesKeys.songs() }),
        queryClient.invalidateQueries({
          queryKey: favoritesKeys.songStatus(song.id),
        }),
        queryClient.invalidateQueries({
          queryKey: favoritesKeys.songCount(song.id),
        }),
        queryClient.invalidateQueries({ queryKey: favoritesKeys.stats() }),
        // Public user songs lists (regular + infinite + random 등 모든 role bucket).
        // Round 4 M3: publicUser(username) 는 role 없는 prefix 이므로 'songs/public/<username>/*'
        // 아래의 모든 캐시(매니저/viewer, infinite, random, detail...) 를 함께 무효화.
        ...(username
          ? [
              queryClient.invalidateQueries({
                queryKey: songsKeys.publicUser(username),
              }),
            ]
          : []),
      ]);
    } catch (error) {
      console.error("❌ API call failed:", error);
      toast.error("즐겨찾기 처리에 실패했습니다. 다시 시도해주세요.");
      // Rollback optimistic UI on failure
      setIsFavoriteLocal(Boolean(song.isFavorite));
    }
  };

  return (
    <>
      <div
        id={`channel-song-card-${song.id}`}
        className="max-w-72 hover:scale-[1.02] transition-all duration-300 cursor-pointer channel-song-card"
        onClick={handleOpen}
      >
        <AspectRatio ratio={1 / 1}>
          <div className="relative w-full h-full">
            {song.albumArt ? (
              <img
                src={song.albumArt}
                alt={`Image of ${song.title}`}
                className="w-full h-full object-cover rounded-lg select-none channel-song-cover"
                draggable={false}
              />
            ) : (
              <DefaultImage themeColor={themeColor} />
            )}

            {/* Favorite heart overlay */}
            {!hideFavorite && (
              <button
                type="button"
                aria-label="즐겨찾기"
                onClick={handleToggleFavorite}
                disabled={
                  toggleFavoriteSong.isPending || unFavoriteSong.isPending
                }
                className="absolute top-2 right-2 z-10 rounded-full p-1.5 bg-white/80 dark:bg-gray-900/80 hover:bg-white shadow-sm"
              >
                <Heart
                  size={18}
                  className={isFavoriteLocal ? "text-red-500" : "text-gray-400"}
                  fill={isFavoriteLocal ? "currentColor" : "none"}
                />
              </button>
            )}

            {/* Live mode indicators */}
            {liveRequestState?.showRequestUI && (
              <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-1 bg-gradient-to-r from-fuchsia-600 to-pink-600 rounded-full shadow-lg shadow-fuchsia-500/30">
                <span className="relative flex size-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full size-1.5 bg-white" />
                </span>
                <span className="text-[10px] font-bold text-white">LIVE</span>
              </div>
            )}
          </div>
        </AspectRatio>

        <div className="mt-2">
          {globalSongHref ? (
            <Link
              href={globalSongHref}
              onClick={(e) => e.stopPropagation()}
              className="block font-semibold channel-song-title hover:underline"
            >
              {song.title}
            </Link>
          ) : (
            <div className="font-semibold channel-song-title">{song.title}</div>
          )}
          <div className="text-sm text-gray-500 dark:text-gray-400 channel-song-artist">
            {song.artist.name}
          </div>
          {requestPriceItems.length > 0 && (
            <div className="mt-1">
              <SongRequestPricePills
                items={requestPriceItems}
                className="channel-song-price"
              />
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-1">
            {song.categories.map((category: SongCategory) => (
              <Badge
                key={category.id}
                variant="default"
                className="text-xs select-none channel-song-category"
                style={{
                  backgroundColor: category.color,
                  color: getContrastingTextColor(category.color),
                }}
              >
                {category.name}
              </Badge>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 mt-2">
            <SongRatingBadges
              difficulty={song.difficulty}
              proficiency={song.proficiency}
              mode="primary"
              primaryField={primaryRatingField}
              showDifficultyLabel={false}
            />
            {liveRequestState?.showRequestUI && (
              <div onClick={(e) => e.stopPropagation()}>
                <LiveSongRequestButton
                  song={song}
                  requestState={liveRequestState}
                  size="sm"
                  variant="default"
                  className="h-8 px-4 text-xs font-bold bg-gradient-to-r from-fuchsia-600 via-pink-600 to-violet-600 hover:from-fuchsia-500 hover:via-pink-500 hover:to-violet-500 text-white border-0 shadow-md shadow-fuchsia-500/30 rounded-full"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <MusicModal
        open={open}
        setOpen={setOpen}
        song={song}
        user={username}
        liveRequestState={liveRequestState}
        pricingSettings={pricingSettings}
        initialMode={autoOpenEdit ? "edit" : "detail"}
      />
      <LoginRequiredDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
      />
    </>
  );
}
