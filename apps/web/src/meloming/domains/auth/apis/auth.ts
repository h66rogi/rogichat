import { apiClient, apiV2Client } from "@/meloming/shared/lib/api-client";
import type {
  PostAuthForgotPasswordRequestBody,
  PostAuthLoginRequestBody,
  PostAuthLoginResponse,
  PostAuthResendCodeRequest,
  PostAuthResetPasswordRequest,
  PostAuthSignupRequestBody,
  PostAuthVerifyCodeRequest,
  PutAuthWithdrawalRequestBody,
  GetAuthEmailExistsResponse,
  PostV2AuthSignupEmailInitRequestBody,
  PostV2AuthSignupEmailInitResponse,
  PostV2AuthSignupEmailResendRequestBody,
  PostV2AuthSignupEmailResendResponse,
  PostV2AuthSignupEmailVerifyRequestBody,
  PostV2AuthSignupEmailVerifyResponse,
  PostV2AuthSignupCompleteRequestBody,
  GetV1AuthOauthGoogleResponse,
  GetV1AuthOauthGoogleCallbackQuery,
  GetV1AuthOauthGoogleCallbackResponse,
  PostV1AuthOauthGoogleOnetapRequestBody,
  PostV1AuthOauthGoogleOnetapResponse,
  PostAuthPhoneSendCodeRequestBody,
  PostAuthPhoneSendCodeResponse,
  PostAuthPhoneVerifyRequestBody,
  PostAuthPhoneVerifyResponse,
  PostAuthOauthAppleTokenRequestBody,
  PostAuthOauthAppleTokenResponse,
  GetAuthWithdrawalEligibilityResponse,
  GetAuthSecuritySummaryResponse,
  ProRefundPreview,
  ProRefundResult,
  ProRelinquishResult,
  PartnerSettlementWaiverPreview,
  PartnerSettlementWaiverResult,
} from "@/meloming/domains/auth/types/auth";

/**
 * POST /auth/login
 */
export async function postAuthLogin(
  body: PostAuthLoginRequestBody
): Promise<PostAuthLoginResponse> {
  const { turnstileToken } = body;
  const response = await apiClient.post<PostAuthLoginResponse>(
    "/auth/login",
    body,
    {
      withCredentials: true,
      headers: turnstileToken
        ? { "cf-turnstile-response": turnstileToken }
        : undefined,
    }
  );

  return response.data;
}

/**
 * POST /auth/login?bypass=true
 * - Turnstile 우회 전용 로그인 (가입 직후 자동 로그인 등)
 */
export async function postAuthLoginBypass(
  body: PostAuthLoginRequestBody
): Promise<PostAuthLoginResponse> {
  const response = await apiClient.post<PostAuthLoginResponse>(
    "/auth/login",
    body,
    {
      withCredentials: true,
      params: { bypass: "true" },
    }
  );
  return response.data;
}

/**
 * POST /auth/refresh
 */
