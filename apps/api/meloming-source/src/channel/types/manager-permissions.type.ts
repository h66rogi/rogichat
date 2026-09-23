/**
 * 채널 매니저 권한 타입
 * getManagerPermissions()의 반환 타입
 */
export type ChannelManagerPermissions = {
  isActive: boolean | null;
  canManageContent: boolean | null;
  canManageSettings: boolean | null;
  canManageProfile: boolean | null;
  canManageGuestbook: boolean | null;
  canManageCustomization: boolean | null;
  canManageEmoticons: boolean | null;
  canManageHuyeorChat: boolean | null;
} | null;
