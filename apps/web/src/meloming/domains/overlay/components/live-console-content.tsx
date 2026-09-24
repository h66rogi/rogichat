'use client';

import dynamic from 'next/dynamic';
import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import posthog from 'posthog-js';
import {
  Play,
  Pause,
  SkipForward,
  Trash2,
  Plus,
  Music,
  Video,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Loader2,
  Coins,
  Search,
  X,
  Check,
  WifiOff,
  Radio,
  Square,
  Settings,
  Home,
  LayoutDashboard,
  ListMusic,
  MoreVertical,
  GripVertical,
  FileText,
  Link2,
  Mic2,
  Disc3,
  ChevronRight,
  Gauge,
  Hash,
  Timer,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  PictureInPicture2,
  CheckCircle2,
  XCircle,
  History,
  FileMusic,
  Tags,
  Star,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/meloming/shared/components/ui/button';
import { Input } from '@/meloming/shared/components/ui/input';
import { Slider } from '@/meloming/shared/components/ui/slider';
import { Badge } from '@/meloming/shared/components/ui/badge';
import { ScrollArea } from '@/meloming/shared/components/ui/scroll-area';
import { Switch } from '@/meloming/shared/components/ui/switch';
import { Label } from '@/meloming/shared/components/ui/label';
import { Textarea } from '@/meloming/shared/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/meloming/shared/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/meloming/shared/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/meloming/shared/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/meloming/shared/components/ui/sheet';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/meloming/shared/components/ui/resizable';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/meloming/shared/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/meloming/shared/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/meloming/shared/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/meloming/shared/components/ui/dropdown-menu';
import { cn } from '@/meloming/shared/lib/utils';

import { useInfinitePublicUserSongs } from '@/meloming/domains/channel/hooks/use-songs';
import { useUserArtists } from '@/meloming/domains/channel/hooks/use-artists';
import { useUserCategories } from '@/meloming/domains/channel/hooks/use-categories';
import { useMyChannel } from '@/meloming/domains/channel/hooks/use-my-channel';
import { useCategoriesManagement } from '@/meloming/domains/channel/hooks/use-categories-management';
import { useChannel } from '@/meloming/domains/channel/hooks/use-channel';
import { useFeatureFlag } from '@/meloming/shared/hooks/use-feature-flag';
import { useDebounce } from '@/meloming/shared/hooks/use-debounce';
import { useOverlaySocket, type SongRequest } from '@/meloming/domains/overlay/hooks/use-overlay-socket';
import { useYouTubePlayer, type PlaybackProgress } from '@/meloming/domains/overlay/hooks/use-youtube-player';
import { isCorsMediaPlaybackUrl } from '@/meloming/domains/overlay/utils/is-cors-media-playback-url';
import {
  useActiveSession,
  useStartSession,
  useEndSession,
  useUpdateSessionSettings,
  useSessionHistory,
  useCloneSession,
} from '@/meloming/domains/overlay/hooks/use-session';
import { useOverlayToken } from '@/meloming/domains/channel/hooks/use-overlay-token';
import {
  LEGACY_DISABLED_REQUEST_SETTINGS,
  type KaraokePlaybackMode,
  type KaraokeVideoType,
} from '@/meloming/domains/overlay/apis/session';
import { getSongRequestQueue } from '@/meloming/domains/overlay/apis/song-requests';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import {
  usePlayNext,
  usePlayNow,
  useDeleteSongRequest,
  useClearQueue,
  useUpdateSongRequestStatus,
  useUpdateSongRequestOrder,
  useCreateSongRequest,
  useCreateManualSongRequest,
  useSongRequestQueue,
  useNowPlaying,
} from '@/meloming/domains/overlay/hooks/use-song-requests';
import type { Song, GetSongsChannelIdentifierResponse } from '@/meloming/domains/channel/types/song';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchGatewayPlaybackUrl } from '@/meloming/domains/overlay/apis/gateway-playback';
import { TotalOverlayLayoutSettings } from '@/meloming/domains/overlay/components/overlay-settings-content';
import {
  SessionSettingsFields,
  type RequestSettingsState,
} from '@/meloming/domains/overlay/components/session-settings-fields';
import { SessionHistory } from '@/meloming/domains/overlay/components/session-history';
import { WidgetSettingsDialog } from '@/meloming/domains/overlay/components/overlay-unified-settings/WidgetSettingsDialog';
import { ThemeConfigSection } from '@/meloming/domains/overlay/components/overlay-unified-settings/ThemeConfigSection';
import { ConsoleKaraokeSuggestions } from '@/meloming/domains/overlay/components/console-karaoke-suggestions';
import {
  LyricsBody,
  LyricsFooter,
  LyricsToolbar,
  useLyricsPanelController,
} from '@/meloming/domains/overlay/components/lyrics-panel';
import { SheetMusicSection } from '@/meloming/domains/channel/components/sheet-music';
import { useSongByChannelIdentifierSongId } from '@/meloming/domains/channel/hooks/use-songs';
import { OverlayCopyGuideDialog } from '@/meloming/domains/overlay/components/overlay-copy-guide-dialog';
import {
  omakaseKeys,
  useAdjustConsoleOmakase,
  useConsoleOmakaseHistory,
  useConsoleOmakaseStatus,
  useConsumeConsoleOmakase,
  useSetConsoleOmakaseCount,
  useUpdateOmakaseSettings,
} from '@/meloming/domains/overlay/hooks/use-omakase';
import type { OmakaseStatus } from '@/meloming/domains/overlay/apis/omakase';
import { EndSessionConfirmDialog } from '@/meloming/domains/overlay/components/end-session-confirm-dialog';
import { type WidgetType } from '@/meloming/domains/channel/apis/overlay-theme';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/meloming/shared/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/meloming/shared/components/ui/collapsible';
import { extractApiErrorMessage } from '@/meloming/shared/lib/api-error';

const NOW_PLAYING_CLEAR_GRACE_MS = 1200;
const NOW_PLAYING_NULL_SYNC_CLEAR_GRACE_MS = 3500;
const PLAY_NEXT_CLIENT_COOLDOWN_MS = 3000;
const CONSOLE_PLAYER_VOLUME_STORAGE_KEY = 'meloming:console-player-volume';
const DEFAULT_CONSOLE_PLAYER_VOLUME = 100;

function clampPlayerVolume(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CONSOLE_PLAYER_VOLUME;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const PitchShiftSection = dynamic(
  () =>
    import('@/meloming/domains/overlay/components/pitch-shift-section').then(
      (mod) => mod.PitchShiftSection,
    ),
  { ssr: false },
);

// 간소화된 카테고리 타입 (표시에 필요한 필드만)
interface SimpleSongCategory {
  id: number;
  name: string;
  color: string;
}

interface QueueItem {
  id: number;
  position: number;
  title: string;
  artist: string;
  requester: string;
  status: 'pending' | 'accepted' | 'playing' | 'completed' | 'rejected';
  albumArt?: string;
  songId?: number;
  karaokeUrl?: string;
  coverUrl?: string | null;
  originalUrl?: string | null;
  mrVideoUrl?: string | null;
  lyricsText?: string | null;
  // 추가 Song 정보
  description?: string | null;
  lyricsLink?: string | null;
  difficulty?: number | null;
  proficiency?: number | null;
  songKey?: string | null;
  bpm?: number | null;
  categories?: SimpleSongCategory[];
  calculatedPrice?: number | null;
  priceSource?: string | null;
  formattedPrice?: string | null;
  completedAt?: string | null;
  rejectionReason?: string | null;
}

interface NowPlayingData {
  id: number;
  /** Song.id (nowPlayingData.song?.id 를 flatten). PATCH 대상으로 사용. */
  songId?: number | null;
  title: string;
  artist: string;
  requester: string;
  albumArt?: string;
  karaokeUrl?: string;
  coverUrl?: string | null;
  originalUrl?: string | null;
  mrVideoUrl?: string | null;
  lyricsText?: string | null;
  // 추가 Song 정보
  description?: string | null;
  lyricsLink?: string | null;
  difficulty?: number | null;
  proficiency?: number | null;
  songKey?: string | null;
  bpm?: number | null;
  categories?: SimpleSongCategory[];
  calculatedPrice?: number | null;
  priceSource?: string | null;
  formattedPrice?: string | null;
  /** 콘솔 키 조절(pitch shift) 저장값 — pitchSemitones 초기값으로 사용. */
  preferredPitchSemitones?: number | null;
  /** 콘솔 가사 sync 보정값(ms) — lyrics-panel offset 슬라이더 초기값으로 사용. */
  preferredLyricsOffsetMs?: number | null;
}

interface RecentlyEndedSession {
  id: number;
  status: 'ENDED';
  endedAt: string;
}

export interface LiveConsoleContentProps {
  user: string;
  overlayToken?: string | null;
  isPopup?: boolean;
}

function formatRequestPrice(
  calculatedPrice?: number | null,
  formattedPrice?: string | null,
): string | null {
  if (formattedPrice != null) {
    const trimmed = formattedPrice.trim();
    if (trimmed !== '') {
      return trimmed;
    }
    return calculatedPrice == null ? '무료' : null;
  }
  if (calculatedPrice == null) {
    return '무료';
  }
  return `${calculatedPrice.toLocaleString()}원`;
}

function formatSongDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'yyyy.MM.dd');
}

// 웹소켓 연결 상태 인디케이터
function WebSocketIndicator({
  isConnected,
  isJoined,
  connectionStatus,
  onReconnect,
}: {
  isConnected: boolean;
  isJoined: boolean;
  connectionStatus: string;
  onReconnect: () => void;
}) {
  if (isConnected && isJoined) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="relative flex size-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex rounded-full size-2 bg-emerald-500" />
        </span>
        <span className="text-[11px] text-emerald-500 font-medium">연결됨</span>
      </div>
    );
  }

  if (connectionStatus === 'reconnecting') {
    return (
      <div className="flex items-center gap-1.5">
        <Loader2 className="size-3 animate-spin text-amber-500" />
        <span className="text-[11px] text-amber-500">재연결 중</span>
      </div>
    );
  }

  if (connectionStatus === 'disconnected') {
    return (
      <button
        onClick={onReconnect}
        className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
      >
        <WifiOff className="size-3 text-destructive" />
        <span className="text-[11px] text-destructive">연결 끊김</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Loader2 className="size-3 animate-spin text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">연결 중</span>
    </div>
  );
}

// 신청곡 세션 상태 인디케이터
function SessionStatusIndicator({ isLive }: { isLive: boolean }) {
  if (isLive) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="relative flex size-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full size-2 bg-primary" />
        </span>
        <span className="text-[11px] text-primary font-medium">신청곡 모드 ON</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex size-2">
        <span className="relative inline-flex rounded-full size-2 bg-muted-foreground" />
      </span>
      <span className="text-[11px] text-muted-foreground font-medium">신청곡 모드 OFF</span>
    </div>
  );
}

// 신청곡 대기열 아이템
// 큐 항목 사이 hover-only 삽입 슬롯. 평소엔 보이지 않다가 마우스 올리면 + 버튼이
// 노출된다. 클릭하면 추가 모달이 'AFTER' 모드로 열려 그 자리에 끼워넣을 수 있다.
function QueueInsertSlot({ onClick }: { onClick: () => void }) {
  return (
    <div className="group/slot relative h-3 -my-1.5 z-10">
      <button
        type="button"
        onClick={onClick}
        aria-label="이 자리에 신청곡 추가"
        className="absolute inset-x-0 -inset-y-1 flex items-center justify-center opacity-0 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      >
        <span className="flex w-full items-center gap-1.5 px-1">
          <span className="flex-1 h-px bg-primary/40" />
          <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Plus className="size-3" />
          </span>
          <span className="flex-1 h-px bg-primary/40" />
        </span>
      </button>
    </div>
  );
}

