export type ScheduleVisibility = "PUBLIC" | "PRIVATE";

export interface ScheduleAuthor {
  id: string;
  nickname: string;
  profileImageUrl: string | null;
}

export interface ScheduleChannel {
  id: string;
  name: string;
  profileImageUrl: string | null;
  webPath: string;
  isOwnerProSubscriber?: boolean;
  isOwnerAmbassador?: boolean;
}

export type ScheduleStatus = "LIVE" | "COLLAB" | "OFF" | "ETC" | "TBD";

export interface Schedule {
  id: number;
  channelId: string;
  channelWebPath: string;
  author: ScheduleAuthor;
  channel?: ScheduleChannel;
  title: string;
  content: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  isCanceled: boolean;
  visibility: ScheduleVisibility;
  status: ScheduleStatus;
  location: string | null;
  externalUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleRequest {
  title: string;
  content?: string;
  startAt: string;
  endAt?: string;
  allDay?: boolean;
  visibility?: ScheduleVisibility;
  location?: string;
  externalUrl?: string;
  status?: ScheduleStatus;
}

export interface UpdateScheduleRequest {
  title?: string;
  content?: string;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  visibility?: ScheduleVisibility;
  location?: string;
  externalUrl?: string;
  status?: ScheduleStatus;
}

export interface GetSchedulesQuery {
  ym?: string;
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  channelIds?: number[];
}

export interface GetSchedulesResponse {
  items: Schedule[];
  page: number;
  limit: number;
  total: number;
}
