export type IdentityMethod = "SMS" | "APP" | "DIDIT";

export interface GetUserMeResponse {
  id: number;
  email: string;
  nickname: string;
  profileImageUrl: string | null;
  phone?: string | null;
  isAdmin: boolean;
  isAmbassador: boolean;
  isEmailVerified: boolean;
  isIdentityVerified: boolean;
  identityMethod: IdentityMethod | null;
  isApproved: boolean;
  isMarketingAllowableCheckNeeded: boolean;
  marketingConsent?: boolean;
  isProSubscriber: boolean;
  proSubscriptionEndAt: string | null;
  acceptGifts?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PatchUserMeRequestBody {
  nickname?: string;
  profileImageUrl?: string | null;
  marketingConsent?: boolean;
  acceptGifts?: boolean;
}

export interface PatchUserMeResponse {
  id: number;
  email: string;
  nickname: string;
  profileImageUrl: string | null;
  phone?: string | null;
  isAdmin: boolean;
  isAmbassador: boolean;
  isEmailVerified: boolean;
  isApproved: boolean;
  isMarketingAllowableCheckNeeded: boolean;
  marketingConsent?: boolean;
  acceptGifts?: boolean;
}

export interface PatchUserChangePasswordRequestBody {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
}

export interface PatchUserChangePasswordResponse {
  message: string;
}

export interface PostIdentityVerificationRequestBody {
  identityVerificationId: string;
}

export interface PostIdentityVerificationResponse {
  success: boolean;
  message?: string;
}

/**
 * POST /identity/didit/session 요청.
 * meloming-front 는 i18n 미사용이라 language='ko' 고정.
 * origin='meloming' 고정 — 백엔드가 콜백 URL 화이트리스트에서 lookup.
 */
export interface PostDiditSessionRequestBody {
  language?: "ko" | "en" | "ja" | "zh-CN" | "zh-TW";
  origin?: "meloming" | "commission";
}

export interface PostDiditSessionResponse {
  sessionId: string;
  url: string;
}

export interface PhoneSendRequestBody { phoneNumber: string; }
export interface PhoneCheckRequestBody { phoneNumber: string; code: string; }
export interface PhoneVerifyResponse { success: boolean; }
