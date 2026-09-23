"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getUserMe } from "@/meloming/domains/user/apis/users";
import type { GetUserMeResponse } from "@/meloming/domains/user/types/user";
import type {
  PostAuthLoginRequestBody as LoginData,
  PostAuthSignupRequestBody as RegisterData,
  PutAuthWithdrawalRequestBody as WithdrawalData,
} from "@/meloming/domains/auth/types/auth";
import {
  postAuthLogin,
  postAuthLoginBypass,
  postAuthLogout,
  postAuthSignup,
  putAuthWithdrawal,
  getAuthWithdrawalEligibility,
} from "../apis/auth";
import { isAxiosError } from "@/meloming/shared/lib/axios-error";
import { buildIdAuthRedirectUrl } from "@/meloming/shared/lib/id-auth-redirect";
import {
  getV1AuthOauthGoogle,
  getV1AuthOauthGoogleCallback,
  postV2AuthSignupEmailInit,
  postV2AuthSignupEmailResend,
  postV2AuthSignupEmailVerify,
  postV2AuthSignupComplete,
  postAuthPhoneSendCode,
  postAuthPhoneVerify,
} from "../apis/auth";
import type {
  PostV2AuthSignupEmailInitRequestBody,
  PostV2AuthSignupEmailInitResponse,
  PostV2AuthSignupEmailResendRequestBody,
  PostV2AuthSignupEmailResendResponse,
  PostV2AuthSignupEmailVerifyRequestBody,
  PostV2AuthSignupEmailVerifyResponse,
  PostV2AuthSignupCompleteRequestBody,
  GetV1AuthOauthGoogleCallbackQuery,
  GetV1AuthOauthGoogleCallbackResponse,
  GetV1AuthOauthGoogleResponse,
  PostAuthPhoneSendCodeRequestBody,
  PostAuthPhoneSendCodeResponse,
  PostAuthPhoneVerifyRequestBody,
  PostAuthPhoneVerifyResponse,
} from "@/meloming/domains/auth/types/auth";

// Query keys
export const authKeys = {
  all: ["auth"] as const,
  me: () => [...authKeys.all, "me"] as const,
};

/**
 * 인증 관련 상태와 액션을 관리하는 훅
 * @param enabled - 현재 사용자 정보 조회 활성화 여부 (기본값: true)
 */
