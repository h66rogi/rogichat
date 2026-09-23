import type { ScheduleStatus } from "@/meloming/domains/schedule/types/schedule";
import {
  HelpCircle,
  MoreHorizontal,
  Moon,
  Radio,
  Users,
  type LucideIcon,
} from "lucide-react";

export type ScheduleStatusColorTokens = {
  /** 카드 본문 배경 (light/dark) */
  bg: string;
  /** 텍스트(라벨) 색상 (light/dark) */
  text: string;
  /** 카드 외곽 border 색상 (desktop 일반 border) */
  border: string;
  /** 좌측 strip 색상 (border-l-4 등에 들어갈 단색 테두리) */
  stripBorder: string;
  /** dot, 아이콘 등 단색 강조용 — solid background */
  dot: string;
  /** 라벨 배지(Badge) 의 배경/텍스트 한 묶음 */
  badge: string;
};

export type ScheduleStatusMeta = {
  status: ScheduleStatus;
  /** 한국어 라벨 */
  label: string;
  /** lucide-react 아이콘 컴포넌트 */
  icon: LucideIcon;
  colorTokens: ScheduleStatusColorTokens;
};

const META: Record<ScheduleStatus, ScheduleStatusMeta> = {
  LIVE: {
    status: "LIVE",
    label: "방송",
    icon: Radio,
    colorTokens: {
      bg: "bg-blue-50 dark:bg-blue-950/30",
      text: "text-blue-700 dark:text-blue-300",
      border: "border-blue-200 dark:border-blue-900",
      stripBorder: "border-l-blue-500",
      dot: "bg-blue-500",
      badge:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    },
  },
  COLLAB: {
    status: "COLLAB",
    label: "합방",
    icon: Users,
    colorTokens: {
      bg: "bg-purple-50 dark:bg-purple-950/30",
      text: "text-purple-700 dark:text-purple-300",
      border: "border-purple-200 dark:border-purple-900",
      stripBorder: "border-l-purple-500",
      dot: "bg-purple-500",
      badge:
        "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
    },
  },
  OFF: {
    status: "OFF",
    label: "휴방",
    icon: Moon,
    colorTokens: {
      bg: "bg-red-50 dark:bg-red-950/30",
      text: "text-red-700 dark:text-red-300",
      border: "border-red-200 dark:border-red-900",
      stripBorder: "border-l-red-500",
      dot: "bg-red-500",
      badge:
        "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    },
  },
  ETC: {
    status: "ETC",
    label: "기타",
    icon: MoreHorizontal,
    colorTokens: {
      bg: "bg-slate-50 dark:bg-slate-900/40",
      text: "text-slate-700 dark:text-slate-200",
      border: "border-slate-200 dark:border-slate-700",
      stripBorder: "border-l-slate-500",
      dot: "bg-slate-500",
      badge:
        "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
    },
  },
  TBD: {
    status: "TBD",
    label: "미정",
    icon: HelpCircle,
    colorTokens: {
      bg: "bg-gray-50 dark:bg-gray-800/40",
      text: "text-gray-700 dark:text-gray-300",
      border: "border-gray-200 dark:border-gray-700",
      stripBorder: "border-l-gray-400",
      dot: "bg-gray-400",
      badge:
        "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    },
  },
};

/**
 * ScheduleStatus(5종)에 대한 라벨/아이콘/색상 메타를 반환.
 * ScheduleCardDesktop / ScheduleCardMobile / schedule-detail-dialog 에서 공유.
 */
export function getStatusMeta(status: ScheduleStatus): ScheduleStatusMeta {
  return META[status] ?? META.TBD;
}

/** 5종 enum 모두에 대한 메타를 가져오고 싶을 때 (테스트/스토리북 용). */
export const ALL_STATUS_META: ReadonlyArray<ScheduleStatusMeta> = [
  META.LIVE,
  META.COLLAB,
  META.OFF,
  META.ETC,
  META.TBD,
];
