/**
 * Domain
 */

export interface Manager {
  id: number;
  channelId: number;
  userId: number;
  nickname: string;
  profileImageUrl?: string;
  canManageContent: boolean;
  canManageSettings: boolean;
  canManageProfile: boolean;
  canManageGuestbook: boolean;
  canManageCustomization: boolean;
  canManageEmoticons: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // 하위 호환성을 위해 user 객체도 optional로 유지
  user?: {
    id: number;
    email: string;
    nickname: string;
  };
}

export interface ManagerSearchUser {
  id: number;
  email: string;
  nickname: string;
  profileImageUrl: string;
}

/**
 * Dto
 */

export type GetChannelsChannelIdManagersSearchUsersRequestQuery = {
  nickname: string;
};

export type GetChannelsChannelIdManagersSearchUsersResponse =
  ManagerSearchUser[];

export interface GetChannelsChannelIdManagersResponse {
  managers: Manager[];
  maxActiveManagers: number; // 구독: 10, 비구독: 1
  activeManagerCount: number;
  isProSubscriber: boolean;
}

export interface ToggleManagerActiveResponse {
  id: number;
  isActive: boolean;
  deactivatedManagerId?: number; // 비구독자가 다른 매니저 활성화 시 기존 비활성화된 매니저 ID
}

export type ManagerPermissionKey =
  | "canManageContent"
  | "canManageSettings"
  | "canManageProfile"
  | "canManageGuestbook"
  | "canManageCustomization"
  | "canManageEmoticons";

export type PostChannelsChannelIdManagersRequestBody = Pick<
  Manager,
  | "userId"
  | "canManageContent"
  | "canManageSettings"
  | "canManageProfile"
  | "canManageGuestbook"
  | "canManageCustomization"
  | "canManageEmoticons"
>;

export type PostChannelsChannelIdManagersResponse = Manager;

export type PatchChannelsChannelIdManagersManagerIdRequestBody = Partial<
  Pick<
    Manager,
    | "canManageContent"
    | "canManageSettings"
    | "canManageProfile"
    | "canManageGuestbook"
    | "canManageCustomization"
    | "canManageEmoticons"
    | "isActive"
  >
>;