export function useAuth(enabled = true) {
  const queryClient = useQueryClient();

  // 퍼미션 관련 쿼리키 식별 유틸: 마지막 토큰이 'permission'인 경우
  function isPermissionKey(key: readonly unknown[]): boolean {
    if (key.length < 1) return false;
    const last = key[key.length - 1];
    return typeof last === "string" && last === "permission";
  }

  async function invalidatePermissions() {
    await queryClient.invalidateQueries({
      predicate: (query) => isPermissionKey(query.queryKey),
    });
  }

  // 현재 사용자 정보 조회
  // refresh는 axios interceptor(api-client.ts)가 단일 owner로 처리한다.
  // 여기서는 interceptor의 refresh+retry까지 모두 실패한 401만 게스트(null)로 해석한다.
  const {
    data: user,
    isLoading,
    refetch,
  } = useQuery<GetUserMeResponse | null>({
    queryKey: authKeys.me(),
    queryFn: async () => {
      try {
        return await getUserMe();
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 401) {
          return null;
        }
        throw error;
      }
    },
    // 비로그인 상태에서 불필요한 재호출을 줄이기 위한 옵션
    retry: false,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // 로그인 뮤테이션
  const loginMutation = useMutation({
    mutationFn: async (data: LoginData) => {
      const response = await postAuthLogin(data);
      return response;
    },
    onSuccess: async (response) => {
      if ("mfaRequired" in response && response.mfaRequired) {
        const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(
          buildIdAuthRedirectUrl("/auth/mfa", {
            from: currentPath,
            service: "meloming",
          })
        );
        return;
      }
      // 로그인 성공 시 사용자 정보 다시 가져오기
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
      await invalidatePermissions();
      await refetch();
    },
  });

  // 로그인(bypass) 뮤테이션 - Turnstile 없이 허용되는 케이스 전용
  const loginBypassMutation = useMutation({
    mutationFn: async (data: LoginData) => {
      const response = await postAuthLoginBypass(data);
      return response;
    },
    onSuccess: async (response) => {
      if ("mfaRequired" in response && response.mfaRequired) {
        const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(
          buildIdAuthRedirectUrl("/auth/mfa", {
            from: currentPath,
            service: "meloming",
          })
        );
        return;
      }
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
      await invalidatePermissions();
      await refetch();
    },
  });

  // 회원가입 뮤테이션
  const registerMutation = useMutation({
    mutationFn: async (data: RegisterData) => {
      const response = await postAuthSignup(data);
      return response;
    },
    onSuccess: async () => {
      // 회원가입 직후 권한 및 사용자 정보 재조회
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
      await invalidatePermissions();
      await refetch();
    },
  });

  // 로그아웃 뮤테이션
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await postAuthLogout();
      return response;
    },
    onSuccess: async () => {
      // 로그아웃 성공 시 사용자 정보 삭제 및 캐시 정리
      queryClient.setQueryData(authKeys.me(), null);
      await invalidatePermissions();
      queryClient.clear();
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    },
  });

  // v1 OAuth Google start (fetch URL if not direct redirect)
  const oauthGoogleStart = useMutation({
    mutationFn: async (): Promise<GetV1AuthOauthGoogleResponse> => {
      return await getV1AuthOauthGoogle();
    },
  });

  // v1 OAuth Google callback
  const oauthGoogleCallback = useMutation({
    mutationFn: async (
      params: GetV1AuthOauthGoogleCallbackQuery
    ): Promise<GetV1AuthOauthGoogleCallbackResponse> => {
      return await getV1AuthOauthGoogleCallback(params);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
      await invalidatePermissions();
      await refetch();
    },
  });

  // v2 signup email init
  const v2SignupEmailInit = useMutation({
    mutationFn: async (
      body: PostV2AuthSignupEmailInitRequestBody
    ): Promise<PostV2AuthSignupEmailInitResponse> => {
      return await postV2AuthSignupEmailInit(body);
    },
  });

  // v2 signup email resend
  const v2SignupEmailResend = useMutation({
    mutationFn: async (
      body: PostV2AuthSignupEmailResendRequestBody
    ): Promise<PostV2AuthSignupEmailResendResponse> => {
      return await postV2AuthSignupEmailResend(body);
    },
  });

  // v2 signup email verify
  const v2SignupEmailVerify = useMutation({
    mutationFn: async (
      body: PostV2AuthSignupEmailVerifyRequestBody
    ): Promise<PostV2AuthSignupEmailVerifyResponse> => {
      return await postV2AuthSignupEmailVerify(body);
    },
  });

  // v2 signup complete
  const v2SignupComplete = useMutation({
    mutationFn: async (
      body: PostV2AuthSignupCompleteRequestBody
    ): Promise<void> => {
      return await postV2AuthSignupComplete(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
      await invalidatePermissions();
      await refetch();
    },
  });

  // 회원탈퇴(계정 비활성화) 뮤테이션
  const withdrawalMutation = useMutation({
    mutationFn: async (data: WithdrawalData) => {
      await putAuthWithdrawal(data);
    },
    onSuccess: async () => {
      // 탈퇴 성공 시 사용자 정보 삭제 및 캐시 정리
      queryClient.setQueryData(authKeys.me(), null);
      await invalidatePermissions();
      queryClient.clear();
    },
  });

  // 전화번호 인증 코드 발송 뮤테이션
  const phoneSendCodeMutation = useMutation({
    mutationFn: async (
      body: PostAuthPhoneSendCodeRequestBody
    ): Promise<PostAuthPhoneSendCodeResponse> => {
      return await postAuthPhoneSendCode(body);
    },
  });

  // 전화번호 인증 코드 검증 뮤테이션
  const phoneVerifyMutation = useMutation({
    mutationFn: async (
      body: PostAuthPhoneVerifyRequestBody
    ): Promise<PostAuthPhoneVerifyResponse> => {
      return await postAuthPhoneVerify(body);
    },
    onSuccess: async () => {
      // 인증 성공 시 사용자 정보 다시 가져오기 (phone 필드 업데이트)
      await queryClient.invalidateQueries({ queryKey: authKeys.me() });
      await refetch();
    },
  });

  return {
    // 사용자 상태
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.isAdmin || false,
    isAmbassador: user?.isAmbassador || false,
    isProSubscriber: user?.isProSubscriber || false,
    proSubscriptionEndAt: user?.proSubscriptionEndAt || null,

    // 액션 함수들
    login: loginMutation.mutateAsync,
    loginBypass: loginBypassMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    withdrawal: withdrawalMutation.mutateAsync,
    oauthGoogleStart: oauthGoogleStart.mutateAsync,
    oauthGoogleCallback: oauthGoogleCallback.mutateAsync,
    v2SignupEmailInit: v2SignupEmailInit.mutateAsync,
    v2SignupEmailResend: v2SignupEmailResend.mutateAsync,
    v2SignupEmailVerify: v2SignupEmailVerify.mutateAsync,
    v2SignupComplete: v2SignupComplete.mutateAsync,
    phoneSendCode: phoneSendCodeMutation.mutateAsync,
    phoneVerify: phoneVerifyMutation.mutateAsync,

    // 로딩 상태들
    isLoginPending: loginMutation.isPending,
    isRegisterPending: registerMutation.isPending,
    isLogoutPending: logoutMutation.isPending,
    isWithdrawalPending: withdrawalMutation.isPending,
    isOauthGoogleStartPending: oauthGoogleStart.isPending,
    isOauthGoogleCallbackPending: oauthGoogleCallback.isPending,
    isV2SignupEmailInitPending: v2SignupEmailInit.isPending,
    isV2SignupEmailResendPending: v2SignupEmailResend.isPending,
    isV2SignupEmailVerifyPending: v2SignupEmailVerify.isPending,
    isV2SignupCompletePending: v2SignupComplete.isPending,
    isPhoneSendCodePending: phoneSendCodeMutation.isPending,
    isPhoneVerifyPending: phoneVerifyMutation.isPending,
  };
}
