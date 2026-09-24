import { Music, Tag, User, Plus, Home, ListMusic, ListOrdered, Radio, CalendarCog, History, ScrollText, Shirt, FileDown, Film, Settings, Gamepad2 } from "lucide-react";

// 관리 메뉴 아이템 타입
export type ManagementSection =
  | "home" | "songs" | "songbook-download" | "add-song" | "categories"
  | "artists" | "song-requests" | "clip-requests" | "live" | "console" | "song-request-settings"
  | "session-history" | "schedule-settings" | "setlists" | "wardrobe" | "settings";

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
    id: "clip-requests",
    label: "클립 등록 요청",
    icon: Film,
    description: "노래클립 등록 요청 승인 및 거절",
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
    id: "console",
    label: "리모컨 (신청곡 콘솔)",
    icon: Gamepad2,
    description: "OBS 콘솔 접속 URL 및 토큰 관리",
    group: MANAGEMENT_GROUPS.SONG_REQUEST,
  },
  {
    id: "session-history",
    label: "신청곡 기록",
    icon: History,
    description: "과거 신청곡 세션 기록 조회",
    group: MANAGEMENT_GROUPS.SONG_REQUEST,
  },
  {
    id: "schedule-settings",
    label: "방송 일정",
    icon: CalendarCog,
    description: "반복 일정 및 공지 설정",
    group: MANAGEMENT_GROUPS.CONTENT,
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
  {
    id: "settings",
    label: "설정",
    icon: Settings,
    description: "채널 및 노래책 설정",
    group: MANAGEMENT_GROUPS.SETTINGS,
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