function QueueCard({
  item,
  index,
  onMoveUp,
  onMoveDown,
  onPlay,
  onDelete,
}: {
  item: QueueItem;
  index: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPlay: () => void;
  onDelete: () => void;
}) {
  const priceLabel = formatRequestPrice(item.calculatedPrice, item.formattedPrice);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className="group relative"
    >
      <div className={cn(
        "flex items-center gap-3 p-3 rounded-lg transition-all duration-200",
        "bg-muted/50 hover:bg-muted border hover:border-border/80",
      )}>
        {/* 순서 & 드래그 핸들 */}
        <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
          <button
            onClick={onMoveUp}
            className="p-0.5 hover:text-foreground hover:bg-accent rounded transition-colors"
          >
            <ChevronUp className="size-3.5" />
          </button>
          <span className="text-[10px] font-mono tabular-nums w-5 text-center">
            {item.position}
          </span>
          <button
            onClick={onMoveDown}
            className="p-0.5 hover:text-foreground hover:bg-accent rounded transition-colors"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>

        {/* 앨범 아트 */}
        {item.albumArt ? (
          <img
            src={item.albumArt}
            alt={item.title}
            className="size-10 rounded-md object-cover shrink-0 ring-1 ring-border"
          />
        ) : (
          <div className="size-10 rounded-md bg-muted flex items-center justify-center shrink-0 ring-1 ring-border">
            <Music className="size-4 text-muted-foreground" />
          </div>
        )}

        {/* 곡 정보 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium truncate">
              {item.title}
            </span>
            {priceLabel && (
              <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30">
                <Coins className="size-2.5 mr-0.5" />
                {priceLabel}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 space-y-0.5">
            <p className="text-xs text-muted-foreground truncate">
              {item.artist}
            </p>
            <p className="text-[11px] text-muted-foreground/80 truncate">
              신청자 {item.requester}
            </p>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="icon"
            variant="ghost"
            className="size-7 hover:text-primary hover:bg-primary/10"
            onClick={onPlay}
          >
            <Play className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 hover:bg-accent"
                aria-label="신청곡 작업"
              >
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={onDelete}>
                <Trash2 className="mr-2 size-3.5" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </motion.div>
  );
}

// 난이도 표시 컴포넌트
function DifficultyStars({ difficulty }: { difficulty: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <div
          key={star}
          className={cn(
            "size-1.5 rounded-full transition-colors",
            star <= difficulty ? "bg-amber-500" : "bg-border"
          )}
        />
      ))}
    </div>
  );
}

// 링크 버튼 컴포넌트
function LinkButton({
  href,
  icon: Icon,
  label,
  variant = 'default',
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  variant?: 'default' | 'karaoke' | 'cover' | 'original' | 'lyrics';
}) {
  const variantStyles = {
    default: 'hover:bg-accent hover:text-accent-foreground',
    karaoke: 'hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30',
    cover: 'hover:bg-violet-500/10 hover:text-violet-500 hover:border-violet-500/30',
    original: 'hover:bg-emerald-500/10 hover:text-emerald-500 hover:border-emerald-500/30',
    lyrics: 'hover:bg-sky-500/10 hover:text-sky-500 hover:border-sky-500/30',
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border bg-background text-muted-foreground text-xs transition-all",
        variantStyles[variant]
      )}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
      <ExternalLink className="size-3 opacity-50" />
    </a>
  );
}

// 현재 재생 중인 곡 카드 (홈 탭용)
function NowPlayingCard({
  nowPlaying,
  nextSong,
  queue,
  isPlayerReady,
  onPlayNext,
  isLoading,
  canPlayNext,
  // 이전 세션 복원 (활성 세션 없음 + 최근 30분 이내 종료 시 노출)
  canRestartLastSession,
  onRestartLastSession,
  isRestartingLastSession,
  // 비디오 관련 props
  videoUrl,
  useHtml5Player,
  fallbackVideoUrl,
  fallbackVideoRef,
  fallbackError,
  isResolvingFallback,
  onRetryFallback,
  onFallbackError,
  fallbackNotice,
  isYoutubePlaybackChecking,
  onRetryYoutubeEmbed,
  playbackMode,
  onPlaybackModeChange,
  playbackModeDisabled,
  playerVolume,
  restorePlayerVolume,
  onPlayerVolumeChange,
  // karaokeUrl 없을 때 부모가 주입하는 추천 영상 섹션 (선택)
  karaokeSuggestionsSlot,
  // song-request socket payload 에 일부 song 메타가 없을 수 있어 곡 상세 응답을 우선 사용.
  currentSongDetail,
  // 콘솔 키 조절 저장 PATCH 에 사용. webPath 또는 channelId 문자열.
  channelIdentifier,
  // 콘솔 키 조절 저장 후 nowPlaying 캐시 invalidate 용.
  sessionId,
}: {
  nowPlaying: NowPlayingData | null;
  nextSong: QueueItem | null;
  queue: QueueItem[];
  isPlayerReady: boolean;
  onPlayNext: () => void;
  isLoading: boolean;
  canPlayNext: boolean;
  canRestartLastSession: boolean;
  onRestartLastSession: () => void;
  isRestartingLastSession: boolean;
  // 비디오 관련 props
  videoUrl: string | null | undefined;
  useHtml5Player: boolean;
  fallbackVideoUrl: string | null;
  fallbackVideoRef: React.RefObject<HTMLVideoElement | null>;
  fallbackError: string | null;
  isResolvingFallback: boolean;
  onRetryFallback: () => void;
  onFallbackError: (message: string) => void;
  fallbackNotice: string | null;
  isYoutubePlaybackChecking: boolean;
  onRetryYoutubeEmbed: () => void;
  playbackMode: KaraokePlaybackMode;
  onPlaybackModeChange?: (value: KaraokePlaybackMode) => void;
  playbackModeDisabled?: boolean;
  playerVolume: number;
  restorePlayerVolume: number;
  onPlayerVolumeChange: (volume: number) => void;
  karaokeSuggestionsSlot?: React.ReactNode;
  currentSongDetail?: Song | null;
  channelIdentifier: string;
  sessionId: number | null;
}) {
  const [isDescriptionOpen, setIsDescriptionOpen] = useState(false);
  const [mediaTab, setMediaTab] = useState<'video' | 'mr' | 'info' | 'queue'>(
    videoUrl ? 'video' : 'mr',
  );

  // videoUrl 이 새로 생기거나 바뀌면 영상 탭으로 자동 전환 (MR 에서 곡/오버라이드
  // 선택 시 즉시 영상 패널 노출).
  const prevVideoUrlRef = useRef(videoUrl);
  useEffect(() => {
    const prev = prevVideoUrlRef.current;
    prevVideoUrlRef.current = videoUrl;
    if (videoUrl && videoUrl !== prev) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- videoUrl 외부 prop 의 transition 반응 (MR/정보 → 영상 자동 전환)
      setMediaTab('video');
    }
  }, [videoUrl]);

  const isDirectPlayback = playbackMode === 'DIRECT';

  // 비디오/MR 슬롯 가용성에 따라 활성 탭 보정 (state 동기화 대신 derive).
  // info/queue 탭은 항상 가용하므로 fallback 후보에 포함.
  const effectiveMediaTab: 'video' | 'mr' | 'info' | 'queue' =
    mediaTab === 'video' && !videoUrl
      ? karaokeSuggestionsSlot
        ? 'mr'
        : 'info'
      : mediaTab === 'mr' && !karaokeSuggestionsSlot
        ? videoUrl
          ? 'video'
          : 'info'
        : mediaTab;

  const handleRequestPip = useCallback(async () => {
    const video = fallbackVideoRef.current;
    if (!video) {
      toast.error('PIP를 사용하려면 직접 재생 모드여야 합니다');
      return;
    }
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        return;
      }
      await video.requestPictureInPicture();
    } catch {
      toast.error('이 브라우저에서는 PIP를 지원하지 않습니다');
    }
  }, [fallbackVideoRef]);

  // 키 조절 (Pitch shift) feature flag — flag OFF 면 PitchShiftSection 자체가
  // mount 되지 않아 usePitchShift hook 도 호출되지 않고 AudioContext 생성도 차단된다.
  const isPitchShiftEnabled = useFeatureFlag('consolePitchShift');

  // 링크들 필터링 (존재하는 것만)
  const links = nowPlaying ? [
    ...(nowPlaying.mrVideoUrl
      ? [{ href: nowPlaying.mrVideoUrl, icon: Video, label: 'MR 영상', variant: 'karaoke' as const }]
      : [
          { href: nowPlaying.karaokeUrl, icon: Mic2, label: '노래방', variant: 'karaoke' as const },
          { href: nowPlaying.coverUrl, icon: Disc3, label: '커버', variant: 'cover' as const },
          { href: nowPlaying.originalUrl, icon: Music, label: '원곡', variant: 'original' as const },
        ]),
    { href: nowPlaying.lyricsLink, icon: Link2, label: '가사 링크', variant: 'lyrics' as const },
  ].filter(link => link.href) : [];
  const displayCategories = useMemo<SimpleSongCategory[]>(() => {
    const source =
      currentSongDetail?.categories && currentSongDetail.categories.length > 0
        ? currentSongDetail.categories
        : nowPlaying?.categories ?? [];

    return source.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color || '#64748b',
    }));
  }, [currentSongDetail?.categories, nowPlaying?.categories]);

  const infoDifficulty = currentSongDetail?.difficulty ?? nowPlaying?.difficulty ?? null;
  const infoProficiency = currentSongDetail?.proficiency ?? nowPlaying?.proficiency ?? null;
  const infoSongKey = currentSongDetail?.songKey ?? nowPlaying?.songKey ?? null;
  const infoBpm = currentSongDetail?.bpm ?? nowPlaying?.bpm ?? null;
  const hasExplicitPriceInfo =
    nowPlaying?.calculatedPrice != null ||
    (typeof nowPlaying?.formattedPrice === 'string' &&
      nowPlaying.formattedPrice.trim() !== '');
  const requestPriceLabel = nowPlaying && hasExplicitPriceInfo
    ? formatRequestPrice(nowPlaying.calculatedPrice, nowPlaying.formattedPrice)
    : null;
  const favoritesCount =
    typeof currentSongDetail?.totalFavorites === 'number'
      ? currentSongDetail.totalFavorites
      : null;
  const sheetMusicCount =
    currentSongDetail?.sheetMusics?.length ??
    (currentSongDetail?.sheetMusicUrl ? 1 : 0);
  const registeredAtLabel = formatSongDate(currentSongDetail?.createdAt);

  // 메타 정보 존재 여부 (가사는 부모 vertical split 의 별도 패널로 분리됨)
  const hasMetaInfo = Boolean(
    infoDifficulty ||
      infoProficiency ||
      infoSongKey ||
      infoBpm ||
      requestPriceLabel ||
      favoritesCount != null ||
      sheetMusicCount > 0 ||
      registeredAtLabel,
  );
  const hasCategories = displayCategories.length > 0;
  const hasDescription = nowPlaying?.description;
  const hasLinks = links.length > 0;
  const hasSongInfo = hasMetaInfo || hasCategories || hasDescription || hasLinks;
  const isPlayerMuted = playerVolume <= 0;

  const handleVolumeSliderChange = useCallback(
    ([nextVolume]: number[]) => {
      onPlayerVolumeChange(clampPlayerVolume(nextVolume ?? 0));
    },
    [onPlayerVolumeChange],
  );

  const handleToggleMute = useCallback(() => {
    onPlayerVolumeChange(isPlayerMuted ? restorePlayerVolume : 0);
  }, [isPlayerMuted, onPlayerVolumeChange, restorePlayerVolume]);

  if (!nowPlaying) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="size-20 rounded-2xl bg-muted flex items-center justify-center mb-4 ring-1 ring-border">
          <Music className="size-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground font-medium mb-1">재생 중인 곡이 없습니다</p>
        <p className="text-xs text-muted-foreground/70 mb-4">대기열에서 곡을 선택하거나 다음 곡을 재생하세요</p>
        <div className="flex flex-col items-center gap-2">
          <Button
            size="sm"
            onClick={onPlayNext}
            disabled={!canPlayNext}
          >
            <Play className="size-3.5 mr-1.5" />
            첫 곡 시작
          </Button>
          {canRestartLastSession && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRestartLastSession}
              disabled={isRestartingLastSession}
              title="최근 30분 이내 종료된 세션의 설정과 신청곡을 그대로 복원합니다"
            >
              {isRestartingLastSession ? (
                <Loader2 className="size-3.5 mr-1.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5 mr-1.5" />
              )}
              이전 세션 다시 시작
            </Button>
          )}
        </div>
      </div>
    );
  }


  const playbackModeLabel = isDirectPlayback
    ? '직접 재생'
    : useHtml5Player
      ? '직접 재생 전환됨'
      : 'YouTube 임베드';
  const showYoutubePlaybackCheck =
    !isDirectPlayback &&
    !useHtml5Player &&
    isYoutubePlaybackChecking &&
    !fallbackError &&
    !isResolvingFallback;
  const showFallbackNotice =
    !isDirectPlayback &&
    useHtml5Player &&
    !!fallbackNotice &&
    !fallbackError &&
    !isResolvingFallback;

  const videoPlayer = videoUrl ? (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={handleRequestPip}
          disabled={!useHtml5Player || !fallbackVideoUrl || !!fallbackError}
          title={
            useHtml5Player
              ? '브라우저 PIP로 영상을 띄웁니다'
              : 'YouTube 임베드 모드에서는 PIP를 지원하지 않습니다. 직접 재생 모드로 전환하세요.'
          }
        >
          <PictureInPicture2 className="mr-1.5 size-3.5" />
          PIP
        </Button>
        {onPlaybackModeChange && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">재생 모드</span>
            <Select
              value={playbackMode}
              onValueChange={(value) => onPlaybackModeChange(value as KaraokePlaybackMode)}
              disabled={playbackModeDisabled}
            >
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DIRECT">직접 재생</SelectItem>
                <SelectItem value="YOUTUBE">YouTube 임베드</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-md border bg-background/70 px-2.5 py-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          onClick={handleToggleMute}
          aria-label={isPlayerMuted ? '볼륨 켜기' : '음소거'}
          title={isPlayerMuted ? '볼륨 켜기' : '음소거'}
        >
          {isPlayerMuted ? (
            <VolumeX className="size-3.5" />
          ) : (
            <Volume2 className="size-3.5" />
          )}
        </Button>
        <Slider
          value={[playerVolume]}
          min={0}
          max={100}
          step={1}
          onValueChange={handleVolumeSliderChange}
          aria-label="영상 볼륨"
          className="flex-1"
        />
        <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {playerVolume}%
        </span>
      </div>
      <div className="relative mx-auto aspect-video w-full max-w-md overflow-hidden rounded-md bg-black shadow-lg ring-1 ring-border">
        <div
          id="youtube-player-container"
          className={cn(
            "absolute inset-0 h-full w-full",
            (useHtml5Player || fallbackError) && "invisible"
          )}
        />

        {useHtml5Player && fallbackVideoUrl && (
          <video
            // Re-mount the element on every URL change. createMediaElementSource
            // (used by usePitchShift) permanently locks the bound <video> to
            // its first src in some browsers, so we let React drop the old
            // element and create a fresh one on each playback URL change.
            key={fallbackVideoUrl}
            ref={fallbackVideoRef}
            src={fallbackVideoUrl}
            // Only opt into CORS for our gateway or CloudFront media host
            // (which guarantee Access-Control-Allow-Origin). For raw
            // upstream URLs (rare niconico/docs links saved as karaokeUrl)
            // crossOrigin would cause the browser to taint the response and
            // refuse to play, so we keep the legacy no-CORS behaviour there.
            crossOrigin={
              isCorsMediaPlaybackUrl(fallbackVideoUrl) ? 'anonymous' : undefined
            }
            className="absolute inset-0 z-10 h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
            onPlay={() => {
              if (sessionId && nowPlaying?.id) {
                posthog.capture('playback_state_changed', {
                  session_id: sessionId,
                  request_id: nowPlaying.id,
                  song_id: nowPlaying.songId ?? null,
                  state: 'playing',
                  source: 'html5_fallback',
                  video_url: fallbackVideoUrl ?? null,
                });
              }
            }}
            onPause={() => {
              if (sessionId && nowPlaying?.id) {
                posthog.capture('playback_state_changed', {
                  session_id: sessionId,
                  request_id: nowPlaying.id,
                  song_id: nowPlaying.songId ?? null,
                  state: 'paused',
                  source: 'html5_fallback',
                  video_url: fallbackVideoUrl ?? null,
                });
              }
            }}
            onEnded={() => {
              if (sessionId && nowPlaying?.id) {
                posthog.capture('playback_state_changed', {
                  session_id: sessionId,
                  request_id: nowPlaying.id,
                  song_id: nowPlaying.songId ?? null,
                  state: 'ended',
                  source: 'html5_fallback',
                  video_url: fallbackVideoUrl ?? null,
                });
              }
            }}
            onVolumeChange={(e) => {
              const video = e.currentTarget as HTMLVideoElement;
              onPlayerVolumeChange(video.muted ? 0 : video.volume * 100);
            }}
            onError={(e) => {
              const err = (e.currentTarget as HTMLVideoElement).error;
              const msg =
                err?.code === 2
                  ? '네트워크 에러로 영상을 불러올 수 없습니다'
                  : err?.code === 3
                    ? '영상 디코딩에 실패했습니다'
                    : err?.code === 4
                      ? '지원하지 않는 영상 포맷입니다'
                      : '영상을 재생할 수 없습니다';
              onFallbackError(msg);
            }}
          />
        )}

        {!useHtml5Player && !isPlayerReady && !fallbackError && !isResolvingFallback && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
            <Loader2 className="size-5 animate-spin text-white" />
          </div>
        )}

        {isResolvingFallback && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80">
            <Loader2 className="size-6 animate-spin text-white" />
            <p className="text-sm text-white/70">
              {isDirectPlayback ? '직접 재생 URL 가져오는 중...' : '직접 재생으로 전환하는 중...'}
            </p>
          </div>
        )}

        {fallbackError && !isResolvingFallback && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 p-3">
            <AlertTriangle className="size-7 text-amber-500" />
            <div className="space-y-1 text-center">
              <p className="text-sm text-white/90">영상을 불러오지 못했습니다</p>
              <p className="text-xs text-white/60">
                {isDirectPlayback
                  ? '이 영상은 직접 재생을 지원하지 않습니다.'
                  : 'YouTube 임베드와 직접 재생 전환을 확인해주세요.'}
              </p>
              <p className="text-[10px] text-white/40">{fallbackError}</p>
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {!isDirectPlayback && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8"
                  onClick={onRetryYoutubeEmbed}
                >
                  <RefreshCw className="mr-1.5 size-3.5" />
                  YouTube 다시
                </Button>
              )}
              <Button
                size="sm"
                variant={isDirectPlayback ? "secondary" : "outline"}
                className="h-8"
                onClick={onRetryFallback}
              >
                <RefreshCw className="mr-1.5 size-3.5" />
                직접 재생 재시도
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => window.open(videoUrl, '_blank', 'noopener,noreferrer')}
              >
                <ExternalLink className="mr-1.5 size-3.5" />
                새 창
              </Button>
            </div>
          </div>
        )}
      </div>

      {isPitchShiftEnabled && (
        <PitchShiftSection
          fallbackVideoRef={fallbackVideoRef}
          useHtml5Player={useHtml5Player}
          fallbackVideoUrl={fallbackVideoUrl}
          fallbackError={fallbackError}
          nowPlayingId={nowPlaying?.id}
          songKey={infoSongKey}
          bpm={infoBpm}
          songId={nowPlaying?.songId}
          channelIdentifier={channelIdentifier}
          savedPitchSemitones={nowPlaying?.preferredPitchSemitones ?? null}
          sessionId={sessionId}
        />
      )}

      {showYoutubePlaybackCheck && (
        <div className="flex items-start gap-2 rounded-md border border-sky-500/20 bg-sky-500/10 px-2.5 py-2 text-[11px] text-sky-700 dark:text-sky-200">
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
          <p className="leading-4">
            YouTube 재생을 확인 중입니다. 8초 안에 영상이 시작되지 않으면 직접 재생으로 전환합니다.
          </p>
        </div>
      )}

      {showFallbackNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-100">
          <span className="min-w-0 leading-4">{fallbackNotice}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={onRetryYoutubeEmbed}
          >
            <RefreshCw className="mr-1 size-3" />
            YouTube 다시
          </Button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="space-y-3">
      {/* 현재 재생 중 카드 (곡 정보 + 다음 곡 버튼) */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-muted to-muted/50 border">
        {/* 배경 블러 이미지 */}
        {nowPlaying.albumArt && (
          <div
            className="absolute inset-0 opacity-10 blur-2xl scale-110"
            style={{
              backgroundImage: `url(${nowPlaying.albumArt})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          />
        )}

        <div className="relative flex items-center gap-3 p-3">
          {nowPlaying.albumArt ? (
            <motion.img
              src={nowPlaying.albumArt}
              alt={nowPlaying.title}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="size-11 shrink-0 rounded-md object-cover shadow ring-1 ring-border"
            />
          ) : (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-border">
              <Music className="size-5 text-muted-foreground" />
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <p className="mb-0.5 flex items-center gap-1 text-[9px] font-medium text-primary leading-none">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              NOW PLAYING
            </p>
            <div className="flex min-w-0 items-center gap-1.5">
              <h3 className="truncate text-sm font-bold">{nowPlaying.title}</h3>
              {formatRequestPrice(
                nowPlaying.calculatedPrice,
                nowPlaying.formattedPrice,
              ) && (
                <Badge variant="outline" className="h-4 shrink-0 border-fuchsia-500/30 bg-fuchsia-500/10 px-1 text-[9px] text-fuchsia-700 dark:text-fuchsia-300">
                  <Coins className="mr-0.5 size-2.5" />
                  {formatRequestPrice(
                    nowPlaying.calculatedPrice,
                    nowPlaying.formattedPrice,
                  )}
                </Badge>
              )}
            </div>
            <p className="truncate text-[11px] text-muted-foreground leading-tight">
              {nowPlaying.artist} · {nowPlaying.requester}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={onPlayNext}
            disabled={isLoading || !canPlayNext}
          >
            {isLoading ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <SkipForward className="mr-1.5 size-3.5" />
            )}
            다음 곡
          </Button>
        </div>
      </div>

      {/* 영상 / 노래방·MR / 정보 통합 카드 (탭) — 영상 패널은 항상 mount 유지 */}
      <div className="rounded-xl border bg-muted/20 p-2">
        <div className="mb-2 flex items-center gap-1 border-b pb-1.5">
          <button
            type="button"
            onClick={() => setMediaTab('video')}
            disabled={!videoUrl}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              effectiveMediaTab === 'video'
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-background/60",
              !videoUrl && "cursor-not-allowed opacity-40",
            )}
          >
            <Video className="size-3.5" />
            영상
            {videoUrl && (
              <span className="ml-1 text-[9px] font-normal text-muted-foreground">
                · {playbackModeLabel}
              </span>
            )}
          </button>
          {karaokeSuggestionsSlot && (
            <button
              type="button"
              onClick={() => setMediaTab('mr')}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                effectiveMediaTab === 'mr'
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-background/60",
              )}
            >
              <Music className="size-3.5" />
              노래방/MR
              {nowPlaying?.karaokeUrl && (
                <span className="ml-0.5 inline-flex size-1.5 rounded-full bg-emerald-500" title="저장된 URL 있음" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setMediaTab('queue')}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              effectiveMediaTab === 'queue'
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-background/60",
            )}
          >
            <ListMusic className="size-3.5" />
            대기열
            {queue.length > 0 && (
              <span className={cn(
                "ml-0.5 rounded-full px-1 text-[9px] font-medium tabular-nums",
                effectiveMediaTab === 'queue'
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted-foreground/15 text-muted-foreground",
              )}>
                {queue.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setMediaTab('info')}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
              effectiveMediaTab === 'info'
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-background/60",
            )}
          >
            <FileText className="size-3.5" />
            정보
          </button>
        </div>

        {/* 영상 패널 — 탭 전환 시에도 mount 유지 (YT/직접 재생 끊김 방지) */}
        <div className={cn("px-1", effectiveMediaTab === 'video' ? "block" : "hidden")}>
          {videoUrl ? (
            videoPlayer
          ) : (
            <p className="py-3 text-center text-[11px] text-muted-foreground">
              재생할 영상 링크가 없습니다
            </p>
          )}
        </div>

        {/* 노래방/MR 패널 — 활성 시에만 렌더 */}
        {effectiveMediaTab === 'mr' && karaokeSuggestionsSlot && (
          <div className="px-1">{karaokeSuggestionsSlot}</div>
        )}

        {/* 정보 패널 — 곡 상세 / 악보 / 다음 곡 통합 */}
        {effectiveMediaTab === 'info' && (
          <div className="space-y-3 px-1">
            {hasSongInfo && (
              <div className="rounded-lg bg-background/40 border overflow-hidden">
                <div className="p-3 flex flex-wrap items-center gap-3">
                  {hasMetaInfo && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {infoDifficulty && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border">
                          <Gauge className="size-3 text-amber-500" />
                          <span className="text-[10px] text-muted-foreground">난이도</span>
                          <DifficultyStars difficulty={infoDifficulty} />
                        </div>
                      )}
                      {infoProficiency && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border">
                          <Gauge className="size-3 text-emerald-500" />
                          <span className="text-[10px] text-muted-foreground">숙련도</span>
                          <DifficultyStars difficulty={infoProficiency} />
                        </div>
                      )}
                      {infoSongKey && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border">
                          <Hash className="size-3 text-blue-500" />
                          <span className="text-[10px] text-muted-foreground">키</span>
                          <span className="text-xs font-medium">{infoSongKey}</span>
                        </div>
                      )}
                      {infoBpm && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border">
                          <Timer className="size-3 text-green-500" />
                          <span className="text-xs font-medium tabular-nums">{infoBpm}</span>
                          <span className="text-[10px] text-muted-foreground">BPM</span>
                        </div>
                      )}
                      {requestPriceLabel && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border">
                          <Coins className="size-3 text-fuchsia-500" />
                          <span className="text-[10px] text-muted-foreground">신청가</span>
                          <span className="text-xs font-medium">{requestPriceLabel}</span>
                        </div>
                      )}
                      {favoritesCount != null && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border">
                          <CheckCircle2 className="size-3 text-rose-500" />
                          <span className="text-[10px] text-muted-foreground">좋아요</span>
                          <span className="text-xs font-medium tabular-nums">
                            {favoritesCount.toLocaleString()}
                          </span>
                        </div>
                      )}
                      {sheetMusicCount > 0 && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border">
                          <FileMusic className="size-3 text-indigo-500" />
                          <span className="text-[10px] text-muted-foreground">악보</span>
                          <span className="text-xs font-medium tabular-nums">
                            {sheetMusicCount}개
                          </span>
                        </div>
                      )}
                      {registeredAtLabel && (
                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/50 border">
                          <History className="size-3 text-slate-500" />
                          <span className="text-[10px] text-muted-foreground">등록일</span>
                          <span className="text-xs font-medium tabular-nums">
                            {registeredAtLabel}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {hasMetaInfo && hasLinks && (
                    <div className="h-5 w-px bg-border" />
                  )}
                  {hasLinks && (
                    <div className="flex items-center gap-1">
                      {links.map((link) => (
                        <LinkButton
                          key={link.label}
                          href={link.href!}
                          icon={link.icon}
                          label={link.label}
                          variant={link.variant}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {hasCategories && (
                  <div className="px-3 pb-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                      <Tags className="size-3" />
                      카테고리
                    </span>
                    {displayCategories.map((category) => (
                      <Badge
                        key={category.id}
                        variant="secondary"
                        className="h-5 px-2 text-[10px] font-normal"
                        style={{
                          backgroundColor: `${category.color}15`,
                          color: category.color,
                          borderColor: `${category.color}30`,
                        }}
                      >
                        {category.name}
                      </Badge>
                    ))}
                  </div>
                )}
                {hasDescription && (
                  <Collapsible open={isDescriptionOpen} onOpenChange={setIsDescriptionOpen}>
                    <CollapsibleTrigger asChild>
                      <button className="w-full flex items-center justify-between px-3 py-2 border-t hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileText className="size-3" />
                          <span>메모</span>
                        </div>
                        <ChevronRight
                          className={cn(
                            "size-3.5 text-muted-foreground transition-transform duration-200",
                            isDescriptionOpen && "rotate-90"
                          )}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="px-3 pb-3 border-t"
                      >
                        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap pt-3">
                          {nowPlaying.description}
                        </p>
                      </motion.div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}

            {!hasSongInfo && (
              <p className="py-3 text-center text-[11px] text-muted-foreground">
                추가 정보가 없습니다
              </p>
            )}
          </div>
        )}

        {/* 대기열 패널 — 다음 곡 목록 미리보기 (read-only). 큐 관리는 별도 큐 탭에서. */}
        {effectiveMediaTab === 'queue' && (
          <div className="px-1">
            {queue.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-muted-foreground">
                대기 중인 곡이 없습니다
              </p>
            ) : (
              <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
                {queue.map((item, idx) => {
                  const priceLabel = formatRequestPrice(item.calculatedPrice, item.formattedPrice);
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md border bg-background/40 p-1.5",
                        idx === 0 && "border-primary/40 bg-primary/5",
                      )}
                    >
                      <span className="w-6 shrink-0 text-center text-[10px] font-mono tabular-nums text-muted-foreground">
                        {idx === 0 ? 'NEXT' : item.position}
                      </span>
                      {item.albumArt ? (
                        <img
                          src={item.albumArt}
                          alt={item.title}
                          className="size-7 shrink-0 rounded object-cover ring-1 ring-border"
                        />
                      ) : (
                        <div className="flex size-7 shrink-0 items-center justify-center rounded bg-muted ring-1 ring-border">
                          <Music className="size-3 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="truncate text-[12px] font-medium leading-tight">
                            {item.title}
                          </span>
                          {priceLabel && (
                            <Badge variant="outline" className="h-4 shrink-0 border-fuchsia-500/30 bg-fuchsia-500/10 px-1 text-[9px] text-fuchsia-700 dark:text-fuchsia-300">
                              <Coins className="mr-0.5 size-2.5" />
                              {priceLabel}
                            </Badge>
                          )}
                        </div>
                        <p className="truncate text-[10px] text-muted-foreground leading-tight">
                          {item.artist} · {item.requester}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Phase 8.1 Concern #1 fix:
 * nowPlaying 페이로드(song-request select)에는 sheetMusicUrl/Type 이 포함되지 않으므로,
 * songId 가 있는 경우 매니저-shape 의 song detail 을 추가로 fetch 해서
 * SheetMusicSection 의 initial 상태로 hydrate 한다.
 *
 * 백엔드 song-request select 를 확장하지 않은 이유: 다른 신청곡 컨슈머(viewer 페이지 등)에
 * 매니저 전용 sheetMusicUrl 이 새어나갈 위험이 있어 scope 을 한정.
 */
/**
 * 좌측 vertical split 하단에 들어가는 가사 섹션.
 * sticky 헤더 한 줄에 (Mic2 + "가사") + LyricsToolbar(전체/한줄씩, 한글 발음, 오프셋)을
 * 함께 배치. 본문 스크롤해도 헤더 + 컨트롤 항상 노출.
 */
function LyricsResizableSection({
  identifier,
  songId,
  initialPreferredLyricsOffsetMs,
  fallbackText,
  getCurrentTime,
  fallbackVideoRef,
  useHtml5Player,
  sessionId,
  overlayToken,
  songRequestId,
  videoPlaybackState,
  videoDurationMs,
}: {
  identifier: string;
  songId: number | null;
  initialPreferredLyricsOffsetMs?: number | null;
  fallbackText?: string | null;
  getCurrentTime?: () => number;
  fallbackVideoRef?: React.RefObject<HTMLVideoElement | null>;
  useHtml5Player?: boolean;
  sessionId: number | null;
  overlayToken: string | null;
  songRequestId: number | null;
  videoPlaybackState?: 'playing' | 'paused' | 'ended' | 'buffering' | 'unstarted';
  videoDurationMs?: number;
}) {
  const controller = useLyricsPanelController({
    identifier,
    songId,
    initialPreferredLyricsOffsetMs,
    fallbackText,
    getCurrentTime,
    fallbackVideoRef,
    useHtml5Player,
    sessionId,
    songRequestId,
    mode: 'publisher',
    videoPlaybackState,
    videoDurationMs,
  });
  // lyrics widget room subscribe — 다른 콘솔/오버레이의 sync state 수신.
  useOverlaySocket(overlayToken ?? null, {
    widgetType: 'lyrics',
    enabled: !!overlayToken && !!sessionId,
    onLyricsPlaybackState: controller.applyExternalState,
  });
  return (
    <section className="h-full overflow-y-auto border-t bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 border-b text-xs text-muted-foreground bg-background">
        <Mic2 className="size-3 shrink-0" />
        <span className="shrink-0">가사</span>
        <LyricsToolbar controller={controller} />
      </div>
      <LyricsBody controller={controller} />
      <LyricsFooter controller={controller} />
    </section>
  );
}

function CurrentSongSheetSlot({
  user,
  songId,
  compact,
}: {
  user: string;
  songId: number;
  compact?: boolean;
}) {
  const { data: song } = useSongByChannelIdentifierSongId(user, songId);
  return (
    <SheetMusicSection
      // songId 기반 key — 곡이 바뀌면 컴포넌트가 재마운트되어 페이지/줌 상태 초기화
      key={`sheet-${songId}`}
      channelIdentifier={user}
      songId={songId}
      initialSlots={song?.sheetMusics ?? null}
      initialUrl={song?.sheetMusicUrl ?? null}
      initialType={song?.sheetMusicType ?? null}
      canManage={true}
      readOnly
      compact={compact}
      songTitle={song?.title ?? null}
    />
  );
}

/**
 * 좌측 vertical split 의 sheet music 패널. LyricsResizableSection 과 동일한
 * sticky header + 본문 자체 스크롤 구조 — 라이브 중 가사·악보를 항상 시야 안에
 * 두고 비율을 자유롭게 조정할 수 있게 한다. 곡에 악보가 없으면 부모가 패널을
 * 통째로 mount 하지 않아 빈 공간을 차지하지 않는다.
 */
function SheetMusicResizableSection({
  user,
  songId,
}: {
  user: string;
  songId: number;
}) {
  return (
    <section className="h-full overflow-y-auto border-t bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 border-b text-xs text-muted-foreground bg-background">
        <FileMusic className="size-3 shrink-0" />
        <span className="shrink-0">악보 (매니저 전용)</span>
      </div>
      <div className="p-2">
        <CurrentSongSheetSlot user={user} songId={songId} compact />
      </div>
    </section>
  );
}

export function LiveConsoleContent({
  user,
  overlayToken: propOverlayToken,
}: LiveConsoleContentProps) {
  const [activeTab, setActiveTab] = useState<
    'home' | 'queue' | 'omakase' | 'overlay' | 'settings' | 'session-history'
  >('home');
  const [sideTab, setSideTab] = useState<'song' | 'overlay'>('song');
  const [overlaySubTab, setOverlaySubTab] = useState<'settings' | 'theme'>('settings');
  const [historyDetailSessionId, setHistoryDetailSessionId] = useState<number | null>(null);
  const [widgetSettingsType, setWidgetSettingsType] = useState<WidgetType | null>(null);
  const [obsGuide, setObsGuide] = useState<{
    url: string;
    widgetName: string;
    width: number;
    height: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [history, setHistory] = useState<QueueItem[]>([]);
  const [queueSubTab, setQueueSubTab] = useState<'queue' | 'history'>('queue');
  const [nowPlaying, setNowPlaying] = useState<NowPlayingData | null>(null);
  const nowPlayingIdRef = useRef<number | null>(null);
  const nowPlayingNullClearTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const playNextInFlightRef = useRef(false);
  const lastPlayNextAtRef = useRef(0);
  const requestSyncRef = useRef<((reason?: string) => void) | null>(null);
  // 현재 재생 중인 곡의 song detail (sheetMusic 유무 판정용). nowPlaying payload 에는
  // 매니저 전용 sheetMusicUrl 이 포함되지 않으므로 별도 fetch. CurrentSongSheetSlot
  // 의 동일 query 와 react-query level 에서 dedupe 됨.
  const nowPlayingSongQuery = useSongByChannelIdentifierSongId(
    user,
    nowPlaying?.songId ?? undefined,
  );
  const nowPlayingHasSheetMusic =
    !!nowPlayingSongQuery.data?.sheetMusicUrl &&
    !!nowPlayingSongQuery.data?.sheetMusicType;
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [addMode, setAddMode] = useState<'songbook' | 'manual'>('songbook');
  const [manualArtist, setManualArtist] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualMemo, setManualMemo] = useState('');
  const [isOmakaseConsumeMode, setIsOmakaseConsumeMode] = useState(false);
  const [omakasePlayNow, setOmakasePlayNow] = useState(false);
  const [omakaseSetValue, setOmakaseSetValue] = useState('');
  const [omakaseEnabledDraft, setOmakaseEnabledDraft] = useState(false);
  const [omakaseDisplayNameDraft, setOmakaseDisplayNameDraft] = useState('오마카세');
  const [omakasePriceDraft, setOmakasePriceDraft] = useState('0');
  // 추가 위치: 'FRONT'(다음 재생) / 'BACK'(맨 뒤). 큐 항목 사이 + 버튼에서 모달을 열면
  // addInsertAfterId 가 세팅되어 라디오가 'AFTER' 모드로 잠긴다.
  const [addPosition, setAddPosition] = useState<'FRONT' | 'BACK'>('BACK');
  const [addInsertAfterId, setAddInsertAfterId] = useState<number | null>(null);

  // YouTube 임베드 fallback 관련 상태
  const [useFallbackPlayer, setUseFallbackPlayer] = useState(false);
  const [fallbackVideoUrl, setFallbackVideoUrl] = useState<string | null>(null);
  const [isResolvingFallback, setIsResolvingFallback] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const fallbackVideoRef = useRef<HTMLVideoElement>(null);
  const resolverRequestIdRef = useRef(0);
  const isResolvingFallbackRef = useRef(false);
  const useFallbackPlayerRef = useRef(false);
  const directResolvedRef = useRef<string | null>(null);
  const [fallbackState, setFallbackState] = useState<PlaybackProgress['state']>('unstarted');
  const fallbackStateRef = useRef<PlaybackProgress['state']>('unstarted');
  // anchor 모델로 통합되면서 fallback video 의 metadata(duration) 를 lyrics-panel
  // 로 전달해 anchor publish 트리거에 활용. live-console 자체는 더 이상 progress
  // 를 backend 에 push 하지 않는다.
  const [fallbackVideoDurationMs, setFallbackVideoDurationMs] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(DEFAULT_CONSOLE_PLAYER_VOLUME);
  const lastNonZeroPlayerVolumeRef = useRef(DEFAULT_CONSOLE_PLAYER_VOLUME);
  const didHydrateStoredVolumeRef = useRef(false);

  // 설정 상태
  const [requestEnabled, setRequestEnabled] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const requestEnabledRef = useRef(true);
  const [maxQueueSize, setMaxQueueSize] = useState(50);
  const [requireSongMatch, setRequireSongMatch] = useState(true);
  const [karaokePlaybackMode, setKaraokePlaybackMode] = useState<KaraokePlaybackMode>('YOUTUBE');
  const [karaokeVideoType, setKaraokeVideoType] = useState<KaraokeVideoType>('KARAOKE');
  // 리모콘 "이번만 재생" 임시 override. 곡 변경 시 아래 useEffect 가 자동 초기화.
  const [ephemeralKaraoke, setEphemeralKaraoke] = useState<{
    songRequestId: number;
    url: string;
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArtistId, setSelectedArtistId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [artistDropdownOpen, setArtistDropdownOpen] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);

  const debouncedSearch = useDebounce(searchQuery, 300);
  const queueInitializedRef = useRef(false);
  const prevSessionIdRef = useRef<number | null>(null);

  const { data: activeSession, isLoading: sessionLoading } = useActiveSession(user);
  const startSessionMutation = useStartSession(user);
  const endSessionMutation = useEndSession(user);
  const updateSettingsMutation = useUpdateSessionSettings(user);
  const cloneSessionMutation = useCloneSession(user);
  // 최근 세션 1건만 조회 — 세션 종료 후 30분 이내 '이전 세션 다시 시작' 버튼 노출용
  const { data: recentSessionsData } = useSessionHistory(1, 1, user);
  const [recentlyEndedSession, setRecentlyEndedSession] =
    useState<RecentlyEndedSession | null>(null);
  // 시간 경과에 따른 버튼 노출 조건 재평가를 위한 1분 ticker.
  // recentSessionsData가 변하지 않아도 29분 → 30분 경계를 넘기면 버튼이 자동으로 사라져야 한다.
  const [nowForSessionWindow, setNowForSessionWindow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowForSessionWindow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const latestEndedSession = useMemo(() => {
    const first = recentlyEndedSession ?? recentSessionsData?.sessions?.[0];
    if (!first || first.status !== 'ENDED' || !first.endedAt) return null;
    const endedAtMs = new Date(first.endedAt).getTime();
    if (!Number.isFinite(endedAtMs)) return null;
    const elapsedMin = (nowForSessionWindow - endedAtMs) / 60000;
    return elapsedMin >= 0 && elapsedMin <= 30 ? first : null;
  }, [recentlyEndedSession, recentSessionsData, nowForSessionWindow]);

  const isLyricsConsoleEnabled = useFeatureFlag('musixmatchLyricsConsole');
  const isSheetMusicEnabled = useFeatureFlag('songbookSheetMusic');
  const { data: myChannels } = useMyChannel();
  const { data: publicChannel } = useChannel(user, {
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });
  const normalizedUser = user.trim().toLowerCase();
  const myChannel =
    myChannels?.find((channel) => channel.webPath.toLowerCase() === normalizedUser) ??
    myChannels?.find((channel) => channel.isOwner) ??
    myChannels?.[0];
  const sheetChannelId = myChannel?.id;
  const { listQuery: sheetCategoriesQuery } = useCategoriesManagement(sheetChannelId ?? 0);
  const sheetCategories = sheetCategoriesQuery.data;

  const [sheetSettingsDraft, setSheetSettingsDraft] = useState<
    Partial<RequestSettingsState>
  >({});
  const [isPracticeModeDialogOpen, setIsPracticeModeDialogOpen] = useState(false);

  const activeSessionEndedLocally =
    !!recentlyEndedSession && activeSession?.id === recentlyEndedSession.id;
  const isLive =
    !!activeSession &&
    activeSession.status === 'ACTIVE' &&
    !activeSessionEndedLocally;
  const isPracticeMode = activeSession?.visibility === 'PRIVATE';
  // 채널 토큰 fallback — 신청곡 모드 시작 안 한 경우에도 영구 채널 토큰을 가져와 노출
  // JWT 쿠키 있으면 성공, 없으면(외부 매니저 console-token 모드) silent fail 후 activeSession fallback
  const { data: channelTokenData, isLoading: channelTokenLoading } = useOverlayToken(user);
  const overlayToken =
    (!activeSessionEndedLocally ? activeSession?.overlayToken : null) ??
    propOverlayToken ??
    channelTokenData?.overlayToken ??
    null;
  const sessionId = activeSessionEndedLocally ? null : activeSession?.id ?? null;
  const overlayBaseUrl = process.env.NEXT_PUBLIC_OVERLAY_BASE_URL;
  const normalizedOverlayBaseUrl = (overlayBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
  const omakaseEnabledForConsole = Boolean(sessionId);
  const { data: omakaseStatus } = useConsoleOmakaseStatus(omakaseEnabledForConsole);
  const { data: omakaseHistory = [] } = useConsoleOmakaseHistory(
    omakaseEnabledForConsole && activeTab === 'omakase',
  );
  const queryClient = useQueryClient();
  const omakaseSettingsChannelId =
    activeSession?.channelId ?? sheetChannelId ?? publicChannel?.id ?? null;
  const updateOmakaseSettingsMutation =
    useUpdateOmakaseSettings(omakaseSettingsChannelId);
  const omakaseDisplayName = omakaseStatus?.displayName || '오마카세';
  const omakaseCount = omakaseStatus?.count ?? 0;
  const omakaseControlsEnabled = Boolean(sessionId && omakaseStatus?.enabled);

  const playNextMutation = usePlayNext(sessionId);
  const playNowMutation = usePlayNow(sessionId);
  const deleteMutation = useDeleteSongRequest(sessionId);
  const clearQueueMutation = useClearQueue(sessionId);
  const updateStatusMutation = useUpdateSongRequestStatus(sessionId);
  const updateOrderMutation = useUpdateSongRequestOrder(sessionId);
  const createRequestMutation = useCreateSongRequest(sessionId);
  const createManualRequestMutation = useCreateManualSongRequest(sessionId);
  const adjustOmakaseMutation = useAdjustConsoleOmakase();
  const setOmakaseCountMutation = useSetConsoleOmakaseCount();
  const consumeOmakaseMutation = useConsumeConsoleOmakase();

  const syncConsoleOmakaseStatus = useCallback(
    (status?: OmakaseStatus | null) => {
      if (!status) return;
      queryClient.setQueryData(omakaseKeys.consoleStatus, status);
      queryClient.invalidateQueries({ queryKey: omakaseKeys.consoleHistory });
    },
    [queryClient],
  );
  const { data: queueData } = useSongRequestQueue(sessionId, false);
  const { data: nowPlayingData } = useNowPlaying(sessionId);

  useEffect(() => {
    if (!omakaseStatus) return;
    setOmakaseEnabledDraft(omakaseStatus.enabled);
    setOmakaseDisplayNameDraft(omakaseStatus.displayName || '오마카세');
    setOmakasePriceDraft(String(omakaseStatus.price ?? 0));
  }, [
    omakaseStatus?.enabled,
    omakaseStatus?.displayName,
    omakaseStatus?.price,
  ]);

  useEffect(() => {
    if (activeTab === 'omakase' && !omakaseEnabledForConsole) {
      setActiveTab('home');
    }
  }, [activeTab, omakaseEnabledForConsole]);

  useEffect(() => {
    requestEnabledRef.current = requestEnabled;
  }, [requestEnabled]);

  useEffect(() => {
    nowPlayingIdRef.current = nowPlaying?.id ?? null;
  }, [nowPlaying?.id]);

  const clearPendingNowPlayingClear = useCallback(() => {
    if (nowPlayingNullClearTimerRef.current) {
      clearTimeout(nowPlayingNullClearTimerRef.current);
      nowPlayingNullClearTimerRef.current = null;
    }
  }, []);

  const applySyncedNowPlaying = useCallback(
    (next: NowPlayingData) => {
      clearPendingNowPlayingClear();
      nowPlayingIdRef.current = next.id;
      setNowPlaying(next);
    },
    [clearPendingNowPlayingClear],
  );

  const scheduleNowPlayingClear = useCallback(
    (
      requestId?: number | null,
      delayMs = NOW_PLAYING_CLEAR_GRACE_MS,
    ) => {
      const targetId = requestId ?? nowPlayingIdRef.current;
      if (!targetId) {
        clearPendingNowPlayingClear();
        nowPlayingIdRef.current = null;
        setNowPlaying(null);
        return;
      }

      clearPendingNowPlayingClear();
      nowPlayingNullClearTimerRef.current = setTimeout(() => {
        if (nowPlayingIdRef.current === targetId) {
          nowPlayingIdRef.current = null;
          setNowPlaying(null);
        }
        nowPlayingNullClearTimerRef.current = null;
      }, delayMs);
    },
    [clearPendingNowPlayingClear],
  );

  const scheduleNowPlayingClearFromNullSync = useCallback(
    (isLive?: boolean | null) => {
      if (isLive === false) {
        scheduleNowPlayingClear(nowPlayingIdRef.current);
        return;
      }

      const targetId = nowPlayingIdRef.current;
      if (!targetId) {
        clearPendingNowPlayingClear();
        nowPlayingIdRef.current = null;
        setNowPlaying(null);
        return;
      }

      requestSyncRef.current?.('now-playing-null-recheck');
      scheduleNowPlayingClear(targetId, NOW_PLAYING_NULL_SYNC_CLEAR_GRACE_MS);
    },
    [clearPendingNowPlayingClear, scheduleNowPlayingClear],
  );

  useEffect(() => {
    return () => {
      clearPendingNowPlayingClear();
    };
  }, [clearPendingNowPlayingClear]);

  // 세션 활성화 시 기록(COMPLETED/REJECTED) 로드
  useEffect(() => {
    if (!sessionId || !isLive) {
      setHistory([]);
      return;
    }
    getSongRequestQueue(sessionId, true).then((data) => {
      const historyItems = data.queue
        .filter((req) => req.status === 'COMPLETED' || req.status === 'REJECTED')
        .map((req) => ({
          id: req.id,
          position: 0,
          title: req.song?.title || req.rawTitle,
          artist: req.song?.artist?.name || req.rawArtist,
          requester: req.requesterNickname,
          status: req.status.toLowerCase() as QueueItem['status'],
          albumArt: req.song?.albumArt,
          songId: req.song?.id,
          karaokeUrl: req.song?.karaokeUrl,
          coverUrl: req.song?.coverUrl,
          originalUrl: req.song?.originalUrl,
          mrVideoUrl: req.song?.mrVideoUrl,
          lyricsText: req.song?.lyricsText ?? null,
          lyricsLink: req.song?.lyricsLink ?? null,
          description: req.song?.description ?? null,
          difficulty: req.song?.difficulty ?? null,
          proficiency: req.song?.proficiency ?? null,
          songKey: req.song?.songKey ?? null,
          bpm: req.song?.bpm ?? null,
          categories: req.song?.categories?.map((c) => ({ id: c.id, name: c.name, color: c.color })),
          calculatedPrice: req.calculatedPrice ?? null,
          priceSource: req.priceSource ?? null,
          formattedPrice: req.formattedPrice ?? null,
          completedAt: req.completedAt ?? req.updatedAt ?? null,
          rejectionReason: req.rejectionReason ?? null,
        }))
        .sort((a, b) => {
          const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          return dateB - dateA;
        });
      setHistory(historyItems);
    }).catch(() => {
      // 초기 로드 실패 시 무시 — WebSocket으로 실시간 갱신됨
    });
  }, [sessionId, isLive]);

  const handleStartLive = async (practiceMode = false) => {
    try {
      await startSessionMutation.mutateAsync(
        practiceMode ? { practiceMode: true } : {},
      );
      setRecentlyEndedSession(null);
      toast.success(
        practiceMode
          ? '연습모드가 시작되었습니다'
          : '신청곡 모드가 시작되었습니다',
      );
    } catch (error: unknown) {
      toast.error(
        extractApiErrorMessage(
          error,
          practiceMode
            ? '연습모드 시작에 실패했습니다'
            : '신청곡 모드 시작에 실패했습니다',
        ),
      );
    }
  };

  const handleConfirmStartPracticeMode = () => {
    setIsPracticeModeDialogOpen(false);
    void handleStartLive(true);
  };

  const handleRestartLastSession = async () => {
    if (!latestEndedSession) return;
    try {
      await cloneSessionMutation.mutateAsync(latestEndedSession.id);
      setRecentlyEndedSession(null);
      toast.success('이전 세션이 복원되었습니다');
    } catch (error: unknown) {
      const message = extractApiErrorMessage(error, '');
      if (typeof message === 'string' && message.includes('활성화된')) {
        toast.error('이미 진행 중인 세션이 있습니다. 먼저 종료해주세요.');
      } else {
        toast.error(message || '이전 세션 복원에 실패했습니다');
      }
    }
  };

  type EndConfirmIntent =
    | { type: 'direct' }
    | { type: 'sheet-settings'; sessionId: number };

  const [endConfirmIntent, setEndConfirmIntent] =
    useState<EndConfirmIntent | null>(null);

  const handleRequestEndLive = () => {
    if (!activeSession) return;
    setEndConfirmIntent({ type: 'direct' });
  };

  const handleConfirmEndSession = async () => {
    if (!endConfirmIntent) return;
    try {
      let endedSession: RecentlyEndedSession | null = null;
      if (endConfirmIntent.type === 'direct') {
        if (!activeSession) {
          setEndConfirmIntent(null);
          return;
        }
        const result = await endSessionMutation.mutateAsync(activeSession.id);
        endedSession = {
          id: result.id,
          status: 'ENDED',
          endedAt: result.endedAt ?? new Date().toISOString(),
        };
        toast.success('신청곡 모드가 종료되었습니다');
      } else {
        const result = await endSessionMutation.mutateAsync(endConfirmIntent.sessionId);
        endedSession = {
          id: result.id,
          status: 'ENDED',
          endedAt: result.endedAt ?? new Date().toISOString(),
        };
        toast.success('신청곡 모드를 끄고 세션을 종료했습니다');
        setSheetSettingsDraft({});
      }
      setRecentlyEndedSession(endedSession);
      setNowForSessionWindow(Date.now());
      setEndConfirmIntent(null);
    } catch (error: unknown) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : '신청곡 모드 종료에 실패했습니다';
      toast.error(message);
    }
  };

  const { isConnected, isJoined, connectionStatus, reconnect, requestSync } = useOverlaySocket(overlayToken ?? null, {
    widgetType: 'songlist',
    enabled: isLive && !!overlayToken,
    onRequestAdded: (request) => {
      const newItem: QueueItem = {
        id: request.id,
        position: request.position,
        title: request.title,
        artist: request.artist,
        requester: request.requester,
        status: request.status,
        albumArt: request.albumArt,
        songId: request.songId,
        karaokeUrl: request.karaokeUrl,
        coverUrl: request.coverUrl,
        originalUrl: request.originalUrl,
        mrVideoUrl: request.mrVideoUrl,
        lyricsText: request.lyricsText,
        // 추가 Song 정보
        lyricsLink: request.lyricsLink,
        description: request.description,
        difficulty: request.difficulty,
        proficiency: request.proficiency,
        songKey: request.songKey,
        bpm: request.bpm,
        categories: request.categories,
        calculatedPrice: request.calculatedPrice ?? null,
        priceSource: request.priceSource ?? null,
        formattedPrice: request.formattedPrice ?? null,
      };
      setQueue((prev) =>
        [...prev, newItem].sort((a, b) => a.position - b.position).map((q, idx) => ({
          ...q,
          position: idx + 1,
        }))
      );
    },
    onRequestUpdated: (request) => {
      if (request.status === 'playing') {
        setQueue((prev) =>
          prev.filter((q) => q.id !== request.id).map((q, idx) => ({ ...q, position: idx + 1 }))
        );
        applySyncedNowPlaying({
          id: request.id,
          songId: request.songId ?? null,
          title: request.title,
          artist: request.artist,
          requester: request.requester,
          albumArt: request.albumArt,
          karaokeUrl: request.karaokeUrl,
          coverUrl: request.coverUrl,
          originalUrl: request.originalUrl,
          mrVideoUrl: request.mrVideoUrl,
          lyricsText: request.lyricsText,
          // 추가 Song 정보
          lyricsLink: request.lyricsLink,
          description: request.description,
          difficulty: request.difficulty,
          proficiency: request.proficiency,
          songKey: request.songKey,
          bpm: request.bpm,
          categories: request.categories,
          calculatedPrice: request.calculatedPrice ?? null,
          priceSource: request.priceSource ?? null,
          formattedPrice: request.formattedPrice ?? null,
          preferredPitchSemitones: request.preferredPitchSemitones ?? null,
          preferredLyricsOffsetMs: request.preferredLyricsOffsetMs ?? null,
        });
        return;
      }
      if (request.status === 'completed' || request.status === 'rejected') {
        setQueue((prev) =>
          prev.filter((q) => q.id !== request.id).map((q, idx) => ({ ...q, position: idx + 1 }))
        );
        if (nowPlayingIdRef.current === request.id) {
          scheduleNowPlayingClear(request.id);
        }
        setHistory((prev) => {
          if (prev.some((h) => h.id === request.id)) return prev;
          const historyItem: QueueItem = {
            id: request.id,
            position: 0,
            title: request.title,
            artist: request.artist,
            requester: request.requester,
            status: request.status,
            albumArt: request.albumArt,
            songId: request.songId,
            karaokeUrl: request.karaokeUrl,
            coverUrl: request.coverUrl ?? null,
            originalUrl: request.originalUrl ?? null,
            mrVideoUrl: request.mrVideoUrl ?? null,
            lyricsText: request.lyricsText ?? null,
            lyricsLink: request.lyricsLink ?? null,
            description: request.description ?? null,
            difficulty: request.difficulty ?? null,
            proficiency: request.proficiency ?? null,
            songKey: request.songKey ?? null,
            bpm: request.bpm ?? null,
            categories: request.categories,
            calculatedPrice: request.calculatedPrice ?? null,
            priceSource: request.priceSource ?? null,
            formattedPrice: request.formattedPrice ?? null,
            completedAt: request.completedAt ?? new Date().toISOString(),
            rejectionReason: request.rejectionReason ?? null,
          };
          return [historyItem, ...prev];
        });
        return;
      }
      setQueue((prev) =>
        prev.map((q) =>
          q.id === request.id
            ? {
                ...q,
                status: request.status,
                title: request.title,
                artist: request.artist,
                calculatedPrice: request.calculatedPrice ?? q.calculatedPrice ?? null,
                priceSource: request.priceSource ?? q.priceSource ?? null,
                formattedPrice: request.formattedPrice ?? q.formattedPrice ?? null,
              }
            : q
        )
      );
    },
    onRequestRemoved: (requestId) => {
      setQueue((prev) =>
        prev.filter((q) => q.id !== requestId).map((q, idx) => ({ ...q, position: idx + 1 }))
      );
      if (nowPlayingIdRef.current === requestId) {
        clearPendingNowPlayingClear();
        nowPlayingIdRef.current = null;
        setNowPlaying(null);
      }
    },
    onQueueReordered: (newQueue, data) => {
      syncConsoleOmakaseStatus(data?.omakase);
      setQueue(
        newQueue.map((req, idx) => ({
          id: req.id,
          position: idx + 1,
          title: req.title,
          artist: req.artist,
          requester: req.requester,
          status: req.status,
          albumArt: req.albumArt,
          songId: req.songId,
          karaokeUrl: req.karaokeUrl,
          coverUrl: req.coverUrl,
          originalUrl: req.originalUrl,
          mrVideoUrl: req.mrVideoUrl,
          lyricsText: req.lyricsText,
          // 추가 Song 정보
          lyricsLink: req.lyricsLink,
          description: req.description,
          difficulty: req.difficulty,
          proficiency: req.proficiency,
          songKey: req.songKey,
          bpm: req.bpm,
          categories: req.categories,
          calculatedPrice: req.calculatedPrice ?? null,
          priceSource: req.priceSource ?? null,
          formattedPrice: req.formattedPrice ?? null,
        }))
      );
    },
    onSettingsUpdated: (settings) => {
      if (!settings) return;
      const nextRequestEnabled =
        typeof settings.requestEnabled === 'boolean'
          ? settings.requestEnabled
          : requestEnabledRef.current;
      if (typeof settings.requestEnabled === 'boolean') {
        setRequestEnabled(settings.requestEnabled);
        if (!settings.requestEnabled) {
          setIsPaused(false);
        }
      }
      if (typeof settings.paused === 'boolean') {
        setIsPaused(nextRequestEnabled ? settings.paused : false);
      }
      if (typeof settings.maxQueueSize === 'number') {
        setMaxQueueSize(settings.maxQueueSize);
      }
      if (typeof settings.requireSongMatch === 'boolean') {
        setRequireSongMatch(settings.requireSongMatch);
      }
      if (typeof settings.karaokePlaybackMode === 'string') {
        setKaraokePlaybackMode(settings.karaokePlaybackMode as KaraokePlaybackMode);
      }
      if (typeof settings.karaokeVideoType === 'string') {
        setKaraokeVideoType(settings.karaokeVideoType as KaraokeVideoType);
      }
    },
    onQueueSync: (data) => {
      syncConsoleOmakaseStatus(data?.omakase);
      const syncedQueue = Array.isArray(data?.queue) ? data.queue : [];
      setQueue(
        syncedQueue
          .filter((req: SongRequest) =>
            req.status === 'pending' || req.status === 'accepted',
          )
          .map((req: SongRequest, idx: number) => ({
            id: req.id,
            position: req.position ?? idx + 1,
            title: req.title,
            artist: req.artist,
            requester: req.requester,
            status: req.status,
            albumArt: req.albumArt,
            songId: req.songId,
            karaokeUrl: req.karaokeUrl,
            coverUrl: req.coverUrl,
            originalUrl: req.originalUrl,
            mrVideoUrl: req.mrVideoUrl,
            lyricsText: req.lyricsText ?? null,
            lyricsLink: req.lyricsLink ?? null,
            description: req.description ?? null,
            difficulty: req.difficulty ?? null,
            proficiency: req.proficiency ?? null,
            songKey: req.songKey ?? null,
            bpm: req.bpm ?? null,
            categories: req.categories,
            calculatedPrice: req.calculatedPrice ?? null,
            priceSource: req.priceSource ?? null,
            formattedPrice: req.formattedPrice ?? null,
          }))
      );

      if (data?.nowPlaying) {
        const now = data.nowPlaying as SongRequest;
        applySyncedNowPlaying({
          id: now.id,
          songId: now.songId ?? null,
          title: now.title,
          artist: now.artist,
          requester: now.requester,
          albumArt: now.albumArt,
          karaokeUrl: now.karaokeUrl,
          coverUrl: now.coverUrl,
          originalUrl: now.originalUrl,
          mrVideoUrl: now.mrVideoUrl,
          lyricsText: now.lyricsText ?? null,
          // 추가 Song 정보
          lyricsLink: now.lyricsLink ?? null,
          description: now.description ?? null,
          difficulty: now.difficulty ?? null,
          proficiency: now.proficiency ?? null,
          songKey: now.songKey ?? null,
          bpm: now.bpm ?? null,
          categories: now.categories,
          calculatedPrice: now.calculatedPrice ?? null,
          priceSource: now.priceSource ?? null,
          formattedPrice: now.formattedPrice ?? null,
          preferredPitchSemitones: now.preferredPitchSemitones ?? null,
          preferredLyricsOffsetMs: now.preferredLyricsOffsetMs ?? null,
        });
        return;
      }
      if (data && data.nowPlaying === null) {
        scheduleNowPlayingClearFromNullSync(data.isLive);
      }
    },
    onSessionEnded: () => {
      clearPendingNowPlayingClear();
      nowPlayingIdRef.current = null;
      setNowPlaying(null);
      setQueue([]);
      setHistory([]);
    },
  });

  useEffect(() => {
    requestSyncRef.current = requestSync ?? null;
  }, [requestSync]);

  useEffect(() => {
    if (isJoined) {
      requestSync?.('init');
    }
  }, [isJoined, requestSync]);

  useEffect(() => {
    if (!activeSession?.settings) {
      setRequireSongMatch(true);
      return;
    }
    const nextRequestEnabled = activeSession.settings.requestEnabled ?? true;
    setRequestEnabled(nextRequestEnabled);
    if (!nextRequestEnabled) {
      setIsPaused(false);
    } else {
      setIsPaused(activeSession.settings.paused ?? false);
    }
    setMaxQueueSize(activeSession.settings.maxQueueSize ?? 50);
    setRequireSongMatch(activeSession.settings.requireSongMatch ?? true);
    setKaraokePlaybackMode(activeSession.settings.karaokePlaybackMode ?? 'YOUTUBE');
    setKaraokeVideoType(activeSession.settings.karaokeVideoType ?? 'KARAOKE');
  }, [
    activeSession?.id,
    activeSession?.settings?.requestEnabled,
    activeSession?.settings?.paused,
    activeSession?.settings?.maxQueueSize,
    activeSession?.settings?.requireSongMatch,
    activeSession?.settings?.karaokePlaybackMode,
    activeSession?.settings?.karaokeVideoType,
  ]);

  const applySessionSettings = async (settings: {
    requestEnabled?: boolean;
    paused?: boolean;
    maxQueueSize?: number;
    karaokePlaybackMode?: KaraokePlaybackMode;
    karaokeVideoType?: KaraokeVideoType;
  }) => {
    if (!sessionId) {
      toast.error('신청곡 모드가 활성화되어 있지 않습니다');
      return false;
    }
    try {
      await updateSettingsMutation.mutateAsync({ sessionId, settings });
      return true;
    } catch (error: unknown) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : '설정 변경에 실패했습니다';
      toast.error(message);
      return false;
    }
  };

  const sheetSettings: RequestSettingsState = {
    requestEnabled:
      sheetSettingsDraft.requestEnabled ??
      activeSession?.settings?.requestEnabled ??
      true,
    allowAnonymous:
      sheetSettingsDraft.allowAnonymous ??
      activeSession?.settings?.allowAnonymous ??
      false,
    randomRequestEnabled:
      sheetSettingsDraft.randomRequestEnabled ??
      activeSession?.settings?.randomRequestEnabled ??
      true,
    maxQueueSize:
      sheetSettingsDraft.maxQueueSize ??
      activeSession?.settings?.maxQueueSize ??
      50,
    requireSongMatch:
      sheetSettingsDraft.requireSongMatch ??
      activeSession?.settings?.requireSongMatch ??
      true,
    preventDuplicateSongs:
      sheetSettingsDraft.preventDuplicateSongs ??
      activeSession?.settings?.preventDuplicateSongs ??
      false,
    maxRequestsPerUser:
      sheetSettingsDraft.maxRequestsPerUser ??
      activeSession?.settings?.maxRequestsPerUser ??
      0,
    maxTotalRequests:
      sheetSettingsDraft.maxTotalRequests ??
      activeSession?.settings?.maxTotalRequests ??
      50,
    blockedCategoryIds:
      sheetSettingsDraft.blockedCategoryIds ??
      activeSession?.settings?.blockedCategoryIds ??
      [],
    showRequesterName:
      sheetSettingsDraft.showRequesterName ??
      activeSession?.settings?.showRequesterName ??
      true,
  };

  const hasSheetDraft = Object.keys(sheetSettingsDraft).length > 0;

  const handleSaveSheetSettings = async () => {
    if (!sessionId) {
      toast.error('신청곡 모드가 활성화되어 있지 않습니다');
      return;
    }

    if (sheetSettings.requestEnabled === false) {
      setEndConfirmIntent({ type: 'sheet-settings', sessionId });
      return;
    }

    try {
      await updateSettingsMutation.mutateAsync({
        sessionId,
        settings: {
          ...LEGACY_DISABLED_REQUEST_SETTINGS,
          requestEnabled: sheetSettings.requestEnabled,
          allowAnonymous: sheetSettings.allowAnonymous,
          randomRequestEnabled: sheetSettings.randomRequestEnabled,
          maxQueueSize: sheetSettings.maxQueueSize,
          requireSongMatch: sheetSettings.requireSongMatch,
          preventDuplicateSongs: sheetSettings.preventDuplicateSongs,
          maxRequestsPerUser: sheetSettings.maxRequestsPerUser,
          maxTotalRequests: sheetSettings.maxTotalRequests,
          blockedCategoryIds: sheetSettings.blockedCategoryIds,
          showRequesterName: sheetSettings.showRequesterName,
        },
      });
      toast.success('신청곡 설정이 저장되었습니다');
      setSheetSettingsDraft({});
    } catch (error: unknown) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : '설정 변경에 실패했습니다';
      toast.error(message);
    }
  };

  const handlePausedChange = async (value: boolean) => {
    const prevValue = isPaused;
    setIsPaused(value);
    const ok = await applySessionSettings({ paused: value });
    if (!ok) {
      setIsPaused(prevValue);
    }
  };

  const handleKaraokePlaybackModeChange = async (value: KaraokePlaybackMode) => {
    const prevValue = karaokePlaybackMode;
    setKaraokePlaybackMode(value);
    const ok = await applySessionSettings({ karaokePlaybackMode: value });
    if (!ok) {
      setKaraokePlaybackMode(prevValue);
    }
  };

  const handleKaraokeVideoTypeChange = async (value: KaraokeVideoType) => {
    const prevValue = karaokeVideoType;
    setKaraokeVideoType(value);
    const ok = await applySessionSettings({ karaokeVideoType: value });
    if (!ok) {
      setKaraokeVideoType(prevValue);
    }
  };

  const settingsDisabled =
    !isLive || updateSettingsMutation.isPending || endSessionMutation.isPending;

  const [isDesktopLayout, setIsDesktopLayout] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = () => setIsDesktopLayout(mql.matches);
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId ?? null;
      queueInitializedRef.current = false;
      setQueue([]);
    }

    if (!sessionId) {
      return;
    }
    if (!queueData || queueInitializedRef.current) {
      return;
    }
    queueInitializedRef.current = true;
    const normalizedQueue = queueData.queue.map((req) => ({
      id: req.id,
      title: req.song?.title || req.rawTitle || '',
      artist: req.song?.artist?.name || req.rawArtist || '',
      requester: req.requesterNickname || '익명',
      status: (req.status?.toLowerCase() || 'pending') as QueueItem['status'],
      albumArt: req.song?.albumArt,
      songId: req.song?.id,
      karaokeUrl: req.song?.karaokeUrl,
      coverUrl: req.song?.coverUrl,
      originalUrl: req.song?.originalUrl,
      mrVideoUrl: req.song?.mrVideoUrl,
      // 추가 Song 정보
      lyricsText: req.song?.lyricsText ?? null,
      lyricsLink: req.song?.lyricsLink ?? null,
      description: req.song?.description ?? null,
      difficulty: req.song?.difficulty ?? null,
      proficiency: req.song?.proficiency ?? null,
      songKey: req.song?.songKey ?? null,
      bpm: req.song?.bpm ?? null,
      categories: req.song?.categories,
      calculatedPrice: req.calculatedPrice ?? null,
      priceSource: req.priceSource ?? null,
      formattedPrice: req.formattedPrice ?? null,
      preferredPitchSemitones: req.song?.preferredPitchSemitones ?? null,
      preferredLyricsOffsetMs: req.song?.preferredLyricsOffsetMs ?? null,
    }));

    const playing = normalizedQueue.find((req) => req.status === 'playing') ?? null;
    if (playing) {
      applySyncedNowPlaying({
        id: playing.id,
        songId: playing.songId ?? null,
        title: playing.title,
        artist: playing.artist,
        requester: playing.requester,
        albumArt: playing.albumArt,
        karaokeUrl: playing.karaokeUrl,
        coverUrl: playing.coverUrl,
        originalUrl: playing.originalUrl,
        mrVideoUrl: playing.mrVideoUrl,
        lyricsText: playing.lyricsText,
        // 추가 Song 정보
        lyricsLink: playing.lyricsLink,
        description: playing.description,
        difficulty: playing.difficulty,
        proficiency: playing.proficiency,
        songKey: playing.songKey,
        bpm: playing.bpm,
        categories: playing.categories,
        calculatedPrice: playing.calculatedPrice ?? null,
        priceSource: playing.priceSource ?? null,
        formattedPrice: playing.formattedPrice ?? null,
        preferredPitchSemitones: playing.preferredPitchSemitones ?? null,
        preferredLyricsOffsetMs: playing.preferredLyricsOffsetMs ?? null,
      });
    } else if (isLive) {
      scheduleNowPlayingClearFromNullSync(true);
    } else {
      clearPendingNowPlayingClear();
      nowPlayingIdRef.current = null;
      setNowPlaying(null);
    }

    setQueue(
      normalizedQueue
        .filter(
          (req) => req.status === 'pending' || req.status === 'accepted',
        )
        .map((req, idx) => ({
          ...req,
          position: idx + 1,
        }))
    );
  }, [
    queueData,
    sessionId,
    isLive,
    applySyncedNowPlaying,
    scheduleNowPlayingClearFromNullSync,
    clearPendingNowPlayingClear,
  ]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    if (nowPlayingData) {
      applySyncedNowPlaying({
        id: nowPlayingData.id,
        songId: nowPlayingData.song?.id ?? null,
        title: nowPlayingData.song?.title || nowPlayingData.rawTitle,
        artist: nowPlayingData.song?.artist?.name || nowPlayingData.rawArtist,
        requester: nowPlayingData.requesterNickname,
        albumArt: nowPlayingData.song?.albumArt,
        karaokeUrl: nowPlayingData.song?.karaokeUrl,
        coverUrl: nowPlayingData.song?.coverUrl,
        originalUrl: nowPlayingData.song?.originalUrl,
        mrVideoUrl: nowPlayingData.song?.mrVideoUrl,
        lyricsText: nowPlayingData.song?.lyricsText ?? null,
        // 추가 Song 정보
        lyricsLink: nowPlayingData.song?.lyricsLink ?? null,
        description: nowPlayingData.song?.description ?? null,
        difficulty: nowPlayingData.song?.difficulty ?? null,
        proficiency: nowPlayingData.song?.proficiency ?? null,
        songKey: nowPlayingData.song?.songKey ?? null,
        bpm: nowPlayingData.song?.bpm ?? null,
        categories: nowPlayingData.song?.categories,
        calculatedPrice: nowPlayingData.calculatedPrice ?? null,
        priceSource: nowPlayingData.priceSource ?? null,
        formattedPrice: nowPlayingData.formattedPrice ?? null,
        preferredPitchSemitones:
          nowPlayingData.song?.preferredPitchSemitones ?? null,
        preferredLyricsOffsetMs:
          nowPlayingData.song?.preferredLyricsOffsetMs ?? null,
      });
      return;
    }
    if (nowPlayingData === null) {
      if (isLive) {
        scheduleNowPlayingClearFromNullSync(true);
        return;
      }
      clearPendingNowPlayingClear();
      nowPlayingIdRef.current = null;
      setNowPlaying(null);
    }
  }, [
    nowPlayingData,
    sessionId,
    isLive,
    applySyncedNowPlaying,
    scheduleNowPlayingClearFromNullSync,
    clearPendingNowPlayingClear,
  ]);

  const {
    data: songsInfiniteData,
    isLoading: songBookLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfinitePublicUserSongs(
    user,
    {
      limit: 50,
      search: debouncedSearch || undefined,
      artistId: selectedArtistId?.toString() || undefined,
      categoryId: selectedCategoryId?.toString() || undefined,
    },
    { enabled: isAddDialogOpen && addMode === 'songbook' }
  );

  const { data: artists = [] } = useUserArtists(user);
  const { data: categories = [] } = useUserCategories(user);

  const infiniteSongsData = songsInfiniteData as InfiniteData<GetSongsChannelIdentifierResponse> | undefined;
  const filteredSongBook = useMemo(
    () => infiniteSongsData?.pages?.flatMap((page) => page.songs) || [],
    [infiniteSongsData]
  );
  const nextSong = queue[0] || null;
  const canPlayNext = Boolean(sessionId) && queue.length > 0;

  const handlePlayNext = async () => {
    if (!sessionId || queue.length === 0) return;
    if (playNextInFlightRef.current || playNextMutation.isPending) return;

    const now = Date.now();
    if (now - lastPlayNextAtRef.current < PLAY_NEXT_CLIENT_COOLDOWN_MS) {
      return;
    }

    playNextInFlightRef.current = true;
    lastPlayNextAtRef.current = now;
    setIsLoading(true);
    try {
      const result = await playNextMutation.mutateAsync();
      if (result) {
        applySyncedNowPlaying({
          id: result.id,
          songId: result.song?.id ?? null,
          title: result.song?.title || result.rawTitle,
          artist: result.song?.artist?.name || result.rawArtist,
          requester: result.requesterNickname,
          albumArt: result.song?.albumArt,
          karaokeUrl: result.song?.karaokeUrl,
          coverUrl: result.song?.coverUrl,
          originalUrl: result.song?.originalUrl,
          mrVideoUrl: result.song?.mrVideoUrl,
          lyricsText: result.song?.lyricsText ?? null,
          // 추가 Song 정보
          lyricsLink: result.song?.lyricsLink ?? null,
          description: result.song?.description ?? null,
          difficulty: result.song?.difficulty ?? null,
          proficiency: result.song?.proficiency ?? null,
          songKey: result.song?.songKey ?? null,
          bpm: result.song?.bpm ?? null,
          categories: result.song?.categories,
          calculatedPrice: result.calculatedPrice ?? null,
          priceSource: result.priceSource ?? null,
          formattedPrice: result.formattedPrice ?? null,
          preferredPitchSemitones:
            result.song?.preferredPitchSemitones ?? null,
          preferredLyricsOffsetMs:
            result.song?.preferredLyricsOffsetMs ?? null,
        });
        setQueue((prev) =>
          prev
            .filter((item) => item.id !== result.id)
            .map((item, index) => ({ ...item, position: index + 1 })),
        );
        requestSync?.('play-next-success');
      } else {
        requestSync?.('queue.exhausted');
        if (!nowPlayingIdRef.current) {
          clearPendingNowPlayingClear();
          setNowPlaying(null);
        }
      }
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '다음 곡 재생에 실패했습니다'));
    } finally {
      playNextInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const handlePlayNow = async (item: QueueItem) => {
    setIsLoading(true);
    try {
      const result = await playNowMutation.mutateAsync(item.id);
      applySyncedNowPlaying({
        id: result.id,
        songId: result.song?.id ?? null,
        title: result.song?.title || result.rawTitle,
        artist: result.song?.artist?.name || result.rawArtist,
        requester: result.requesterNickname,
        albumArt: result.song?.albumArt,
        karaokeUrl: result.song?.karaokeUrl,
        coverUrl: result.song?.coverUrl,
        originalUrl: result.song?.originalUrl,
        mrVideoUrl: result.song?.mrVideoUrl,
        lyricsText: result.song?.lyricsText ?? null,
        // 추가 Song 정보
        lyricsLink: result.song?.lyricsLink ?? null,
        description: result.song?.description ?? null,
        difficulty: result.song?.difficulty ?? null,
        proficiency: result.song?.proficiency ?? null,
        songKey: result.song?.songKey ?? null,
        bpm: result.song?.bpm ?? null,
        categories: result.song?.categories,
        calculatedPrice: result.calculatedPrice ?? null,
        priceSource: result.priceSource ?? null,
        formattedPrice: result.formattedPrice ?? null,
        preferredPitchSemitones:
          result.song?.preferredPitchSemitones ?? null,
        preferredLyricsOffsetMs:
          result.song?.preferredLyricsOffsetMs ?? null,
      });
      setActiveTab('home');
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '곡 재생에 실패했습니다'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteRequest = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id);
      setQueue((prev) =>
        prev.filter((q) => q.id !== id).map((q, idx) => ({ ...q, position: idx + 1 }))
      );
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '삭제에 실패했습니다'));
    }
  };

  const handleClearQueue = async () => {
    if (!sessionId) return;
    try {
      const result = await clearQueueMutation.mutateAsync();
      setQueue([]);
      toast.success(result.message);
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '대기열 초기화에 실패했습니다'));
    }
  };

  const handleMoveUp = async (id: number) => {
    const idx = queue.findIndex((q) => q.id === id);
    if (idx <= 0) return;
    const newOrder = queue[idx - 1].position;
    try {
      await updateOrderMutation.mutateAsync({ requestId: id, newOrder });
      const newQueue = [...queue];
      [newQueue[idx - 1], newQueue[idx]] = [newQueue[idx], newQueue[idx - 1]];
      setQueue(newQueue.map((q, i) => ({ ...q, position: i + 1 })));
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '순서 변경에 실패했습니다'));
    }
  };

  const handleMoveDown = async (id: number) => {
    const idx = queue.findIndex((q) => q.id === id);
    if (idx < 0 || idx >= queue.length - 1) return;
    const newOrder = queue[idx + 1].position;
    try {
      await updateOrderMutation.mutateAsync({ requestId: id, newOrder });
      const newQueue = [...queue];
      [newQueue[idx], newQueue[idx + 1]] = [newQueue[idx + 1], newQueue[idx]];
      setQueue(newQueue.map((q, i) => ({ ...q, position: i + 1 })));
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '순서 변경에 실패했습니다'));
    }
  };

  const handleAddFromSongBook = async (song: Song) => {
    if (!sessionId) {
      toast.error('신청곡 모드가 활성화되어 있지 않습니다');
      return;
    }
    const position: 'FRONT' | 'BACK' | 'AFTER' =
      addInsertAfterId != null ? 'AFTER' : addPosition;
    try {
      const requestPayload = {
        liveSessionId: sessionId,
        songId: song.id,
        rawArtist: song.artist.name,
        rawTitle: song.title,
        requesterPlatformId: `manual_${user}`,
        requesterNickname: user,
        source: 'MANUAL',
        position,
        afterRequestId: position === 'AFTER' ? (addInsertAfterId ?? undefined) : undefined,
      };
      if (isOmakaseConsumeMode) {
        await consumeOmakaseMutation.mutateAsync({
          request: requestPayload,
          playNow: omakasePlayNow,
        });
      } else {
        await createRequestMutation.mutateAsync(requestPayload);
      }
      toast.success(`"${song.title}" 추가됨`);
      handleAddDialogOpenChange(false);
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '곡 추가에 실패했습니다'));
    }
  };

  const handleAddManualRequest = async () => {
    if (!sessionId) {
      toast.error('신청곡 모드가 활성화되어 있지 않습니다');
      return;
    }
    if (requireSongMatch) {
      toast.error('노래책 매칭 필수 설정이 켜져 있어 직접 입력을 사용할 수 없습니다.');
      return;
    }

    const artist = manualArtist.trim();
    const title = manualTitle.trim();
    const memo = manualMemo.trim();

    if (!artist || !title) {
      toast.error('아티스트와 제목을 모두 입력해주세요.');
      return;
    }

    const position: 'FRONT' | 'BACK' | 'AFTER' =
      addInsertAfterId != null ? 'AFTER' : addPosition;
    try {
      const requestPayload = {
        liveSessionId: sessionId,
        rawArtist: artist,
        rawTitle: title,
        rawMessage: memo || undefined,
        requesterPlatformId: `manual_${user}`,
        requesterNickname: user,
        source: 'MANUAL',
        position,
        afterRequestId: position === 'AFTER' ? (addInsertAfterId ?? undefined) : undefined,
      };
      if (isOmakaseConsumeMode) {
        await consumeOmakaseMutation.mutateAsync({
          request: requestPayload,
          playNow: omakasePlayNow,
        });
      } else {
        await createManualRequestMutation.mutateAsync({
          rawArtist: artist,
          rawTitle: title,
          rawMessage: memo || undefined,
          position,
          afterRequestId: position === 'AFTER' ? (addInsertAfterId ?? undefined) : undefined,
        });
      }
      toast.success(`"${title}" 추가됨`);
      handleAddDialogOpenChange(false);
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '직접 입력 곡 추가에 실패했습니다'));
    }
  };

  // 부활: 같은 세션의 COMPLETED/REJECTED row 정보를 서버에서 복사하여 새 row 생성.
  // 기본은 FRONT(다음 재생 위치).
  const handleReviveRequest = async (item: QueueItem) => {
    if (!sessionId) {
      toast.error('신청곡 모드가 활성화되어 있지 않습니다');
      return;
    }
    try {
      await createManualRequestMutation.mutateAsync({
        rawArtist: '',
        rawTitle: '',
        reviveFromRequestId: item.id,
        position: 'FRONT',
      });
      toast.success(`"${item.title}" 다시 추가됨`);
    } catch (error: unknown) {
      toast.error(extractApiErrorMessage(error, '부활에 실패했습니다'));
    }
  };

  const getVideoUrl = () => {
    if (!nowPlaying) return null;
    if (nowPlaying.mrVideoUrl) return nowPlaying.mrVideoUrl;
    if (karaokeVideoType === 'ORIGINAL') return nowPlaying.originalUrl;
    // ephemeral override 는 현재 재생 중인 곡에만 적용 (이번만 재생).
    if (
      ephemeralKaraoke &&
      ephemeralKaraoke.songRequestId === nowPlaying.id
    ) {
      return ephemeralKaraoke.url;
    }
    return nowPlaying.karaokeUrl;
  };

  // 곡이 바뀌면 "이번만 재생" 임시 override 초기화.
  const nowPlayingId = nowPlaying?.id;
  const isNowPlayingNull = nowPlaying === null;
  useEffect(() => {
    if (!ephemeralKaraoke) return;
    if (isNowPlayingNull || ephemeralKaraoke.songRequestId !== nowPlayingId) {
      setEphemeralKaraoke(null);
    }
  }, [nowPlayingId, isNowPlayingNull, ephemeralKaraoke]);

  const isYouTubeUrl = (url?: string | null) =>
    !!url && (url.includes('youtube.com') || url.includes('youtu.be'));

  const videoUrl = getVideoUrl();
  const isDirectPlayback = karaokePlaybackMode === 'DIRECT';
  const isUploadedMrVideo = Boolean(nowPlaying?.mrVideoUrl);
  const useHtml5Player = isUploadedMrVideo || isDirectPlayback || useFallbackPlayer;

  useEffect(() => {
    isResolvingFallbackRef.current = isResolvingFallback;
  }, [isResolvingFallback]);

  useEffect(() => {
    useFallbackPlayerRef.current = useFallbackPlayer;
  }, [useFallbackPlayer]);

  useEffect(() => {
    fallbackStateRef.current = fallbackState;
  }, [fallbackState]);

  useEffect(() => {
    if (typeof window === 'undefined' || didHydrateStoredVolumeRef.current) return;
    didHydrateStoredVolumeRef.current = true;

    const storedVolume = window.localStorage.getItem(CONSOLE_PLAYER_VOLUME_STORAGE_KEY);
    if (storedVolume == null) return;

    const parsedVolume = Number.parseInt(storedVolume, 10);
    const nextVolume = clampPlayerVolume(parsedVolume);
    if (nextVolume > 0) {
      lastNonZeroPlayerVolumeRef.current = nextVolume;
    }
    setPlayerVolume(nextVolume);
  }, []);

  const handlePlayerVolumeChange = useCallback((volume: number) => {
    const nextVolume = clampPlayerVolume(volume);
    if (nextVolume > 0) {
      lastNonZeroPlayerVolumeRef.current = nextVolume;
    }
    setPlayerVolume((prev) => (prev === nextVolume ? prev : nextVolume));

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        CONSOLE_PLAYER_VOLUME_STORAGE_KEY,
        String(nextVolume),
      );
    }
  }, []);

  // Gateway playback URL 획득 (직접 재생/YouTube fallback 공통).
  // 백엔드가 resolver 호출 + HMAC 서명 + gateway URL 조립까지 전부 처리.
  const resolveVideoFromResolver = useCallback(
    async (reason: string, mode: 'fallback' | 'direct') => {
      if (!videoUrl || !sessionId) return;
      // fallback: 이미 fallback 으로 전환됐거나 진행 중이면 중복 시도 X.
      if (mode === 'fallback' && (useFallbackPlayerRef.current || isResolvingFallbackRef.current)) return;
      // direct: 이전 resolve 가 in-flight 라도 새 videoUrl 에 대한 resolve 는
      // 반드시 출발시킨다. 빠르게 카드를 두 번 클릭하면 첫 클릭의 fetch 가
      // 끝나기 전에 videoUrl 이 두 번째 URL 로 갱신되는데, 여기서 early-return
      // 하면 두 번째 fetch 자체가 안 가서 첫 fetch 결과가 그대로 적용되고
      // 결국 사용자가 본 화면이 첫 클릭한 영상으로 고정된다. requestId
      // mechanism 이 stale 응답을 알아서 거르므로 다중 in-flight 는 안전.

      const requestId = ++resolverRequestIdRef.current;
      console.log(`[LiveConsole] Resolving ${mode} video URL: ${reason}`);
      isResolvingFallbackRef.current = true;
      setIsResolvingFallback(true);
      setFallbackError(null);

      try {
        const result = await fetchGatewayPlaybackUrl(sessionId, videoUrl, nowPlaying?.songId);
        if (resolverRequestIdRef.current !== requestId) return;

        setFallbackVideoUrl(result.playbackUrl);
        if (mode === 'fallback') {
          setUseFallbackPlayer(true);
          setFallbackNotice('YouTube 임베드가 재생되지 않아 직접 재생으로 전환됐습니다.');
        } else {
          setFallbackNotice(null);
        }
        console.log(`[LiveConsole] ${mode} URL resolved successfully`);
      } catch (error: unknown) {
        if (resolverRequestIdRef.current !== requestId) return;
        console.error('[LiveConsole] Gateway playback fetch failed:', error);
        setFallbackError(extractApiErrorMessage(error, '영상 URL을 가져오는데 실패했습니다'));
      } finally {
        if (resolverRequestIdRef.current === requestId) {
          isResolvingFallbackRef.current = false;
          setIsResolvingFallback(false);
        }
      }
    },
    [videoUrl, sessionId, nowPlaying?.songId]
  );

  // YouTube 에러 핸들러 (임베드 차단 등)
  const handleYouTubeError = async (errorCode: number) => {
    // 에러 코드 150: 임베드가 차단된 동영상
    // 에러 코드 101: 소유자가 임베드 비허용
    if (!isDirectPlayback && (errorCode === 150 || errorCode === 101)) {
      await resolveVideoFromResolver(`YouTube error code ${errorCode}`, 'fallback');
    }
  };

  // 재생 불가 감지 핸들러 (광고, 타임아웃 등)
  const handlePlaybackBlocked = async () => {
    if (!isDirectPlayback) {
      await resolveVideoFromResolver('Playback blocked (ad or timeout)', 'fallback');
    }
  };

  // videoUrl이 변경되면 fallback 상태 초기화
  useEffect(() => {
    setUseFallbackPlayer(false);
    setFallbackVideoUrl(null);
    setFallbackError(null);
    setFallbackNotice(null);
    setFallbackState('unstarted');
    directResolvedRef.current = null;
  }, [videoUrl, karaokePlaybackMode]);

  // Watchdog: gateway URL이 세팅됐는데 N초 내에 video가 재생 준비되지 않으면
  // 에러 UI를 빠르게 띄운다. <video> 자체의 stall/error 이벤트는 브라우저별로
  // 수십 초까지 느릴 수 있어서 사용자는 "아무 것도 안 뜸"으로 느낀다.
  useEffect(() => {
    if (!useHtml5Player || !fallbackVideoUrl || fallbackError) return;
    const video = fallbackVideoRef.current;
    if (!video) return;
    const timer = setTimeout(() => {
      // readyState 2(HAVE_CURRENT_DATA) 미만이면 아직 playable 아님
      if (fallbackVideoRef.current && fallbackVideoRef.current.readyState < 2) {
        setFallbackError('영상 로딩이 지연됩니다');
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [fallbackVideoUrl, useHtml5Player, fallbackError]);

  // 직접 재생 모드 또는 업로드 MR 영상인 경우 resolver로 URL 선행 확보
  useEffect(() => {
    if ((!isDirectPlayback && !isUploadedMrVideo) || !videoUrl) return;
    if (!isYouTubeUrl(videoUrl)) {
      directResolvedRef.current = videoUrl;
      setFallbackVideoUrl(videoUrl);
      return;
    }
    if (directResolvedRef.current === videoUrl) return;
    directResolvedRef.current = videoUrl;
    resolveVideoFromResolver('Direct playback mode', 'direct');
  }, [isDirectPlayback, isUploadedMrVideo, videoUrl, resolveVideoFromResolver]);

  // Fallback 비디오 state/duration 추적 — lyrics-panel 이 anchor publish 시 사용.
  // (legacy publishPlaybackProgress 는 anchor 모델 통합으로 폐기됨)
  useEffect(() => {
    if (useHtml5Player && fallbackVideoRef.current) {
      const video = fallbackVideoRef.current;

      const syncMetadata = () => {
        const duration = video.duration || 0;
        setFallbackVideoDurationMs(duration > 0 ? duration * 1000 : 0);
      };

      const handlePlay = () => {
        fallbackStateRef.current = 'playing';
        setFallbackState('playing');
      };
      const handlePause = () => {
        const nextState = video.ended ? 'ended' : 'paused';
        fallbackStateRef.current = nextState;
        setFallbackState(nextState);
      };
      const handleEnded = () => {
        fallbackStateRef.current = 'ended';
        setFallbackState('ended');
      };
      const handleWaiting = () => {
        fallbackStateRef.current = 'buffering';
        setFallbackState('buffering');
      };
      const handleEmptied = () => {
        fallbackStateRef.current = 'unstarted';
        setFallbackState('unstarted');
        setFallbackVideoDurationMs(0);
      };

      video.addEventListener('loadedmetadata', syncMetadata);
      video.addEventListener('durationchange', syncMetadata);
      video.addEventListener('play', handlePlay);
      video.addEventListener('pause', handlePause);
      video.addEventListener('ended', handleEnded);
      video.addEventListener('waiting', handleWaiting);
      video.addEventListener('emptied', handleEmptied);

      return () => {
        video.removeEventListener('loadedmetadata', syncMetadata);
        video.removeEventListener('durationchange', syncMetadata);
        video.removeEventListener('play', handlePlay);
        video.removeEventListener('pause', handlePause);
        video.removeEventListener('ended', handleEnded);
        video.removeEventListener('waiting', handleWaiting);
        video.removeEventListener('emptied', handleEmptied);
      };
    }
  }, [useHtml5Player, fallbackVideoUrl]);

  // Fallback 재시도
  const handleRetryFallback = async () => {
    if (!videoUrl) return;
    await resolveVideoFromResolver(
      'Manual retry',
      isDirectPlayback ? 'direct' : 'fallback'
    );
  };

  const handleRetryYoutubeEmbed = () => {
    if (isDirectPlayback) return;
    resolverRequestIdRef.current += 1;
    isResolvingFallbackRef.current = false;
    useFallbackPlayerRef.current = false;
    setIsResolvingFallback(false);
    setUseFallbackPlayer(false);
    setFallbackVideoUrl(null);
    setFallbackError(null);
    setFallbackNotice(null);
    setFallbackState('unstarted');
  };

  // anchor 모델: YT player state / duration 변경을 추적해 lyrics-panel 로 prop
  // 전달. lyrics-panel 이 intent change(state 변경/seek/song change) 시에만
  // publishLyricsPlaybackState 를 호출. 따라서 progressInterval 은 콘솔 자체의
  // currentProgress UI(footer 표시 등) 만 채우는 용도라 빠르게 잡아도 무방.
  const [youtubePlaybackState, setYoutubePlaybackState] =
    useState<PlaybackProgress['state']>('unstarted');
  const [youtubeDurationMs, setYoutubeDurationMs] = useState(0);

  const handleYoutubeStateChange = useCallback(
    (state: PlaybackProgress['state']) => {
      setYoutubePlaybackState(state);
      // recording-worker 의 클립 추출 boundary 정확도 향상용 — playedAt/completedAt
      // 보다 정확한 영상 재생 시작/종료 시점을 PostHog 에 캡쳐 (스트리머 콘솔 source).
      if (sessionId && nowPlaying?.id) {
        posthog.capture('playback_state_changed', {
          session_id: sessionId,
          request_id: nowPlaying.id,
          song_id: nowPlaying.songId ?? null,
          state,
          source: 'youtube',
          video_url: videoUrl ?? null,
        });
      }
    },
    [sessionId, nowPlaying?.id, nowPlaying?.songId, videoUrl],
  );
  const handleYoutubeProgressForDuration = useCallback(
    (progress: PlaybackProgress) => {
      // duration 만 추적. currentTime 은 lyrics-panel 이 직접 getCurrentTime() 호출.
      const durationMs = Number.isFinite(progress.duration)
        ? Math.max(0, progress.duration) * 1000
        : 0;
      setYoutubeDurationMs((prev) => (prev === durationMs ? prev : durationMs));
    },
    [],
  );

  const {
    isReady: isPlayerReady,
    isPlaybackCheckPending: isYoutubePlaybackChecking,
    setVolume: setYouTubeVolume,
    getVolume: getYouTubeVolume,
    mute: muteYouTube,
    unmute: unmuteYouTube,
    isMuted: isYouTubeMuted,
    getCurrentTime: getYouTubeCurrentTime,
  } = useYouTubePlayer(
    'youtube-player-container',
    useHtml5Player ? null : videoUrl, // HTML5 직접 재생 모드에서는 YouTube 플레이어 비활성화
    {
      autoplay: false,
      onProgress: handleYoutubeProgressForDuration,
      onStateChange: handleYoutubeStateChange,
      onError: handleYouTubeError,
      onPlaybackBlocked: handlePlaybackBlocked,
      progressInterval: 500,
      playbackTimeout: 8000, // 8초 내에 콘텐츠 재생 안 되면 fallback
    }
  );

  useEffect(() => {
    if (isDirectPlayback || !isPlayerReady) return;
    if (playerVolume <= 0) {
      setYouTubeVolume(0);
      muteYouTube();
      return;
    }
    unmuteYouTube();
    setYouTubeVolume(playerVolume);
  }, [
    isDirectPlayback,
    isPlayerReady,
    muteYouTube,
    playerVolume,
    setYouTubeVolume,
    unmuteYouTube,
  ]);

  useEffect(() => {
    if (isDirectPlayback || !isPlayerReady) return;
    const intervalId = window.setInterval(() => {
      const nextVolume = isYouTubeMuted() ? 0 : getYouTubeVolume();
      if (clampPlayerVolume(nextVolume) !== playerVolume) {
        handlePlayerVolumeChange(nextVolume);
      }
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [
    getYouTubeVolume,
    handlePlayerVolumeChange,
    isDirectPlayback,
    isPlayerReady,
    isYouTubeMuted,
    playerVolume,
  ]);

  useEffect(() => {
    if (!useHtml5Player || !fallbackVideoRef.current) return;
    fallbackVideoRef.current.volume = playerVolume / 100;
    fallbackVideoRef.current.muted = playerVolume <= 0;
  }, [useHtml5Player, fallbackVideoUrl, playerVolume]);

  // 곡/세션이 바뀌면 video state 추적 reset
  useEffect(() => {
    setYoutubePlaybackState('unstarted');
    setYoutubeDurationMs(0);
  }, [sessionId, nowPlaying?.id, videoUrl]);

  const effectiveIsReady = useHtml5Player ? !!fallbackVideoUrl : isPlayerReady;

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedArtistId(null);
    setSelectedCategoryId(null);
  };

  const handleAddDialogOpenChange = (open: boolean) => {
    setIsAddDialogOpen(open);

    if (open) {
      return;
    }

    handleResetFilters();
    setAddMode('songbook');
    setManualArtist('');
    setManualTitle('');
    setManualMemo('');
    setAddPosition('BACK');
    setAddInsertAfterId(null);
    setIsOmakaseConsumeMode(false);
    setOmakasePlayNow(false);
  };

  const handleOpenAddDialog = () => {
    setAddMode('songbook');
    setAddPosition('BACK');
    setAddInsertAfterId(null);
    setIsOmakaseConsumeMode(false);
    setOmakasePlayNow(false);
    setIsAddDialogOpen(true);
  };

  const handleOpenOmakaseConsumeDialog = () => {
    if (!sessionId) {
      toast.error('신청곡 모드가 활성화되어 있지 않습니다');
      return;
    }
    if (!omakaseStatus?.enabled) {
      toast.error('오마카세가 꺼져 있습니다');
      return;
    }
    if ((omakaseStatus.count ?? 0) <= 0) {
      toast.error('사용 가능한 오마카세가 없습니다');
      return;
    }
    setIsOmakaseConsumeMode(true);
    setOmakasePlayNow(false);
    setAddMode('songbook');
    setAddPosition('BACK');
    setAddInsertAfterId(null);
    setIsAddDialogOpen(true);
  };

  const handleSaveConsoleOmakaseSettings = async () => {
    if (!omakaseSettingsChannelId) {
      toast.error('채널 정보를 불러오지 못했습니다');
      return;
    }

    try {
      await updateOmakaseSettingsMutation.mutateAsync({
        enabled: omakaseEnabledDraft,
        displayName: omakaseDisplayNameDraft.trim() || null,
        price: Math.max(
          0,
          Number.parseInt(omakasePriceDraft || '0', 10) || 0,
        ),
      });
      toast.success('오마카세 설정이 저장되었습니다');
    } catch (error: unknown) {
      toast.error(
        extractApiErrorMessage(error, '오마카세 설정 저장에 실패했습니다'),
      );
    }
  };

  // 큐 항목 사이 + 버튼: 해당 항목 다음에 끼워넣기 위해 모달을 'AFTER' 모드로 연다.
  const handleOpenAddDialogAfter = (afterRequestId: number) => {
    setAddMode('songbook');
    setIsOmakaseConsumeMode(false);
    setOmakasePlayNow(false);
    setAddInsertAfterId(afterRequestId);
    setAddPosition('BACK'); // AFTER 모드일 때는 라디오 무시되지만 안전하게 초기화
    setIsAddDialogOpen(true);
  };

  const addRequestDialogContent = (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>
          {isOmakaseConsumeMode
            ? `${omakaseStatus?.displayName ?? '오마카세'} 이용`
            : '신청곡 추가'}
        </DialogTitle>
        <DialogDescription>
          {isOmakaseConsumeMode
            ? '곡을 선택하면 오마카세 개수가 1개 차감됩니다'
            : '노래책에서 곡을 선택하거나 직접 입력으로 대기열에 추가합니다'}
        </DialogDescription>
      </DialogHeader>

      {isOmakaseConsumeMode && (
        <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={omakasePlayNow}
            onChange={(event) => setOmakasePlayNow(event.target.checked)}
          />
          바로 재생하기
        </label>
      )}

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground shrink-0">추가 위치</span>
        {addInsertAfterId != null ? (
          <Badge variant="secondary" className="h-6 text-[11px] gap-1">
            <Plus className="size-3" />
            선택한 항목 다음에 끼워넣기
          </Badge>
        ) : (
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => setAddPosition('BACK')}
              className={cn(
                'h-6 px-2.5 rounded text-xs transition-colors',
                addPosition === 'BACK'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              맨 뒤
            </button>
            <button
              type="button"
              onClick={() => setAddPosition('FRONT')}
              className={cn(
                'h-6 px-2.5 rounded text-xs transition-colors',
                addPosition === 'FRONT'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              맨 앞 (다음 재생)
            </button>
          </div>
        )}
      </div>

      <Tabs
        value={addMode}
        onValueChange={(value) => setAddMode(value as 'songbook' | 'manual')}
        className="space-y-3 min-w-0 overflow-hidden"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="songbook">노래책에서 추가</TabsTrigger>
          <TabsTrigger value="manual" disabled={requireSongMatch}>
            직접 입력
          </TabsTrigger>
        </TabsList>

        {requireSongMatch && (
          <p className="text-xs text-muted-foreground">
            노래책 매칭 필수 설정이 켜져 있어 직접 입력 모드는 사용할 수 없습니다.
          </p>
        )}

        <TabsContent value="songbook" className="space-y-3 min-w-0 overflow-hidden">
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder="검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
              {(searchQuery || selectedArtistId || selectedCategoryId) && (
                <Button variant="ghost" size="icon" onClick={handleResetFilters}>
                  <X className="size-4" />
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Popover open={artistDropdownOpen} onOpenChange={setArtistDropdownOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-32 justify-between text-xs">
                    <span className="truncate">
                      {selectedArtistId
                        ? artists.find((a) => a.id === selectedArtistId)?.name
                        : '아티스트'}
                    </span>
                    <ChevronDown className="size-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[180px] p-0">
                  <Command>
                    <CommandInput placeholder="검색..." />
                    <CommandList>
                      <CommandEmpty>결과 없음</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          onSelect={() => {
                            setSelectedArtistId(null);
                            setArtistDropdownOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 size-3',
                              !selectedArtistId ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          전체
                        </CommandItem>
                        {artists.map((artist) => (
                          <CommandItem
                            key={artist.id}
                            onSelect={() => {
                              setSelectedArtistId(artist.id);
                              setArtistDropdownOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 size-3',
                                selectedArtistId === artist.id
                                  ? 'opacity-100'
                                  : 'opacity-0',
                              )}
                            />
                            {artist.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Popover open={categoryDropdownOpen} onOpenChange={setCategoryDropdownOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-32 justify-between text-xs">
                    <span className="truncate">
                      {selectedCategoryId
                        ? categories.find((c) => c.id === selectedCategoryId)?.name
                        : '카테고리'}
                    </span>
                    <ChevronDown className="size-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[180px] p-0">
                  <Command>
                    <CommandInput placeholder="검색..." />
                    <CommandList>
                      <CommandEmpty>결과 없음</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          onSelect={() => {
                            setSelectedCategoryId(null);
                            setCategoryDropdownOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 size-3',
                              !selectedCategoryId ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          전체
                        </CommandItem>
                        {categories.map((category) => (
                          <CommandItem
                            key={category.id}
                            onSelect={() => {
                              setSelectedCategoryId(category.id);
                              setCategoryDropdownOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 size-3',
                                selectedCategoryId === category.id
                                  ? 'opacity-100'
                                  : 'opacity-0',
                              )}
                            />
                            {category.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div
            className="h-[300px] border rounded-lg overflow-y-auto"
            onScroll={(e) => {
              const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
              if (
                scrollHeight - scrollTop - clientHeight < 100 &&
                hasNextPage &&
                !isFetchingNextPage
              ) {
                fetchNextPage();
              }
            }}
          >
            <div className="p-1.5 space-y-0.5">
              {songBookLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSongBook.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {!debouncedSearch && !selectedArtistId && !selectedCategoryId
                    ? '노래책이 비어있습니다'
                    : '검색 결과가 없습니다'}
                </div>
              ) : (
                <>
                  {filteredSongBook.map((song) => (
                    <button
                      key={song.id}
                      onClick={() => handleAddFromSongBook(song)}
                      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-accent transition-colors text-left group"
                    >
                      {song.albumArt ? (
                        <img
                          src={song.albumArt}
                          alt={song.title}
                          className="size-8 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="size-8 shrink-0 rounded bg-muted flex items-center justify-center">
                          <Music className="size-3 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <p className="text-sm truncate">{song.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {song.artist.name}
                        </p>
                      </div>
                      <Plus className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                  {isFetchingNextPage && (
                    <div className="flex items-center justify-center py-3">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="manual" className="space-y-3 min-w-0 overflow-hidden">
          <div className="space-y-2">
            <Label htmlFor="manual-artist">아티스트</Label>
            <Input
              id="manual-artist"
              placeholder="예: 아이유"
              value={manualArtist}
              onChange={(e) => setManualArtist(e.target.value)}
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-title">제목</Label>
            <Input
              id="manual-title"
              placeholder="예: 좋은날"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-memo">메모 (선택)</Label>
            <Textarea
              id="manual-memo"
              placeholder="신청 사유나 메모를 입력하세요"
              value={manualMemo}
              onChange={(e) => setManualMemo(e.target.value)}
              maxLength={255}
              rows={3}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => handleAddDialogOpenChange(false)}
            >
              취소
            </Button>
            <Button
              onClick={handleAddManualRequest}
              disabled={
                createManualRequestMutation.isPending ||
                requireSongMatch ||
                !sessionId
              }
            >
              {createManualRequestMutation.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Plus className="size-4 mr-2" />
              )}
              추가
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  );

  useEffect(() => {
    if (requireSongMatch && addMode === 'manual') {
      setAddMode('songbook');
    }
  }, [requireSongMatch, addMode]);

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {widgetSettingsType && (
        <WidgetSettingsDialog
          open={widgetSettingsType !== null}
          onOpenChange={(next) => {
            if (!next) setWidgetSettingsType(null);
          }}
          channelIdentifier={user}
          widgetType={widgetSettingsType}
        />
      )}
      <OverlayCopyGuideDialog
        open={obsGuide !== null}
        onOpenChange={(next) => {
          if (!next) setObsGuide(null);
        }}
        url={obsGuide?.url ?? ''}
        widgetName={obsGuide?.widgetName}
        width={obsGuide?.width}
        height={obsGuide?.height}
      />

      <EndSessionConfirmDialog
        open={endConfirmIntent !== null}
        onOpenChange={(next) => {
          if (!next && !endSessionMutation.isPending) setEndConfirmIntent(null);
        }}
        onConfirm={() => void handleConfirmEndSession()}
        isPending={endSessionMutation.isPending}
      />

      <Dialog open={isAddDialogOpen} onOpenChange={handleAddDialogOpenChange}>
        {addRequestDialogContent}
      </Dialog>

      {/* 고정 헤더 - Ant Design 스타일 탭 */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b">
        <div className="flex items-center justify-between px-4 gap-2">
          {/* Ant Design 스타일 탭 */}
          <div className="flex items-center gap-0.5 relative min-w-0 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setActiveTab('home')}
              className={cn(
                "relative px-3 py-3 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
                activeTab === 'home' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-1.5">
                <Home className="size-3.5" />
                홈
              </span>
              {activeTab === 'home' && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
            </button>
            <button
              onClick={() => setActiveTab('queue')}
              className={cn(
                "relative px-3 py-3 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
                activeTab === 'queue' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-1.5">
                <ListMusic className="size-3.5" />
                신청곡
                {queue.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                    {queue.length}
                  </Badge>
                )}
              </span>
              {activeTab === 'queue' && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
            </button>
            {omakaseEnabledForConsole && (
              <button
                onClick={() => setActiveTab('omakase')}
                className={cn(
                  "relative px-3 py-3 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
                  activeTab === 'omakase' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="flex items-center gap-1.5">
                  <Star className="size-3.5" />
                  {omakaseDisplayName}
                  <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                    {omakaseStatus?.enabled ? omakaseCount : '설정'}
                  </Badge>
                </span>
                {activeTab === 'omakase' && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
              </button>
            )}
            <button
              onClick={() => setActiveTab('overlay')}
              className={cn(
                "relative px-3 py-3 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
                activeTab === 'overlay' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-1.5">
                <Video className="size-3.5" />
                오버레이
              </span>
              {activeTab === 'overlay' && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={cn(
                "relative px-3 py-3 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
                activeTab === 'settings' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-1.5">
                <Settings className="size-3.5" />
                설정
              </span>
              {activeTab === 'settings' && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
            </button>
            <button
              onClick={() => setActiveTab('session-history')}
              className={cn(
                "relative px-3 py-3 text-sm font-medium transition-colors whitespace-nowrap shrink-0",
                activeTab === 'session-history' ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-1.5">
                <History className="size-3.5" />
                세션 기록
              </span>
              {activeTab === 'session-history' && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
            </button>
          </div>

          {/* 우측 컨트롤 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 신청곡 모드 시작/종료 + 일시정지/재개 */}
            {isLive ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handlePausedChange(!isPaused)}
                  disabled={updateSettingsMutation.isPending}
                  className={cn(
                    'h-7 text-xs',
                    isPaused &&
                      'border-amber-500/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10',
                  )}
                >
                  {updateSettingsMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin mr-1" />
                  ) : isPaused ? (
                    <Play className="size-3 mr-1" />
                  ) : (
                    <Pause className="size-3 mr-1" />
                  )}
                  {isPaused ? '재개' : '일시정지'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRequestEndLive}
                  disabled={endSessionMutation.isPending}
                  className="h-7 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
                >
                  {endSessionMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin mr-1" />
                  ) : (
                    <Square className="size-3 mr-1" />
                  )}
                  종료
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={() => void handleStartLive(false)}
                  disabled={
                    startSessionMutation.isPending ||
                    cloneSessionMutation.isPending ||
                    sessionLoading
                  }
                  className="h-7 text-xs"
                >
                  {startSessionMutation.isPending ? (
                    <Loader2 className="size-3 animate-spin mr-1" />
                  ) : (
                    <Radio className="size-3 mr-1" />
                  )}
                  신청곡 모드 시작
                </Button>
                <AlertDialog
                  open={isPracticeModeDialogOpen}
                  onOpenChange={setIsPracticeModeDialogOpen}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        startSessionMutation.isPending ||
                        cloneSessionMutation.isPending ||
                        sessionLoading
                      }
                      className="h-7 text-xs"
                      title="일반 시청자에게는 신청곡 모드가 켜진 것으로 보이지 않고, 종료 후 셋리스트/녹화 기록에 남지 않습니다"
                    >
                      {startSessionMutation.isPending ? (
                        <Loader2 className="size-3 animate-spin mr-1" />
                      ) : (
                        <FileMusic className="size-3 mr-1" />
                      )}
                      연습모드
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>연습모드 안내</AlertDialogTitle>
                      <AlertDialogDescription>
                        연습모드를 켜면 셋리스트와 녹화 기록에 남기지 않고
                        신청곡 모드를 테스트해볼 수 있어요. 시청자에게는
                        신청곡 모드가 꺼진 상태로 보이고, 스트리머로 로그인된
                        상태에서만 신청 기능이 활성화됩니다. 연습모드에서
                        재생한 곡은 방송 셋리스트와 녹화 기록에 남지 않습니다.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>취소</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleConfirmStartPracticeMode}
                        disabled={startSessionMutation.isPending}
                      >
                        시작하기
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {latestEndedSession && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRestartLastSession}
                    disabled={
                      cloneSessionMutation.isPending ||
                      startSessionMutation.isPending ||
                      sessionLoading
                    }
                    className="h-7 text-xs"
                    title="최근 30분 이내 종료된 세션의 설정과 신청곡을 그대로 복원합니다"
                  >
                    {cloneSessionMutation.isPending ? (
                      <Loader2 className="size-3 animate-spin mr-1" />
                    ) : (
                      <RotateCcw className="size-3 mr-1" />
                    )}
                    이전 세션 다시 시작
                  </Button>
                )}
              </>
            )}
            {isLive && isPracticeMode && (
              <Badge
                variant="outline"
                className="h-6 border-sky-500/40 bg-sky-500/10 px-2 text-[11px] text-sky-700 dark:text-sky-200"
              >
                연습모드
              </Badge>
            )}

            {/* 설정 버튼 (모바일 전용 — 데스크톱은 우측 고정 패널 사용) */}
            <div className="lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <Settings className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent className="px-0 sm:max-w-lg overflow-y-auto flex flex-col">
                <SheetHeader className="mb-2 px-4">
                  <SheetTitle>콘솔 설정</SheetTitle>
                  <SheetDescription>
                    오버레이 링크 · 신청곡/오버레이 설정
                  </SheetDescription>
                </SheetHeader>

                {/* 통합 오버레이 링크 */}
                <section className="border-b px-4 py-3 space-y-1.5">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">통합 오버레이 링크</h3>
                  <div className="flex items-center gap-1.5">
                    <Input
                      readOnly
                      value={
                        overlayToken
                          ? `${normalizedOverlayBaseUrl}/overlay/${overlayToken}/widgets/total`
                          : ''
                      }
                      placeholder={overlayToken ? '' : channelTokenLoading ? '토큰 확인 중…' : '신청곡 모드를 한 번 시작해 주세요'}
                      className="text-xs h-8"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs shrink-0"
                      disabled={!overlayToken}
                      onClick={() => {
                        const url = overlayToken
                          ? `${normalizedOverlayBaseUrl}/overlay/${overlayToken}/widgets/total`
                          : '';
                        if (!url) return;
                        navigator.clipboard.writeText(url);
                        setObsGuide({ url, widgetName: '통합 오버레이', width: 1920, height: 1080 });
                      }}
                    >
                      <ExternalLink className="size-3 mr-1" />
                      복사
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    다른 위젯은 상단 오버레이 탭에서 복사
                  </p>
                </section>

                {/* 탭: 신청곡 설정 | 오버레이 설정 */}
                <div className="flex items-center gap-1 border-b px-4 py-1.5">
                  <button
                    type="button"
                    onClick={() => setSideTab('song')}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                      sideTab === 'song'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    신청곡 설정
                  </button>
                  <button
                    type="button"
                    onClick={() => setSideTab('overlay')}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                      sideTab === 'overlay'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    오버레이 설정
                  </button>
                </div>

                {/* 탭 콘텐츠 */}
                <div className="flex-1 px-4 py-3">
                  {sideTab === 'song' && (
                    <SessionSettingsFields
                      settings={sheetSettings}
                      onChange={(partial) =>
                        setSheetSettingsDraft((prev) => ({ ...prev, ...partial }))
                      }
                      karaokePlaybackMode={karaokePlaybackMode}
                      onKaraokePlaybackModeChange={handleKaraokePlaybackModeChange}
                      karaokeVideoType={karaokeVideoType}
                      onKaraokeVideoTypeChange={handleKaraokeVideoTypeChange}
                      playbackSettingsDisabled={!isLive}
                      hasActiveSession={!!sessionId}
                      categories={sheetCategories?.map((c) => ({
                        id: c.id,
                        name: c.name,
                        color: c.color ?? null,
                      }))}
                      isPaused={isPaused}
                      onPausedChange={handlePausedChange}
                      showPauseToggle
                      pausedDisabled={settingsDisabled}
                      disabled={settingsDisabled}
                    />
                  )}
                  {sideTab === 'overlay' && (
                    <TotalOverlayLayoutSettings
                      user={user}
                      overlayToken={overlayToken ?? null}
                      isTokenLoading={false}
                      embedded
                    />
                  )}
                </div>

                {/* 저장/되돌리기 (신청곡 설정일 때만) */}
                {sideTab === 'song' && (
                  <div className="sticky bottom-0 bg-background border-t px-4 py-3 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setSheetSettingsDraft({})}
                      disabled={!hasSheetDraft || updateSettingsMutation.isPending || endSessionMutation.isPending}
                    >
                      되돌리기
                    </Button>
                    <Button
                      onClick={() => void handleSaveSheetSettings()}
                      disabled={
                        !hasSheetDraft ||
                        !sessionId ||
                        updateSettingsMutation.isPending ||
                        endSessionMutation.isPending
                      }
                    >
                      {(updateSettingsMutation.isPending || endSessionMutation.isPending) && (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      )}
                      저장
                    </Button>
                  </div>
                )}
              </SheetContent>
            </Sheet>
            </div>
          </div>
        </div>
      </header>

      {/* 탭 콘텐츠 — 홈 영상 패널은 숨김 상태로 유지해 탭 전환/리사이즈 중 재생을 보존한다. */}
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="song-request-console-layout"
        className="flex-1 overflow-hidden"
      >
        <ResizablePanel
          defaultSize={isDesktopLayout ? 50 : 100}
          minSize={isDesktopLayout ? 35 : 100}
          order={1}
        >
        <main className="h-full overflow-hidden">
        <AnimatePresence>
          {(
            <motion.div
              key="home"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "h-full overflow-hidden flex flex-col",
                activeTab !== 'home' && "hidden",
              )}
            >
              {(() => {
                const lyricsSongId = nowPlaying?.songId ?? null;
                // lyricsText 는 보안 정책상 overlay socket payload 에서 strip 되므로
                // (meloming-back/song-request/prisma/song-request.selections.ts 참조)
                // 매니저 인증된 single-song endpoint(useSongByChannelIdentifierSongId,
                // exposeLyricsToManager=true)에서 가져온 값을 source 로 쓴다.
                const managerLyricsText =
                  nowPlayingSongQuery.data?.lyricsText ?? null;
                // Musixmatch 매칭 여부와 무관하게, 사용자 가사가 있으면 패널을 띄운다 —
                // '내 가사' 탭으로 노출.
                const lyricsAvailable =
                  (isLyricsConsoleEnabled && typeof lyricsSongId === 'number') ||
                  (typeof managerLyricsText === 'string' &&
                    managerLyricsText.length > 0);
                const upper = (
                  <div className="h-full overflow-y-auto p-4 space-y-4">
                {omakaseStatus?.enabled && (
                  <div className="rounded-lg border bg-card p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {omakaseStatus.displayName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          잔여 {omakaseStatus.count}개
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-sm tabular-nums">
                        X {omakaseStatus.count}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!sessionId || adjustOmakaseMutation.isPending}
                        onClick={() =>
                          sessionId &&
                          adjustOmakaseMutation.mutate({
                            liveSessionId: sessionId,
                            delta: -1,
                            reason: '홈 수동 감소',
                          })
                        }
                      >
                        -
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!sessionId || adjustOmakaseMutation.isPending}
                        onClick={() =>
                          sessionId &&
                          adjustOmakaseMutation.mutate({
                            liveSessionId: sessionId,
                            delta: 1,
                            reason: '홈 수동 증가',
                          })
                        }
                      >
                        +
                      </Button>
                      <Button
                        size="sm"
                        disabled={!sessionId || omakaseStatus.count <= 0}
                        onClick={handleOpenOmakaseConsumeDialog}
                      >
                        이용
                      </Button>
                    </div>
                  </div>
                )}
                {/* 현재 재생 중 */}
                <NowPlayingCard
                  nowPlaying={nowPlaying}
                  nextSong={nextSong}
                  queue={queue}
                  isPlayerReady={effectiveIsReady}
                  onPlayNext={handlePlayNext}
                  isLoading={isLoading}
                  canPlayNext={canPlayNext}
                  canRestartLastSession={!isLive && !!latestEndedSession}
                  onRestartLastSession={handleRestartLastSession}
                  isRestartingLastSession={cloneSessionMutation.isPending}
                  videoUrl={videoUrl}
                  useHtml5Player={useHtml5Player}
                  fallbackVideoUrl={fallbackVideoUrl}
                  fallbackVideoRef={fallbackVideoRef}
                  fallbackError={fallbackError}
                  isResolvingFallback={isResolvingFallback}
                  onRetryFallback={handleRetryFallback}
                  onFallbackError={setFallbackError}
                  fallbackNotice={fallbackNotice}
                  isYoutubePlaybackChecking={isYoutubePlaybackChecking}
                  onRetryYoutubeEmbed={handleRetryYoutubeEmbed}
                  playbackMode={karaokePlaybackMode}
                  onPlaybackModeChange={handleKaraokePlaybackModeChange}
                  playbackModeDisabled={settingsDisabled}
                  playerVolume={playerVolume}
                  restorePlayerVolume={lastNonZeroPlayerVolumeRef.current}
                  onPlayerVolumeChange={handlePlayerVolumeChange}
                  channelIdentifier={user}
                  sessionId={sessionId}
                  currentSongDetail={nowPlayingSongQuery.data ?? null}
                  karaokeSuggestionsSlot={
                    nowPlaying && nowPlaying.songId ? (
                      <ConsoleKaraokeSuggestions
                        // 곡이 바뀌면 토글 기본 상태 재적용을 위해 재마운트
                        key={`karaoke-suggest-${nowPlaying.id}`}
                        channelIdentifier={user}
                        songId={nowPlaying.songId}
                        songRequestId={nowPlaying.id}
                        title={nowPlaying.title}
                        artist={nowPlaying.artist}
                        sessionId={sessionId}
                        isOriginalMode={karaokeVideoType === 'ORIGINAL'}
                        currentKaraokeUrl={nowPlaying.karaokeUrl ?? null}
                        ephemeralUrl={
                          ephemeralKaraoke &&
                          ephemeralKaraoke.songRequestId === nowPlaying.id
                            ? ephemeralKaraoke.url
                            : null
                        }
                        onEphemeralPlay={(url) =>
                          setEphemeralKaraoke({
                            songRequestId: nowPlaying.id,
                            url,
                          })
                        }
                        onSaved={() => setEphemeralKaraoke(null)}
                        alwaysOpen
                      />
                    ) : null
                  }
                />
                  </div>
                );

                const sheetAvailable =
                  isSheetMusicEnabled &&
                  nowPlayingHasSheetMusic &&
                  typeof lyricsSongId === 'number';

                if (!lyricsAvailable && !sheetAvailable) return upper;

                // 가사/악보 분리 패널: 좌측 메인을 vertical split.
                // 가능한 조합: lyrics-only (현재) / sheet-only / both
                // 라이브 중 악보·가사를 항상 시야 안에 두고 비율 자유 조정.
                // autoSaveId 가 조합별로 달라서 각 layout 의 사용자 비율이 따로 기억됨.
                const upperDefaultSize =
                  sheetAvailable && lyricsAvailable ? 44 : sheetAvailable ? 60 : 72;
                const sheetDefaultSize =
                  sheetAvailable && lyricsAvailable ? 28 : 40;
                const lyricsDefaultSize =
                  sheetAvailable && lyricsAvailable ? 28 : 28;
                const verticalAutoSaveId =
                  sheetAvailable && lyricsAvailable
                    ? 'song-request-console-home-vertical-both'
                    : sheetAvailable
                      ? 'song-request-console-home-vertical-sheet'
                      : 'song-request-console-home-vertical';

                return (
                  <ResizablePanelGroup
                    direction="vertical"
                    autoSaveId={verticalAutoSaveId}
                    className="flex-1 overflow-hidden"
                  >
                    <ResizablePanel
                      defaultSize={upperDefaultSize}
                      minSize={30}
                      order={1}
                    >
                      {upper}
                    </ResizablePanel>
                    {sheetAvailable && (
                      <>
                        <ResizableHandle withHandle />
                        <ResizablePanel
                          defaultSize={sheetDefaultSize}
                          minSize={15}
                          order={2}
                        >
                          <SheetMusicResizableSection
                            user={user}
                            songId={lyricsSongId as number}
                          />
                        </ResizablePanel>
                      </>
                    )}
                    {lyricsAvailable && (
                      <>
                        <ResizableHandle withHandle />
                        <ResizablePanel
                          defaultSize={lyricsDefaultSize}
                          minSize={15}
                          // sheet 패널 동반 시 3, lyrics-only 시 기존 2 유지 — 기존 사용자의
                          // autoSaveId 'song-request-console-home-vertical' 비율 보존.
                          order={sheetAvailable ? 3 : 2}
                        >
                          <LyricsResizableSection
                            // 곡 변경 시 RAF 루프/active line/viewSource 상태 리셋.
                            // manual 신청곡(songId 없음)도 request id 단위로 재마운트.
                            key={`lyrics-${lyricsSongId ?? 'manual'}-${nowPlaying?.id ?? 'none'}`}
                            identifier={user}
                            songId={lyricsSongId}
                            initialPreferredLyricsOffsetMs={
                              nowPlaying?.preferredLyricsOffsetMs ?? null
                            }
                            fallbackText={managerLyricsText}
                            getCurrentTime={getYouTubeCurrentTime}
                            fallbackVideoRef={fallbackVideoRef}
                            useHtml5Player={useHtml5Player}
                            sessionId={sessionId}
                            overlayToken={overlayToken ?? null}
                            songRequestId={nowPlaying?.id ?? null}
                            videoPlaybackState={
                              useHtml5Player ? fallbackState : youtubePlaybackState
                            }
                            videoDurationMs={
                              useHtml5Player ? fallbackVideoDurationMs : youtubeDurationMs
                            }
                          />
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                );
              })()}
            </motion.div>
          )}
          {activeTab === 'omakase' && omakaseEnabledForConsole && (
            <motion.div
              key="omakase"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="h-full overflow-hidden flex flex-col"
            >
              <ScrollArea className="flex-1">
                <div className="mx-auto max-w-3xl space-y-4 p-4 pb-20">
                  <div className="rounded-lg border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          현재 오마카세
                        </p>
                        <h2 className="mt-1 truncate text-xl font-semibold">
                          {omakaseDisplayName}
                        </h2>
                      </div>
                      <Badge variant="secondary" className="text-lg tabular-nums">
                        {omakaseStatus?.enabled ? `X ${omakaseCount}` : '설정 필요'}
                      </Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <Button
                        variant="outline"
                        disabled={!omakaseControlsEnabled || adjustOmakaseMutation.isPending}
                        onClick={() =>
                          sessionId &&
                          adjustOmakaseMutation.mutate({
                            liveSessionId: sessionId,
                            delta: -1,
                            reason: '오마카세 메뉴 수동 감소',
                          })
                        }
                      >
                        -
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!omakaseControlsEnabled || adjustOmakaseMutation.isPending}
                        onClick={() =>
                          sessionId &&
                          adjustOmakaseMutation.mutate({
                            liveSessionId: sessionId,
                            delta: 1,
                            reason: '오마카세 메뉴 수동 증가',
                          })
                        }
                      >
                        +
                      </Button>
                      <Button
                        disabled={!omakaseControlsEnabled || omakaseCount <= 0}
                        onClick={handleOpenOmakaseConsumeDialog}
                      >
                        <Music className="mr-1 size-4" />
                        이용
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">설정</h3>
                        <p className="text-xs text-muted-foreground">
                          팬에게 보여줄 표시 이름과 참고 가격을 조정합니다
                        </p>
                      </div>
                      <Switch
                        aria-label="오마카세 사용"
                        checked={omakaseEnabledDraft}
                        onCheckedChange={setOmakaseEnabledDraft}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          표시 이름
                        </span>
                        <Input
                          value={omakaseDisplayNameDraft}
                          maxLength={50}
                          onChange={(event) =>
                            setOmakaseDisplayNameDraft(event.target.value)
                          }
                          placeholder="오마카세"
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          참고 가격
                        </span>
                        <Input
                          value={omakasePriceDraft}
                          inputMode="numeric"
                          onChange={(event) =>
                            setOmakasePriceDraft(
                              event.target.value.replace(/[^\d]/g, ''),
                            )
                          }
                          placeholder="0"
                        />
                      </label>
                    </div>
                    <div className="flex items-center justify-end gap-3">
                      <Button
                        size="sm"
                        onClick={handleSaveConsoleOmakaseSettings}
                        disabled={
                          !omakaseSettingsChannelId ||
                          updateOmakaseSettingsMutation.isPending
                        }
                      >
                        {updateOmakaseSettingsMutation.isPending && (
                          <Loader2 className="mr-1 size-3 animate-spin" />
                        )}
                        저장
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-card p-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold">값 설정</h3>
                      <p className="text-xs text-muted-foreground">
                        입력한 값으로 바꾸면 차액만큼 기록이 남습니다
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={omakaseSetValue}
                        inputMode="numeric"
                        placeholder="개수"
                        onChange={(event) =>
                          setOmakaseSetValue(event.target.value.replace(/[^\d]/g, ''))
                        }
                      />
                      <Button
                        disabled={
                          !omakaseControlsEnabled ||
                          !omakaseSetValue ||
                          setOmakaseCountMutation.isPending
                        }
                        onClick={async () => {
                          if (!sessionId) return;
                          await setOmakaseCountMutation.mutateAsync({
                            liveSessionId: sessionId,
                            count: Number.parseInt(omakaseSetValue, 10) || 0,
                            reason: '오마카세 메뉴 값 설정',
                          });
                          setOmakaseSetValue('');
                        }}
                      >
                        적용
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-lg border bg-card p-4 space-y-2">
                    <h3 className="text-sm font-semibold">기록</h3>
                    {omakaseHistory.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        아직 오마카세 기록이 없습니다
                      </p>
                    ) : (
                      omakaseHistory.slice(0, 20).map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {entry.requesterNickname ?? entry.reason ?? entry.type}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(entry.createdAt), 'MM.dd HH:mm', {
                                locale: ko,
                              })}
                            </p>
                          </div>
                          <div className="text-right tabular-nums">
                            <p
                              className={
                                entry.delta >= 0 ? 'text-green-600' : 'text-red-600'
                              }
                            >
                              {entry.delta > 0 ? '+' : ''}
                              {entry.delta}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              잔여 {entry.balanceAfter}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </ScrollArea>
            </motion.div>
          )}
          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="h-full flex flex-col bg-background"
            >
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-3xl p-6 pb-20">
                  <div className="mb-6">
                    <h2 className="text-lg font-semibold">신청곡 설정</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      신청곡 수신 및 대기열 설정을 관리합니다
                    </p>
                  </div>
                  <SessionSettingsFields
                    settings={sheetSettings}
                    onChange={(partial) =>
                      setSheetSettingsDraft((prev) => ({ ...prev, ...partial }))
                    }
                    karaokePlaybackMode={karaokePlaybackMode}
                    onKaraokePlaybackModeChange={handleKaraokePlaybackModeChange}
                    karaokeVideoType={karaokeVideoType}
                    onKaraokeVideoTypeChange={handleKaraokeVideoTypeChange}
                    playbackSettingsDisabled={!isLive}
                    hasActiveSession={!!sessionId}
                    categories={sheetCategories?.map((c) => ({
                      id: c.id,
                      name: c.name,
                      color: c.color ?? null,
                    }))}
                    isPaused={isPaused}
                    onPausedChange={handlePausedChange}
                    showPauseToggle
                    pausedDisabled={settingsDisabled}
                    disabled={settingsDisabled}
                  />
                </div>
              </div>
              <div className="border-t bg-background px-4 py-3 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSheetSettingsDraft({})}
                  disabled={!hasSheetDraft || updateSettingsMutation.isPending || endSessionMutation.isPending}
                >
                  되돌리기
                </Button>
                <Button
                  onClick={() => void handleSaveSheetSettings()}
                  disabled={
                    !hasSheetDraft ||
                    !sessionId ||
                    updateSettingsMutation.isPending ||
                    endSessionMutation.isPending
                  }
                >
                  {(updateSettingsMutation.isPending || endSessionMutation.isPending) && (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  )}
                  저장
                </Button>
              </div>
            </motion.div>
          )}
          {activeTab === 'session-history' && (
            <motion.div
              key="session-history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="h-full flex flex-col bg-background"
            >
              <div className="flex-1 overflow-y-auto">
                <SessionHistory
                  identifier={user}
                  selectedSessionId={historyDetailSessionId}
                  onSelectSession={setHistoryDetailSessionId}
                  onRestored={() => {
                    setHistoryDetailSessionId(null);
                    setActiveTab('home');
                  }}
                />
              </div>
            </motion.div>
          )}
          {activeTab === 'queue' && (
            <motion.div
              key="queue"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="h-full flex flex-col"
            >
              {/* 서브탭 헤더 */}
              <div className="flex items-center justify-between px-4 py-2 border-b">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setQueueSubTab('queue')}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                      queueSubTab === 'queue'
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    대기열
                    {queue.length > 0 && (
                      <span className="ml-1">({queue.length})</span>
                    )}
                  </button>
                  <button
                    onClick={() => setQueueSubTab('history')}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                      queueSubTab === 'history'
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    기록
                    {history.length > 0 && (
                      <span className="ml-1">({history.length})</span>
                    )}
                  </button>
                </div>
                {queueSubTab === 'queue' && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={handleOpenAddDialog}
                  >
                    <Plus className="size-3.5 mr-1" />
                    추가
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="size-7 hover:text-destructive">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>대기열 초기화</AlertDialogTitle>
                        <AlertDialogDescription>
                          모든 대기열 신청곡이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          취소
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleClearQueue}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          초기화
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                )}
              </div>

              {queueSubTab === 'queue' ? (
              <ScrollArea className="flex-1 px-4 pb-4">
                <div className="space-y-2 pt-2">
                  {omakaseStatus?.enabled && (
                    <div className="rounded-lg border bg-card p-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {omakaseStatus.displayName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            잔여 {omakaseStatus.count}개
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-sm tabular-nums">
                          X {omakaseStatus.count}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-[auto_auto_1fr_auto] gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!sessionId || adjustOmakaseMutation.isPending}
                          onClick={() =>
                            sessionId &&
                            adjustOmakaseMutation.mutate({
                              liveSessionId: sessionId,
                              delta: -1,
                              reason: '리모컨 수동 감소',
                            })
                          }
                        >
                          -
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!sessionId || adjustOmakaseMutation.isPending}
                          onClick={() =>
                            sessionId &&
                            adjustOmakaseMutation.mutate({
                              liveSessionId: sessionId,
                              delta: 1,
                              reason: '리모컨 수동 증가',
                            })
                          }
                        >
                          +
                        </Button>
                        <Input
                          value={omakaseSetValue}
                          inputMode="numeric"
                          placeholder="값 설정"
                          className="h-8"
                          onChange={(event) =>
                            setOmakaseSetValue(event.target.value.replace(/[^\d]/g, ''))
                          }
                        />
                        <Button
                          size="sm"
                          disabled={
                            !sessionId ||
                            !omakaseSetValue ||
                            setOmakaseCountMutation.isPending
                          }
                          onClick={async () => {
                            if (!sessionId) return;
                            await setOmakaseCountMutation.mutateAsync({
                              liveSessionId: sessionId,
                              count: Number.parseInt(omakaseSetValue, 10) || 0,
                              reason: '리모컨 값 설정',
                            });
                            setOmakaseSetValue('');
                          }}
                        >
                          적용
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!sessionId || omakaseStatus.count <= 0}
                        onClick={handleOpenOmakaseConsumeDialog}
                      >
                        <Music className="mr-1 size-3.5" />
                        {omakaseStatus.displayName} 이용
                      </Button>
                      {omakaseHistory.length > 0 && (
                        <div className="space-y-1 border-t pt-2">
                          {omakaseHistory.slice(0, 3).map((entry) => (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="truncate text-muted-foreground">
                                {entry.requesterNickname ?? entry.reason ?? entry.type}
                              </span>
                              <span className="tabular-nums">
                                {entry.delta > 0 ? '+' : ''}
                                {entry.delta} / {entry.balanceAfter}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <AnimatePresence>
                    {queue.map((item, index) => (
                      <Fragment key={item.id}>
                        <QueueCard
                          item={item}
                          index={index}
                          onMoveUp={() => handleMoveUp(item.id)}
                          onMoveDown={() => handleMoveDown(item.id)}
                          onPlay={() => handlePlayNow(item)}
                          onDelete={() => handleDeleteRequest(item.id)}
                        />
                        {index < queue.length - 1 && (
                          <QueueInsertSlot onClick={() => handleOpenAddDialogAfter(item.id)} />
                        )}
                      </Fragment>
                    ))}
                  </AnimatePresence>
                  {queue.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center py-12 text-center"
                    >
                      <div className="size-16 rounded-xl bg-muted flex items-center justify-center mb-4 ring-1 ring-border">
                        <ListMusic className="size-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">대기열이 비어있습니다</p>
                      <p className="text-xs text-muted-foreground/70">신청곡을 기다리거나 직접 추가하세요</p>
                    </motion.div>
                  )}
                </div>
              </ScrollArea>
              ) : (
              <ScrollArea className="flex-1 px-4 pb-4">
                <div className="space-y-1.5 pt-2">
                  {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="size-16 rounded-xl bg-muted flex items-center justify-center mb-4 ring-1 ring-border">
                        <History className="size-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">기록이 없습니다</p>
                      <p className="text-xs text-muted-foreground/70">이번 세션에서 완료되거나 거절된 곡이 여기에 표시됩니다</p>
                    </div>
                  ) : (
                    history.map((item) => (
                      <div
                        key={item.id}
                        className="group flex items-center gap-3 p-2.5 rounded-lg border bg-card"
                      >
                        {item.albumArt ? (
                          <img src={item.albumArt} alt={item.title} className="size-10 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="size-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                            <Music className="size-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.title}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                            <span className="truncate">{item.artist}</span>
                            <span className="shrink-0">·</span>
                            <span className="truncate">{item.requester}</span>
                          </div>
                          {item.status === 'rejected' && item.rejectionReason && (
                            <p className="text-xs text-destructive/70 truncate mt-0.5">
                              사유: {item.rejectionReason}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <Badge
                            variant={item.status === 'completed' ? 'default' : 'destructive'}
                            className={cn(
                              "text-[10px] h-5",
                              item.status === 'completed' && "bg-green-500 hover:bg-green-500/80"
                            )}
                          >
                            {item.status === 'completed' ? (
                              <>
                                <CheckCircle2 className="size-2.5 mr-0.5" />
                                완료
                              </>
                            ) : (
                              <>
                                <XCircle className="size-2.5 mr-0.5" />
                                거절
                              </>
                            )}
                          </Badge>
                          {item.completedAt && (
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {format(new Date(item.completedAt), 'HH:mm', { locale: ko })}
                            </span>
                          )}
                        </div>
                        {item.status === 'completed' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-primary hover:bg-primary/10"
                            onClick={() => handleReviveRequest(item)}
                            disabled={createManualRequestMutation.isPending}
                            title="다음 재생 위치로 다시 추가"
                            aria-label="다시 추가"
                          >
                            <RotateCcw className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
              )}
            </motion.div>
          )}
          {activeTab === 'overlay' && (
            <motion.div
              key="overlay"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="h-full overflow-y-auto"
            >
              <div className="p-4 space-y-4">
                {/* 리모콘 오버레이 서브탭 */}
                <div className="flex items-center gap-1 border-b pb-2">
                  <button
                    type="button"
                    onClick={() => setOverlaySubTab('settings')}
                    className={cn(
                      'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                      overlaySubTab === 'settings'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    오버레이 설정
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverlaySubTab('theme')}
                    className={cn(
                      'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                      overlaySubTab === 'theme'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    테마 설정
                  </button>
                </div>

                {overlaySubTab === 'settings' && (
                  <div className="space-y-6">
                {/* 오버레이 설정 (통합 레이아웃) */}
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium">오버레이 설정</h3>
                    <p className="text-xs text-muted-foreground">
                      통합 오버레이 위젯 배치와 우선순위를 수정합니다
                    </p>
                  </div>
                  <TotalOverlayLayoutSettings
                    user={user}
                    overlayToken={overlayToken ?? null}
                    isTokenLoading={false}
                    embedded
                  />
                </div>

                {/* 오버레이 링크 섹션 */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">오버레이 링크</h3>
                  <p className="text-xs text-muted-foreground">
                    OBS나 방송 프로그램에 브라우저 소스로 추가하세요
                  </p>

                  <div className="space-y-2">
                    {/* 통합 오버레이 */}
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded bg-primary/10 flex items-center justify-center">
                          <LayoutDashboard className="size-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">통합 오버레이</p>
                          <p className="text-xs text-muted-foreground">여러 위젯을 한 화면에 표시</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const url = overlayToken
                            ? `${normalizedOverlayBaseUrl}/overlay/${overlayToken}/widgets/total`
                            : '';
                          if (!url) return;
                          navigator.clipboard.writeText(url);
                          setObsGuide({ url, widgetName: '통합 오버레이', width: 1920, height: 1080 });
                        }}
                        disabled={!overlayToken}
                      >
                        <ExternalLink className="size-3.5 mr-1.5" />
                        복사
                      </Button>
                    </div>

                    {/* 신청곡 대기열 오버레이 */}
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded bg-primary/10 flex items-center justify-center">
                          <ListMusic className="size-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">신청곡 대기열</p>
                          <p className="text-xs text-muted-foreground">현재 대기 중인 곡 목록</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const url = overlayToken
                              ? `${normalizedOverlayBaseUrl}/overlay/${overlayToken}/widgets/queue`
                              : '';
                            if (!url) return;
                            navigator.clipboard.writeText(url);
                            setObsGuide({ url, widgetName: '신청곡 대기열', width: 350, height: 700 });
                          }}
                          disabled={!overlayToken}
                        >
                          <ExternalLink className="size-3.5 mr-1.5" />
                          복사
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setWidgetSettingsType('queue')}
                        >
                          <Settings className="size-3.5 mr-1.5" />
                          설정
                        </Button>
                      </div>
                    </div>

                    {/* 현재 재생 중 오버레이 */}
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded bg-primary/10 flex items-center justify-center">
                          <Music className="size-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">현재 재생 중</p>
                          <p className="text-xs text-muted-foreground">지금 재생 중인 곡 정보</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const url = overlayToken
                              ? `${normalizedOverlayBaseUrl}/overlay/${overlayToken}/widgets/now-playing`
                              : '';
                            if (!url) return;
                            navigator.clipboard.writeText(url);
                            setObsGuide({ url, widgetName: '현재 재생 중', width: 400, height: 160 });
                          }}
                          disabled={!overlayToken}
                        >
                          <ExternalLink className="size-3.5 mr-1.5" />
                          복사
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setWidgetSettingsType('now-playing')}
                        >
                          <Settings className="size-3.5 mr-1.5" />
                          설정
                        </Button>
                      </div>
                    </div>

                    {/* 셋리스트 오버레이 */}
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-3">
                        <div className="size-8 rounded bg-primary/10 flex items-center justify-center">
                          <FileText className="size-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">셋리스트</p>
                          <p className="text-xs text-muted-foreground">대기열 + 재생 기록을 한 화면에</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const url = overlayToken
                              ? `${normalizedOverlayBaseUrl}/overlay/${overlayToken}/widgets/setlist`
                              : '';
                            if (!url) return;
                            navigator.clipboard.writeText(url);
                            setObsGuide({ url, widgetName: '셋리스트', width: 400, height: 700 });
                          }}
                          disabled={!overlayToken}
                        >
                          <ExternalLink className="size-3.5 mr-1.5" />
                          복사
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setWidgetSettingsType('setlist')}
                        >
                          <Settings className="size-3.5 mr-1.5" />
                          설정
                        </Button>
                      </div>
                    </div>

                  </div>
                </div>

                {/* 안내 */}
                {!overlayToken && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {channelTokenLoading
                        ? '오버레이 토큰을 불러오는 중입니다…'
                        : '오버레이 토큰을 발급받으려면 신청곡 모드를 한 번 시작해 주세요. 한 번 발급되면 이후엔 모드 시작 없이도 사용할 수 있습니다.'}
                    </p>
                  </div>
                )}
                  </div>
                )}

                {overlaySubTab === 'theme' && (
                  <ThemeConfigSection
                    channelIdentifier={user}
                    overlayToken={overlayToken ?? null}
                    activeTab="default"
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </main>
        </ResizablePanel>
        {isDesktopLayout && <ResizableHandle withHandle />}
        {isDesktopLayout && (
          <ResizablePanel defaultSize={50} minSize={32} maxSize={65} order={2}>
            <aside className="h-full flex flex-col bg-background text-sm">
              <div className="flex-1 overflow-y-auto">
                {/* 통합 오버레이 링크 */}
                <section className="border-b px-3 py-3 space-y-1.5">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">통합 오버레이 링크</h3>
                  <div className="flex items-center gap-1.5">
                    <Input
                      readOnly
                      value={
                        overlayToken
                          ? `${normalizedOverlayBaseUrl}/overlay/${overlayToken}/widgets/total`
                          : ''
                      }
                      placeholder={overlayToken ? '' : channelTokenLoading ? '토큰 확인 중…' : '신청곡 모드를 한 번 시작해 주세요'}
                      className="text-[11px] h-7"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs shrink-0"
                      disabled={!overlayToken}
                      onClick={() => {
                        const url = overlayToken
                          ? `${normalizedOverlayBaseUrl}/overlay/${overlayToken}/widgets/total`
                          : '';
                        if (!url) return;
                        navigator.clipboard.writeText(url);
                        setObsGuide({ url, widgetName: '통합 오버레이', width: 1920, height: 1080 });
                      }}
                    >
                      <ExternalLink className="size-3 mr-1" />
                      복사
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    다른 위젯은 상단 오버레이 탭에서 복사
                  </p>
                </section>

                {/* 탭: 신청곡 설정 | 오버레이 설정 */}
                <div className="flex items-center gap-1 border-b px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => setSideTab('song')}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                      sideTab === 'song'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    신청곡 설정
                  </button>
                  <button
                    type="button"
                    onClick={() => setSideTab('overlay')}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                      sideTab === 'overlay'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                  >
                    오버레이 설정
                  </button>
                </div>

                {/* 탭 콘텐츠 */}
                <div className="px-3 py-3">
                  {sideTab === 'song' && (
                    <SessionSettingsFields
                      compact
                      settings={sheetSettings}
                      onChange={(partial) =>
                        setSheetSettingsDraft((prev) => ({ ...prev, ...partial }))
                      }
                      karaokePlaybackMode={karaokePlaybackMode}
                      onKaraokePlaybackModeChange={handleKaraokePlaybackModeChange}
                      karaokeVideoType={karaokeVideoType}
                      onKaraokeVideoTypeChange={handleKaraokeVideoTypeChange}
                      playbackSettingsDisabled={!isLive}
                      hasActiveSession={!!sessionId}
                      categories={sheetCategories?.map((c) => ({
                        id: c.id,
                        name: c.name,
                        color: c.color ?? null,
                      }))}
                      isPaused={isPaused}
                      onPausedChange={handlePausedChange}
                      showPauseToggle
                      pausedDisabled={settingsDisabled}
                      disabled={settingsDisabled}
                    />
                  )}
                  {sideTab === 'overlay' && (
                    <TotalOverlayLayoutSettings
                      user={user}
                      overlayToken={overlayToken ?? null}
                      isTokenLoading={false}
                      embedded
                    />
                  )}
                </div>
              </div>

              {/* 저장/되돌리기 (신청곡 설정 탭일 때만) */}
              {sideTab === 'song' && (
                <div className="border-t bg-background px-3 py-2 flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setSheetSettingsDraft({})}
                    disabled={!hasSheetDraft || updateSettingsMutation.isPending || endSessionMutation.isPending}
                  >
                    되돌리기
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => void handleSaveSheetSettings()}
                    disabled={
                      !hasSheetDraft ||
                      !sessionId ||
                      updateSettingsMutation.isPending ||
                      endSessionMutation.isPending
                    }
                  >
                    {(updateSettingsMutation.isPending || endSessionMutation.isPending) && (
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    )}
                    저장
                  </Button>
                </div>
              )}
            </aside>
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

      {/* 고정 푸터 - 상태 표시 */}
      <footer className="sticky bottom-0 z-50 bg-muted/95 backdrop-blur-sm border-t">
        <div className="flex items-center justify-between px-4 py-2">
          {/* 연결 상태 */}
          <div className="flex items-center gap-3">
            {isLive && (
              <>
                <WebSocketIndicator
                  isConnected={isConnected}
                  isJoined={isJoined}
                  connectionStatus={connectionStatus}
                  onReconnect={reconnect}
                />
                <div className="h-3 w-px bg-border" />
              </>
            )}
            <SessionStatusIndicator isLive={isLive} />
            <div className="h-3 w-px bg-border" />
            <span className="text-xs text-muted-foreground tabular-nums">
              {queue.length}곡 대기
            </span>
          </div>

          {/* 신청곡 상태 */}
          <div className="flex items-center gap-2">
            {isLive && requestEnabled && !isPaused ? (
              <Badge className="h-5 px-2 text-[10px]">
                신청 ON
              </Badge>
            ) : isLive && requestEnabled && isPaused ? (
              <Badge variant="secondary" className="h-5 px-2 text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30">
                일시정지
              </Badge>
            ) : (
              <Badge variant="outline" className="h-5 px-2 text-[10px]">
                신청 OFF
              </Badge>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
