import type { FeatureFlagName } from "@/meloming/shared/lib/feature-flags";
import {
  Music,
  Tag,
  User,
  Plus,
  Settings,
  Home,
  Paintbrush,
  UserCog2,
  Star,
  BadgeCheck,
  ListMusic,
  ListOrdered,
  Layers,
  Radio,
  ListVideo,
  Play,
  LayoutDashboard,
  CalendarCog,
  LayoutTemplate,
  ImageDown,
  Gamepad2,
  History,
  ScrollText,
  Smile,
  Code2,
  ArrowRightLeft,
  Share2,
  ListChecks,
  Shirt,
  QrCode,
  FileDown,
} from "lucide-react";

// 오버레이 타입 정의
export type OverlayType =
  | "queue" // 신청곡 대기열
  | "now-playing" // 지금 부르는 곡
  | "setlist" // 셋리스트
  | "songbook-qr" // 노래책 QR
  | "total"; // 통합 오버레이

export interface OverlayTypeInfo {
  id: OverlayType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  comingSoon?: boolean;
  featureFlag?: FeatureFlagName;
}

export const OVERLAY_TYPES: OverlayTypeInfo[] = [
  {
    id: "total",
    label: "통합 오버레이",
    icon: LayoutDashboard,
    description: "모든 위젯을 한 화면에",
  },
  {
    id: "queue",
    label: "신청곡 대기열",
    icon: ListVideo,
    description: "대기 중인 신청곡 목록",
  },
  {
    id: "now-playing",
    label: "지금 부르는 곡",
    icon: Play,
    description: "현재 재생 중인 곡 정보",
  },
  {
    id: "setlist",
    label: "셋리스트",
    icon: ScrollText,
    description: "전체 신청곡 목록을 줄글로 표시합니다",
    featureFlag: "overlaySetlist",
  },
  {
    id: "songbook-qr",
    label: "노래책 QR",
    icon: QrCode,
    description: "채널 노래책으로 이동하는 QR 코드",
  },
];

// 관리 메뉴 아이템 타입
export type ManagementSection =
  | "home"
  | "songs"
  | "songbook-download"
  | "add-song"
  | "categories"
  | "artists"
  | "clip-requests"
  | "song-requests"
  | "live"
  | "song-request-settings"
  | "overlay-settings"
  | "overlay-custom-css"
  | "console"
  | "stream-deck"
  | "session-history"
  | "schedule-settings"
  | "schedule-templates"
  | "schedule-image"
  | "sns-settings"
  | "channel-features"
  | "guestbook-settings"
  | "setlists"
  | "emoticons"
  | "wardrobe"
  | "manager"
  | "favorites"
  | "decoration"
  | "channel-auth"
  | "settings"
  | "channel-transfer";

export interface ManagementMenuItem {
  id: ManagementSection;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description?: string;
  // Optional group label for sidebar grouping (e.g., "노래책", "채널 설정")
  group?: ManagementGroup;
  badge?: string;
}

// Sidebar grouping labels
export const MANAGEMENT_GROUPS = {
  SONGBOOK: "노래책",
  SONG_REQUEST: "신청곡",
  CONTENT: "콘텐츠 관리",
  SETTINGS: "채널 관리",
} as const;

export type ManagementGroup =
  (typeof MANAGEMENT_GROUPS)[keyof typeof MANAGEMENT_GROUPS];

