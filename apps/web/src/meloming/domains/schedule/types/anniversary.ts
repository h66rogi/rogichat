/**
 * 캘린더에 표시할 기념일 정보
 */
export interface CalendarAnniversary {
  id: string;
  channelId: number;
  channelName: string;
  webPath: string;
  profileImageUrl?: string | null;
  themeColor?: string | null;
  type: "broadcast" | "birthday";
  label: string; // "100일", "1주년", "생일 (9월 25일)" 등
  date: string; // ISO date string
  daysUntil: number;
  isOwnerProSubscriber?: boolean;
  isOwnerAmbassador?: boolean;
}
