import { Badge } from "@/meloming/shared/components/ui/badge";
import { Heart, MusicIcon } from "lucide-react";
import { useAtomValue } from "jotai";
import { themeColorAtom } from "@/meloming/domains/channel/atoms/channel-atom";
import { getContrastingTextColor } from "@/meloming/shared/lib/utils";
import { useIsMobile } from "@/meloming/shared/hooks/use-mobile";
import type { Song, SongCategory } from "@/meloming/domains/channel/types/song";
import {
  useCallback,
  useState,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useChannelIdentifier } from "@/meloming/domains/channel/hooks/channel-identifier-context";
import MusicModal from "./music-modal";
import { useClipboard } from "@/meloming/shared/hooks/use-clipboard";
import { toast } from "sonner";
import {
  useToggleFavoriteSong,
  useUnfavoriteSong,
  favoritesKeys,
} from "@/meloming/domains/channel/hooks/use-favorites";
import { songsKeys } from "@/meloming/domains/channel/hooks/use-songs";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import LoginRequiredDialog from "@/meloming/shared/components/common/login-required-dialog";
import { LiveSongRequestButton } from "@/meloming/domains/channel/components/live-song-request-button";
import type { LiveSongRequestState } from "@/meloming/domains/channel/types/live-song-request";
import type { PricingSettings } from "@/meloming/domains/channel/types/pricing";
import { PRICE_SOURCE_LABELS } from "@/meloming/domains/channel/utils/song-price";
import { getSongRequestPriceItems } from "@/meloming/domains/channel/utils/song-request-price-display";
import { SongRequestPricePills } from "./song-request-price-pills";
import {
  SongRatingBadges,
  type SongPrimaryRatingField,
} from "./song-rating-badges";

interface MusicCardListProps {
  song: Song;
  /** Optional leading area for selection checkbox or icons */
  leading?: ReactNode;
  /**
   * If provided, custom action elements (e.g., Edit/Delete buttons) are rendered on the right side.
   * Useful for management pages that need per-item controls.
   */
  actions?: ReactNode;
  /**
   * When true, disables the default click behavior (copy + modal open).
   * Use this in management contexts where the card should not open the detail modal.
   */
  disableOpen?: boolean;
  /**
   * Optional override for card click. If provided, this will be called when the card is clicked
   * (unless disableOpen is true). If not provided and disableOpen is false, default behavior runs.
   */
  onClick?: () => void;
  /** When true, open the modal automatically once without side effects */
  autoOpen?: boolean;
  /** When autoOpen opens the modal, start in edit mode */
  autoOpenEdit?: boolean;
  /** Called exactly once when autoOpen triggers so parent can clear state */
  onAutoOpenConsumed?: () => void;
  /** Live song request state (optional) */
  liveRequestState?: LiveSongRequestState;
  /** Optional channel pricing settings for price display */
  pricingSettings?: PricingSettings;
  primaryRatingField?: SongPrimaryRatingField;
}

const DefaultImage = ({ themeColor }: { themeColor: string }) => {
  const textColor = getContrastingTextColor(themeColor);

  return (
    <div
      style={{ backgroundColor: themeColor }}
      className="w-full h-full flex items-center justify-center"
    >
      <div
        className={textColor === "black" ? "text-gray-900" : "text-gray-100"}
      >
        <MusicIcon size={24} />
      </div>
    </div>
  );
};