export async function postAuthRefresh(): Promise<{ accessToken: string }> {
  const response = await apiClient.post<{ accessToken: string }>(
    "/auth/refresh",
    {},
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /auth/signup
 */
export async function postAuthSignup(
  body: PostAuthSignupRequestBody
): Promise<void> {
  await apiClient.post("/auth/signup", body, { withCredentials: true });
}

/**
 * POST /auth/verify-code
 */
export async function postAuthVerifyCode(
  body: PostAuthVerifyCodeRequest
): Promise<void> {
  await apiClient.post("/auth/verify-code", body, { withCredentials: true });
}

/**
 * POST /auth/forgot-password
 */
export async function postAuthForgotPassword(
  body: PostAuthForgotPasswordRequestBody
): Promise<void> {
  await apiClient.post("/auth/forgot-password", body, {
    withCredentials: true,
  });
}

/**
 * POST /auth/reset-password
 */
export async function postAuthResetPassword(
  body: PostAuthResetPasswordRequest
): Promise<void> {
  await apiClient.post("/auth/reset-password", body, { withCredentials: true });
}

/**
 * POST /auth/resend-code
 */
export async function postAuthResendCode(
  body: PostAuthResendCodeRequest
): Promise<void> {
  await apiClient.post("/auth/resend-code", body, { withCredentials: true });
}

/**
 * POST /auth/logout
 */
export async function postAuthLogout(): Promise<{ message: string }> {
  const response = await apiClient.post<{ message: string }>(
    "/auth/logout",
    {},
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * GET /auth/withdrawal-eligibility
 */
export async function getAuthWithdrawalEligibility(): Promise<GetAuthWithdrawalEligibilityResponse> {
  const response = await apiClient.get<GetAuthWithdrawalEligibilityResponse>(
    "/auth/withdrawal-eligibility",
    {
      withCredentials: true,
    },
  );
  return response.data;
}

/**
 * GET /auth/security
 */
export async function getAuthSecuritySummary(): Promise<GetAuthSecuritySummaryResponse> {
  const response = await apiClient.get<GetAuthSecuritySummaryResponse>(
    "/auth/security",
    {
      withCredentials: true,
    },
  );
  return response.data;
}

/**
 * PUT /auth/withdrawal
 */
export async function putAuthWithdrawal(
  body: PutAuthWithdrawalRequestBody
): Promise<void> {
  const response = await apiClient.put("/auth/withdrawal", body, {
    withCredentials: true,
  });

  return response.data;
}

export async function getProRefundPreview(): Promise<ProRefundPreview> {
  const response = await apiClient.get<ProRefundPreview>(
    "/payments/subscriptions/current/refund",
    { withCredentials: true },
  );
  return response.data;
}

export async function postProRefund(
  termId: number,
  expectedRefundAmount: number,
): Promise<ProRefundResult> {
  const response = await apiClient.post<ProRefundResult>(
    "/payments/subscriptions/current/refund",
    { termId, expectedRefundAmount },
    {
      withCredentials: true,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    },
  );
  return response.data;
}

export async function postProRelinquish(
  termId: number,
): Promise<ProRelinquishResult> {
  const response = await apiClient.post<ProRelinquishResult>(
    "/payments/subscriptions/current/relinquish",
    { termId },
    {
      withCredentials: true,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    },
  );
  return response.data;
}

export async function getPartnerSettlementWaiverPreview(
): Promise<PartnerSettlementWaiverPreview> {
  const response = await apiClient.get<PartnerSettlementWaiverPreview>(
    "/auth/withdrawal/partner-settlement-waiver-preview",
    { withCredentials: true },
  );
  return response.data;
}

export async function postPartnerSettlementWaiver(
  preview: Pick<
    PartnerSettlementWaiverPreview,
    "waivableAmount" | "waivableTransactionCount" | "confirmationText"
  >,
): Promise<PartnerSettlementWaiverResult> {
  const response = await apiClient.post<PartnerSettlementWaiverResult>(
    "/auth/withdrawal/partner-settlement-waiver",
    {
      expectedAmount: preview.waivableAmount,
      expectedTransactionCount: preview.waivableTransactionCount,
      confirmationText: preview.confirmationText,
    },
    {
      withCredentials: true,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    },
  );
  return response.data;
}

/**
 * GET /auth/email-exists?email=...
 */
export async function getAuthEmailExists(
  email: string
): Promise<GetAuthEmailExistsResponse> {
  const response = await apiClient.get<GetAuthEmailExistsResponse>(
    "/auth/email-exists",
    { params: { email }, withCredentials: true }
  );
  return response.data;
}

/**
 * GET /v1/auth/oauth/google
 */
export async function getV1AuthOauthGoogle(): Promise<GetV1AuthOauthGoogleResponse> {
  const response = await apiClient.get<GetV1AuthOauthGoogleResponse>(
    "/auth/oauth/google",
    { withCredentials: true }
  );
  return response.data;
}

/**
 * GET /v1/auth/oauth/google/callback
 */
export async function getV1AuthOauthGoogleCallback(
  params: GetV1AuthOauthGoogleCallbackQuery
): Promise<GetV1AuthOauthGoogleCallbackResponse> {
  const response = await apiClient.get<GetV1AuthOauthGoogleCallbackResponse>(
    "/auth/oauth/google/callback",
    { params, withCredentials: true }
  );
  return response.data;
}

/**
 * POST /v1/auth/oauth/google/onetap
 * - Google Identity Services (One Tap) 의 ID Token 을 직접 검증해서 자체 JWT 발급
 * - 쿠키(accessToken/refreshToken) 자동 set
 */
export async function postV1AuthOauthGoogleOnetap(
  body: PostV1AuthOauthGoogleOnetapRequestBody
): Promise<PostV1AuthOauthGoogleOnetapResponse> {
  const response = await apiClient.post<PostV1AuthOauthGoogleOnetapResponse>(
    "/auth/oauth/google/onetap",
    body,
    { withCredentials: true }
  );
  return response.data;
}

/** v2 signup email init */
export async function postV2AuthSignupEmailInit(
  body: PostV2AuthSignupEmailInitRequestBody
): Promise<PostV2AuthSignupEmailInitResponse> {
  const response = await apiV2Client.post<PostV2AuthSignupEmailInitResponse>(
    "/auth/signup/email/init",
    body,
    { withCredentials: true }
  );
  return response.data;
}

/** v2 signup email resend */
export async function postV2AuthSignupEmailResend(
  body: PostV2AuthSignupEmailResendRequestBody
): Promise<PostV2AuthSignupEmailResendResponse> {
  const response = await apiV2Client.post<PostV2AuthSignupEmailResendResponse>(
    "/auth/signup/email/resend",
    body,
    { withCredentials: true }
  );
  return response.data;
}

/** v2 signup email verify */
export async function postV2AuthSignupEmailVerify(
  body: PostV2AuthSignupEmailVerifyRequestBody
): Promise<PostV2AuthSignupEmailVerifyResponse> {
  const response = await apiV2Client.post<PostV2AuthSignupEmailVerifyResponse>(
    "/auth/signup/email/verify",
    body,
    { withCredentials: true }
  );
  return response.data;
}

/** v2 signup complete */
export async function postV2AuthSignupComplete(
  body: PostV2AuthSignupCompleteRequestBody
): Promise<void> {
  await apiV2Client.post("/auth/signup/complete", body, {
    withCredentials: true,
  });
}

/**
 * POST /auth/phone/send-code
 */
export async function postAuthPhoneSendCode(
  body: PostAuthPhoneSendCodeRequestBody
): Promise<PostAuthPhoneSendCodeResponse> {
  const response = await apiClient.post<PostAuthPhoneSendCodeResponse>(
    "/auth/phone/send-code",
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /auth/phone/verify
 */
export async function postAuthPhoneVerify(
  body: PostAuthPhoneVerifyRequestBody
): Promise<PostAuthPhoneVerifyResponse> {
  const response = await apiClient.post<PostAuthPhoneVerifyResponse>(
    "/auth/phone/verify",
    body,
    { withCredentials: true }
  );
  return response.data;
}

/**
 * POST /auth/oauth/apple/token
 * Apple Sign In 토큰 검증 및 로그인/회원가입 처리
 */
export async function postAuthOauthAppleToken(
  body: PostAuthOauthAppleTokenRequestBody
): Promise<PostAuthOauthAppleTokenResponse> {
  const response = await apiClient.post<PostAuthOauthAppleTokenResponse>(
    "/auth/oauth/apple/token",
    body,
    { withCredentials: true }
  );
  return response.data;
}
