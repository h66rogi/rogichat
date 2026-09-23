export type RecurringScheduleStatus = "LIVE" | "OFF";

export interface RecurringSchedule {
  id: number;
  channelId: number;
  dayOfWeek: number; // 0(일) ~ 6(토)
  title: string;
  startTime: string | null; // "HH:mm", 휴방 시 null
  status: RecurringScheduleStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringScheduleItem {
  dayOfWeek: number;
  title: string;
  startTime?: string | null;
  status: RecurringScheduleStatus;
  isActive: boolean;
}

export interface SaveRecurringSchedulesRequest {
  schedules: RecurringScheduleItem[];
}

export interface RecurringSchedulesResponse {
  items: RecurringSchedule[];
}
