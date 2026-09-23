/**
 * 채널 프로필 링크
 */
export interface ProfileLink {
  label: string;
  url: string;
  icon: string;
}

/**
 * 방송 기념일 정보 (데뷔일 기준)
 */
export interface ProfileMilestones {
  daysPassed: number; // 데뷔일 기준 경과일 (데뷔 당일 = 1, D+ 표기용)
  nextMilestone: string; // "100일" | "200일" | "1주년" | "2주년" ...
  daysToMilestone: number; // 다음 기념일까지 남은 일수
}

/**
 * 생일 D-Day 정보
 */
export interface ProfileBirthday {
  daysUntilBirthday: number; // 다음 생일까지 남은 일수 (0이면 D-DAY)
  birthdayDate: string; // "1월 1일" 형식
}

/**
 * 다가오는 기념일 이벤트 정보
 */
export interface ProfileUpcomingEvent {
  type: "broadcast" | "birthday"; // 방송 기념일 vs 생일
  label: string; // "100일" | "1주년" | "생일 (1월 1일)" 등
  daysUntil: number; // 해당 이벤트까지 남은 일수
}

/**
 * 채널 프로필 기념일 정보
 */
export interface ProfileAnniversaries {
  milestones: ProfileMilestones | null;
  birthday: ProfileBirthday | null;
  nextUpcomingEvent: ProfileUpcomingEvent | null;
}

/**
 * 채널 프로필 (공개)
 */
export interface ChannelProfile {
  channelId: number;
  birthday: string | null;
  residence: string | null;
  heightCm: string | null;
  weightKg: string | null;
  nationality: string | null;
  gender: string | null;
  symbolColor: string | null;
  agency: string | null;
  affiliatedGroups: string[];
  fandomName: string | null;
  religion: string | null;
  nickname: string | null;
  description: string | null;
  homeDescription: string | null;
  education: string[];
  mbti: string | null;
  alias: string[];
  debutDate: string | null;
  broadcastingPlatforms: string[];
  bio: string | null;
  links: ProfileLink[];
  updatedAt: string;
  anniversaries?: ProfileAnniversaries;
}

/**
 * GET /channel/{channelId}/profile
 */
export type GetChannelProfileResponse = ChannelProfile;

/**
 * PUT /channel/{channelId}/profile - 전체 업데이트
 */
export interface PutChannelProfileRequestBody {
  birthday?: string | null;
  residence?: string | null;
  heightCm?: string | null;
  weightKg?: string | null;
  nationality?: string | null;
  gender?: string | null;
  symbolColor?: string | null;
  agency?: string | null;
  nickname?: string | null;
  description?: string | null;
  homeDescription?: string | null;
  affiliatedGroups?: string[];
  fandomName?: string | null;
  religion?: string | null;
  education?: string[];
  mbti?: string | null;
  alias?: string[];
  debutDate?: string | null;
  broadcastingPlatforms?: string[];
  bio?: string | null;
  links?: ProfileLink[];
}

export type PutChannelProfileResponse = ChannelProfile;

/**
 * PATCH /channel/{channelId}/profile - 부분 업데이트
 */
export type PatchChannelProfileRequestBody =
  Partial<PutChannelProfileRequestBody>;

export type PatchChannelProfileResponse = ChannelProfile;