export default function MusicCardList({
  song,
  leading,
  actions,
  disableOpen = false,
  onClick,
  autoOpen = false,
  autoOpenEdit = false,
  onAutoOpenConsumed,
  liveRequestState,
  pricingSettings,
  primaryRatingField = "difficulty",
}: MusicCardListProps) {
  const queryClient = useQueryClient();
  const themeColor = useAtomValue(themeColorAtom);
  const isMobile = useIsMobile();
  const username = useChannelIdentifier();
  const [open, setOpen] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const hasAutoOpenedRef = useRef(false);
  const { copy } = useClipboard();
  const toggleFavoriteSong = useToggleFavoriteSong();
  const unFavoriteSong = useUnfavoriteSong();
  const { isAuthenticated } = useAuth();
  const requestPriceItems = useMemo(
    () => getSongRequestPriceItems(song, pricingSettings),
    [song, pricingSettings]
  );
  const priceSourceLabel =
    requestPriceItems.length === 1
      ? PRICE_SOURCE_LABELS[requestPriceItems[0].source]
      : null;

  const handleOpen = useCallback(async () => {
    if (disableOpen) return;
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
    const isUnfavorite = Boolean(song.isFavorite);

    try {
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
        // Public user songs lists (role-independent prefix — all role buckets 함께 무효화).
        // Round 4 M3: publicUser(username) prefix 가 paginated / infinite / random 등
        // 모든 파생 캐시를 커버.
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
    }
  };

  if (isMobile) {
    return (
      <>
        <div
          id={`channel-song-card-${song.id}`}
          className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden min-h-[5rem] cursor-pointer channel-song-card"
          onClick={handleOpen}
        >
          <div className="flex min-h-[5rem]">
            {/* 리딩(체크박스) + 이미지 */}
            {leading ? (
              <>
                <div className="w-10 flex-shrink-0 flex items-center justify-center pr-1 self-stretch">
                  {leading}
                </div>
                <div className="w-20 sm:w-24 flex-shrink-0 self-stretch">
                  <div className="relative w-full h-full min-h-[5.5rem]">
                    {song.albumArt ? (
                      <img
                        src={song.albumArt}
                        alt={song.title}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <DefaultImage themeColor={themeColor} />
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="w-20 sm:w-24 flex-shrink-0 self-stretch">
                <div className="relative w-full h-full min-h-[5.5rem]">
                  {song.albumArt ? (
                    <img
                      src={song.albumArt}
                      alt={song.title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <DefaultImage themeColor={themeColor} />
                  )}
                  <button
                    type="button"
                    aria-label="즐겨찾기"
                    onClick={handleToggleFavorite}
                    disabled={
                      toggleFavoriteSong.isPending || unFavoriteSong.isPending
                    }
                    className="absolute top-1 right-1 z-10 rounded-full p-1.5 bg-white/80 dark:bg-gray-900/80 hover:bg-white shadow-sm"
                  >
                    <Heart
                      size={16}
                      className={
                        song.isFavorite ? "text-red-500" : "text-gray-400"
                      }
                      fill={song.isFavorite ? "currentColor" : "none"}
                    />
                  </button>
                  {/* LIVE badge */}
                  {liveRequestState?.showRequestUI && (
                    <div className="absolute bottom-1 left-1 z-10 flex items-center gap-0.5 px-1.5 py-0.5 bg-gradient-to-r from-fuchsia-600 to-pink-600 rounded-full shadow-md">
                      <span className="relative flex size-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full size-1 bg-white" />
                      </span>
                      <span className="text-[8px] font-bold text-white">LIVE</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 콘텐츠 */}
            <div className="flex-1 p-3 flex flex-col justify-center">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-gray-900 dark:text-gray-100 truncate text-sm">
                    {song.title}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {song.artist.name}
                </div>
                {requestPriceItems.length > 0 && (
                  <div className="mt-1">
                    <SongRequestPricePills items={requestPriceItems} />
                  </div>
                )}
                {/* 카테고리 */}
              </div>

              <div className="flex flex-row justify-between items-center">
                <div className="flex flex-wrap gap-1 mt-2">
                  {song.categories.map((category: SongCategory) => (
                    <Badge
                      key={category.id}
                      variant="default"
                      className="text-xs select-none"
                      style={{
                        backgroundColor: category.color,
                        color: getContrastingTextColor(category.color),
                      }}
                    >
                      {category.name}
                    </Badge>
                  ))}
                </div>

                {/* 별점 & 액션 */}
                <div className="mt-1 flex items-center gap-2">
                  <SongRatingBadges
                    difficulty={song.difficulty}
                    proficiency={song.proficiency}
                    size={12}
                    mode="primary"
                    primaryField={primaryRatingField}
                    showDifficultyLabel={false}
                  />
                  {actions ? (
                    <div onClick={(e) => e.stopPropagation()}>{actions}</div>
                  ) : liveRequestState?.showRequestUI ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <LiveSongRequestButton
                        song={song}
                        requestState={liveRequestState}
                        size="sm"
                        variant="default"
                        className="h-7 px-3 text-xs font-semibold bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white border-0 shadow-sm shadow-fuchsia-500/25 rounded-full"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
        {!disableOpen ? (
          <MusicModal
            open={open}
            setOpen={setOpen}
            song={song}
            user={username}
            liveRequestState={liveRequestState}
            pricingSettings={pricingSettings}
            initialMode={autoOpenEdit ? "edit" : "detail"}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div
        id={`channel-song-card-${song.id}`}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden min-h-[5rem] cursor-pointer channel-song-card"
        onClick={handleOpen}
      >
        <div className="flex min-h-[5rem]">
          {/* 리딩(체크박스) + 이미지 */}
          {leading ? (
            <>
              <div className="w-12 flex-shrink-0 flex items-center justify-center pr-1 self-stretch">
                {leading}
              </div>
              <div className="w-24 flex-shrink-0 self-stretch">
                <div className="relative w-full h-full min-h-[6rem]">
                  {song.albumArt ? (
                    <img
                      src={song.albumArt}
                      alt={song.title}
                      className="absolute inset-0 w-full h-full object-cover channel-song-cover"
                    />
                  ) : (
                    <DefaultImage themeColor={themeColor} />
                  )}
                  <button
                    type="button"
                    aria-label="즐겨찾기"
                    onClick={handleToggleFavorite}
                    disabled={
                      toggleFavoriteSong.isPending || unFavoriteSong.isPending
                    }
                    className="absolute top-1 right-1 z-10 rounded-full p-1.5 bg-white/80 dark:bg-gray-900/80 hover:bg-white shadow-sm"
                  >
                    <Heart
                      size={16}
                      className={
                        song.isFavorite ? "text-red-500" : "text-gray-400"
                      }
                      fill={song.isFavorite ? "currentColor" : "none"}
                    />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="w-24 flex-shrink-0 self-stretch">
              <div className="relative w-full h-full min-h-[6rem]">
                {song.albumArt ? (
                  <img
                    src={song.albumArt}
                    alt={song.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <DefaultImage themeColor={themeColor} />
                )}
                {/* Ensure heart is visible on desktop no-leading branch */}
                <button
                  type="button"
                  aria-label="즐겨찾기"
                  onClick={handleToggleFavorite}
                  disabled={
                    toggleFavoriteSong.isPending || unFavoriteSong.isPending
                  }
                  className="absolute top-1 right-1 z-10 rounded-full p-1.5 bg-white/80 dark:bg-gray-900/80 hover:bg-white shadow-sm"
                >
                  <Heart
                    size={16}
                    className={
                      song.isFavorite ? "text-red-500" : "text-gray-400"
                    }
                    fill={song.isFavorite ? "currentColor" : "none"}
                  />
                </button>
                {/* LIVE badge */}
                {liveRequestState?.showRequestUI && (
                  <div className="absolute bottom-1 left-1 z-10 flex items-center gap-0.5 px-1.5 py-0.5 bg-gradient-to-r from-fuchsia-600 to-pink-600 rounded-full shadow-md">
                    <span className="relative flex size-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex rounded-full size-1.5 bg-white" />
                    </span>
                    <span className="text-[9px] font-bold text-white">LIVE</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 콘텐츠 */}
          <div className="flex-1 p-4 flex flex-wrap items-start gap-4">
            {/* 제목과 아티스트 */}
            <div className="flex-1 min-w-[160px]">
              <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                {song.title}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {song.artist.name}
              </div>
              {requestPriceItems.length > 0 && (
                <div className="mt-1">
                  <SongRequestPricePills items={requestPriceItems} />
                </div>
              )}
            </div>

            {/* 카테고리 */}
            <div className="flex flex-wrap gap-1 max-w-full md:max-w-48">
              {song.categories.map((category: SongCategory) => (
                <Badge
                  key={category.id}
                  variant="default"
                  className="text-xs select-none"
                  style={{
                    backgroundColor: category.color,
                    color: getContrastingTextColor(category.color),
                  }}
                >
                  {category.name}
                </Badge>
              ))}
            </div>

            {/* 별점 & 액션 */}
            <div className="flex items-center gap-2 ml-auto">
              <SongRatingBadges
                difficulty={song.difficulty}
                proficiency={song.proficiency}
                size={16}
                mode="primary"
                primaryField={primaryRatingField}
                showDifficultyLabel={false}
              />
              {actions ? (
                <div onClick={(e) => e.stopPropagation()}>{actions}</div>
              ) : liveRequestState?.showRequestUI ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <LiveSongRequestButton
                    song={song}
                    requestState={liveRequestState}
                    size="sm"
                    variant="default"
                    className="h-8 px-4 text-xs font-semibold bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white border-0 shadow-sm shadow-fuchsia-500/25 rounded-full"
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {!disableOpen ? (
        <MusicModal
          open={open}
          setOpen={setOpen}
          song={song}
          user={username}
          liveRequestState={liveRequestState}
          pricingSettings={pricingSettings}
          initialMode={autoOpenEdit ? "edit" : "detail"}
        />
      ) : null}
      <LoginRequiredDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
      />
    </>
  );
}