export const MANAGEMENT_MENU_ITEMS: ManagementMenuItem[] = [
  {
    id: "home",
    label: "홈",
    icon: Home,
    description: "대시보드 및 통계",
  },
  {
    id: "songs",
    label: "노래 관리",
    icon: Music,
    description: "노래 목록 조회 및 수정",
    group: MANAGEMENT_GROUPS.SONGBOOK,
  },
  {
    id: "songbook-download",
    label: "노래책 다운로드",
    icon: FileDown,
    description: "등록한 노래 목록을 CSV 파일로 저장",
    group: MANAGEMENT_GROUPS.SONGBOOK,
  },
  {
    id: "add-song",
    label: "노래 추가",
    icon: Plus,
    description: "새로운 노래 추가",
    group: MANAGEMENT_GROUPS.SONGBOOK,
  },
  {
    id: "categories",
    label: "카테고리 관리",
    icon: Tag,
    description: "카테고리 추가, 수정, 삭제",
    group: MANAGEMENT_GROUPS.SONGBOOK,
  },
  {
    id: "artists",
    label: "아티스트 관리",
    icon: User,
    description: "아티스트 추가, 수정, 삭제",
    group: MANAGEMENT_GROUPS.SONGBOOK,
  },
  {
    id: "song-requests",
    label: "노래 등록 요청",
    icon: ListMusic,
    description: "노래 등록 요청 승인 및 거절",
    group: MANAGEMENT_GROUPS.SONGBOOK,
  },
  {
    id: "song-request-settings",
    label: "신청곡 설정",
    icon: ListOrdered,
    description: "신청곡 기능 설정",
    group: MANAGEMENT_GROUPS.SONG_REQUEST,
  },
  {
    id: "overlay-settings",
    label: "오버레이",
    icon: Layers,
    description: "방송 오버레이 URL 및 테마 설정",
    group: MANAGEMENT_GROUPS.SONG_REQUEST,
  },
  {
    id: "overlay-custom-css",
    label: "커스텀 CSS",
    icon: Code2,
    description: "오버레이 위젯별 커스텀 CSS 편집",
    group: MANAGEMENT_GROUPS.SONG_REQUEST,
  },
  {
    id: "console",
    label: "리모컨 (신청곡 콘솔)",
    icon: Gamepad2,
    description: "OBS 콘솔 접속 URL 및 토큰 관리",
    group: MANAGEMENT_GROUPS.SONG_REQUEST,
  },
  {
    id: "stream-deck",
    label: "스트림덱 연동",
    icon: Gamepad2,
    description: "Elgato Stream Deck 플러그인 다운로드 및 설정",
    group: MANAGEMENT_GROUPS.SONG_REQUEST,
    badge: "NEW",
  },
  {
    id: "session-history",
    label: "신청곡 기록",
    icon: History,
    description: "과거 신청곡 세션 기록 조회",
    group: MANAGEMENT_GROUPS.SONG_REQUEST,
  },
  // 콘텐츠 관리
  {
    id: "schedule-settings",
    label: "방송 일정",
    icon: CalendarCog,
    description: "반복 일정 및 공지 설정",
    group: MANAGEMENT_GROUPS.CONTENT,
  },
  {
    id: "schedule-templates",
    label: "시간표 템플릿",
    icon: LayoutTemplate,
    description: "주간 방송 일정 이미지를 자동 생성",
    group: MANAGEMENT_GROUPS.CONTENT,
    badge: "NEW",
  },
  {
    id: "schedule-image",
    label: "시간표 이미지",
    icon: ImageDown,
    description: "주간 일정 이미지 자동 생성·다운로드",
    group: MANAGEMENT_GROUPS.CONTENT,
    badge: "NEW",
  },
  {
    id: "sns-settings",
    label: "SNS 연동",
    icon: Share2,
    description: "X·네이버 카페 자동 게시 연동",
    group: MANAGEMENT_GROUPS.CONTENT,
    badge: "NEW",
  },
  {
    id: "setlists",
    label: "셋리스트 관리",
    icon: ScrollText,
    description: "지난 방송 셋리스트의 공개/비공개를 관리합니다",
    group: MANAGEMENT_GROUPS.CONTENT,
  },
  {
    id: "wardrobe",
    label: "옷장",
    icon: Shirt,
    description: "의상, 헤어 등 이미지 항목을 관리합니다",
    group: MANAGEMENT_GROUPS.CONTENT,
    badge: "NEW",
  },
  // 채널 관리
  {
    id: "settings",
    label: "채널 설정",
    icon: Settings,
    description: "채널 기본 정보 및 메타 설정",
    group: MANAGEMENT_GROUPS.SETTINGS,
  },
  {
    id: "channel-features",
    label: "채널 기능",
    icon: ListChecks,
    description: "채널 메뉴 노출과 표시 이름 관리",
    group: MANAGEMENT_GROUPS.SETTINGS,
  },
  {
    id: "decoration",
    label: "채널 꾸미기",
    icon: Paintbrush,
    description: "채널 테마 및 배경 설정",
    group: MANAGEMENT_GROUPS.SETTINGS,
    badge: "PRO",
  },
  {
    id: "manager",
    label: "매니저",
    icon: UserCog2,
    description: "채널 매니저 설정",
    group: MANAGEMENT_GROUPS.SETTINGS,
  },
  {
    id: "favorites",
    label: "즐겨찾기 유저",
    icon: Star,
    description: "채널을 즐겨찾기한 유저 목록",
    group: MANAGEMENT_GROUPS.SETTINGS,
  },
  {
    id: "channel-transfer",
    label: "채널 이전하기",
    icon: ArrowRightLeft,
    description: "채널 소유권 이전",
    group: MANAGEMENT_GROUPS.SETTINGS,
  },
  {
    id: "channel-auth",
    label: "채널 인증",
    icon: BadgeCheck,
    description: "치지직/숲 계정과 채널 연결",
    group: MANAGEMENT_GROUPS.SETTINGS,
  },
  {
    id: "emoticons",
    label: "이모티콘",
    icon: Smile,
    description: "채널 전용 커스텀 이모티콘 관리",
    group: MANAGEMENT_GROUPS.CONTENT,
    badge: "PRO",
  },
  {
    id: "live",
    label: "신청곡 모드",
    icon: Radio,
    description: "실시간 신청곡 관리",
    // Quick Action 전용 - 그룹 없음
  },
];

export interface CategoryFormData {
  name: string;
  color: string;
  price?: number | null;
  currencyPrices?: Record<string, number | null> | null;
}

export const DEFAULT_COLORS = [
  "#3B82F6", // blue
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#06B6D4", // cyan
  "#84CC16", // lime
  "#F97316", // orange
  "#EC4899", // pink
  "#6B7280", // gray
];
