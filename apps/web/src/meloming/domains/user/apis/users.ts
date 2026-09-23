import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  GetUserMeResponse,
  PatchUserMeRequestBody,
  PatchUserChangePasswordRequestBody,
  PatchUserMeResponse,
  PatchUserChangePasswordResponse,
  PostIdentityVerificationRequestBody,
  PostIdentityVerificationResponse,
  PostDiditSessionRequestBody,
  PostDiditSessionResponse,
  PhoneSendRequestBody,
  PhoneCheckRequestBody,
  PhoneVerifyResponse,
} from "@/meloming/domains/user/types/user";

/**
 * GET /user/me
 */
export async function getUserMe(): Promise<GetUserMeResponse> {
  const response = await apiClient.get<GetUserMeResponse>("/user/me", {
    withCredentials: true,
  });
  return response.data;
}

/**
 * PATCH /user/me
 */
export async function patchUserMe(
  data: PatchUserMeRequestBody
): Promise<PatchUserMeResponse> {
  const response = await apiClient.patch<PatchUserMeResponse>(
    "/user/me",
    data,
    { withCredentials: true }
  );

  return response.data;
}

/**
 * PATCH /user/change-password
 */
export async function patchUserChangePassword(
  data: PatchUserChangePasswordRequestBody
): Promise<PatchUserChangePasswordResponse> {
  const response = await apiClient.patch<PatchUserChangePasswordResponse>(
    "/user/change-password",
    data,
    {
      withCredentials: true,
    }
  );

  return response.data;
}

/**
 * POST /identity
 * 본인인증 완료 후 서버에 인증 ID 전송
 */
export async function postIdentityVerification(
  data: PostIdentityVerificationRequestBody
): Promise<PostIdentityVerificationResponse> {
  const response = await apiClient.post<PostIdentityVerificationResponse>(
    "/identity",
    data,
    {
      withCredentials: true,
    }
  );

  return response.data;
}

/**
 * POST /identity/didit/session
 * 해외(Didit) 본인인증 세션 생성. 응답 url 로 redirect.
 * apiClient 가 default 로 withCredentials: true 적용하므로 옵션 명시 불요.
 */
export async function postDiditSession(
  data?: PostDiditSessionRequestBody
): Promise<PostDiditSessionResponse> {
  const response = await apiClient.post<PostDiditSessionResponse>(
    "/identity/didit/session",
    data ?? {}
  );
  return response.data;
}

/**
 * POST /identity/phone/send
 * 전화번호 인증 OTP 발송
 */
export async function postIdentityPhoneSend(data: PhoneSendRequestBody): Promise<PhoneVerifyResponse> {
  const response = await apiClient.post<PhoneVerifyResponse>('/identity/phone/send', data);
  return response.data;
}

/**
 * POST /identity/phone/check
 * 전화번호 인증 OTP 확인
 */
export async function postIdentityPhoneCheck(data: PhoneCheckRequestBody): Promise<PhoneVerifyResponse> {
  const response = await apiClient.post<PhoneVerifyResponse>('/identity/phone/check', data);
  return response.data;
}
