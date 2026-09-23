/**
 * Dto
 */

export interface PostAuthLoginRequestBody {
  email: string;
  password: string;
  /**
   * Cloudflare Turnstile token returned from the widget
   * - Sent via request header `cf-turnstile-response`
   * - Also included in request body for compatibility with backends reading body
   */
  turnstileToken?: string;
}

export type MfaFactor = "TOTP" | "SMS" | "EMAIL" | "PASSKEY" | "RECOVERY_CODE";

export type PostAuthLoginResponse =
  | { accessToken: string; mfaRequired?: false }
  | { mfaRequired: true; factors: MfaFactor[]; expiresInMs: number };

export interface PostAuthSignupRequestBody {
  email: string;
  password: string;
  passwordConfirm: string;
  nickname: string;
  profileImageUrl?: string | null;
  referralCode?: string | null;
}

export interface PostAuthForgotPasswordRequestBody {
  email: string;
}

export interface PostAuthResetPasswordRequest {
  token: string;
  newPassword: string;
  newPasswordConfirm: string;
}

export interface PostAuthVerifyCodeRequest {
  email: string;
  token: string;
}

export interface PostAuthResendCodeRequest {
  email: string;
  token: string;
}

export interface PostAuthSendVerificationEmailRequest {
  password: string;
  reason: string;
}

export interface PutAuthWithdrawalRequestBody {
  reason: string;
  confirmation: "탈퇴";
}

// Known reason codes surfaced by backend cross-service withdrawal validation.
// Backend may introduce more codes over time; consumers should handle unknown codes via fallback.
export type WithdrawalBlockReasonCode =
  | "PRO_SUBSCRIPTION"
  | "COMMISSION_ARTIST"
  | "PARTNER_SETTLEMENT"
  | "UNAVAILABLE";

export interface WithdrawalBlockReason {
  code: WithdrawalBlockReasonCode | string;
  message: string;
  details?: Record<string, unknown>;
}

export interface GetAuthWithdrawalEligibilityResponse {
  eligible: boolean;
  reasons: WithdrawalBlockReason[];
}

export interface GetAuthSecuritySummaryResponse {
  mfaEnabled: boolean;
}

export interface ProRefundPreview {
  termId: number;
  endAt: string;
  canRefund: boolean;
  canRelinquish: boolean;
  resolutionType: "REFUND" | "RELINQUISH" | "NONE";
  estimatedRefundAmount: number;
  totalPaymentAmount: number;
  remainingDays: number;
  cancelType: "NONE" | "FULL" | "PARTIAL";
  reason: string | null;
}

export interface ProRefundResult {
  success: boolean;
  message: string;
  refund: {
    requested: boolean;
    executed: boolean;
    cancelType: "NONE" | "FULL" | "PARTIAL";
    amount: number;
    code?: string;
    message?: string;
  };
}

export interface ProRelinquishResult {
  success: boolean;
  message: string;
  termId: number;
  terminatedAt: string;
  relinquished: true;
}

export interface PartnerSettlementWaiverPreview {
  hasPendingSettlement: boolean;
  alreadyWaived: boolean;
  canWaive: boolean;
  waivableAmount: number;
  waivableTransactionCount: number;
  inFlightPayoutAmount: number;
  inFlightPayoutCount: number;
  confirmationText: string | null;
  blockReason:
    | "PAYOUT_IN_PROGRESS"
    | "NO_WAIVABLE_SETTLEMENT"
    | "NON_POSITIVE_BALANCE"
    | null;
}

export interface PartnerSettlementWaiverResult {
  waiverId: string;
  waivedAmount: number;
  waivedTransactionCount: number;
  waivedAt: string;
  alreadyProcessed: boolean;
}

// Email existence
export interface GetAuthEmailExistsResponse {
  exists: boolean;
  pending: boolean;
}

// v2 signup email flow
export interface PostV2AuthSignupEmailInitRequestBody {
  email: string;
}

export interface PostV2AuthSignupEmailInitResponse {
  sessionId: string;
  expiresInMs: number;
}

export interface PostV2AuthSignupEmailResendRequestBody {
  sessionId: string;
}

export interface PostV2AuthSignupEmailResendResponse {
  message: string;
}

export interface PostV2AuthSignupEmailVerifyRequestBody {
  sessionId: string;
  code: string;
}

export interface PostV2AuthSignupEmailVerifyResponse {
  signupToken: string;
}

export interface PostV2AuthSignupCompleteRequestBody {
  signupToken: string;
  nickname: string;
  password: string;
  passwordConfirm: string;
  referralCode?: string | null;
  profileImageUrl?: string | null;
  marketingConsent?: boolean;
}

// OAuth (Google)
export interface GetV1AuthOauthGoogleResponse {
  // Some backends may redirect immediately; if not, return URL
  url?: string;
}

export interface GetV1AuthOauthGoogleCallbackQuery {
  code: string;
  state: string;
}

export interface GetV1AuthOauthGoogleCallbackResponse {
  // Backend may set cookies and respond with a message; keeping generic
  message?: string;
}

// OAuth (Google One Tap / Identity Services)
export interface PostV1AuthOauthGoogleOnetapRequestBody {
  /** GIS callback 으로 받은 ID Token (JWT) */
  credential: string;
  /** 클라이언트 raw nonce. 백엔드가 SHA256 으로 검증 */
  nonce: string;
}

export type PostV1AuthOauthGoogleOnetapResponse =
  | {
      accessToken: string;
      refreshToken: string;
      isNewUser: boolean;
      requiresSocialComplete?: boolean;
      mfaRequired?: false;
    }
  | {
      mfaRequired: true;
      factors: MfaFactor[];
      expiresInMs: number;
      isNewUser: boolean;
      requiresSocialComplete?: boolean;
    };

// Phone verification
export interface PostAuthPhoneSendCodeRequestBody {
  phone: string;
}

export interface PostAuthPhoneSendCodeResponse {
  success: boolean;
}

export interface PostAuthPhoneVerifyRequestBody {
  phone: string;
  code: string;
}

export interface PostAuthPhoneVerifyResponse {
  success: boolean;
}

// OAuth (Apple)
export interface PostAuthOauthAppleTokenRequestBody {
  /** Apple Identity Token (JWT) */
  identityToken: string;
  /** 사용자 정보 (첫 로그인 시에만 제공) */
  user?: {
    email?: string;
    name?: {
      firstName?: string;
      lastName?: string;
    };
  };
}

export type PostAuthOauthAppleTokenResponse =
  | { accessToken: string; mfaRequired?: false }
  | { mfaRequired: true; factors: MfaFactor[]; expiresInMs: number };
