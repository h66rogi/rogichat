"use client";

import { useState } from "react";
import { Share2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/meloming/shared/components/ui/alert";
import { ManagementHeader } from "@/meloming/domains/channel/components/management/management-header";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import {
  useSnsCredentials,
  useStartOauth,
  useDisconnectSns,
} from "@/meloming/domains/sns-credentials/hooks";
import {
  SNS_PLATFORMS,
  type SnsPlatform,
} from "@/meloming/domains/sns-credentials/types/sns-platform";
import type { SnsCredentialResponse } from "@/meloming/domains/sns-credentials/types/sns-credential";
import { SnsPlatformCard } from "./sns-platform-card";
import { SnsCallbackToaster } from "./sns-callback-toaster";

/**
 * 채널 webPath 기반 callback target. 백엔드가 redirect 하는 경로와 1:1 일치한다.
 * (백엔드 SnsCredentialsController.buildRedirect → /channel/me/manage/sns-settings)
 *
 * `me` 는 로그인 사용자 본인 채널을 의미하는 alias.
 */
const SNS_CALLBACK_BASE_PATH = "/channel/me/manage/sns-settings";

/**
 * platform 별로 응답을 정확히 1건씩 보장 (백엔드는 모든 플랫폼에 대해 record 또는 미연동 dto 반환).
 * 만약 응답 누락이 있어도 미연동 placeholder 로 채워서 일관된 UI 노출.
 */
function ensureAllPlatforms(
  data: SnsCredentialResponse[] | undefined,
): SnsCredentialResponse[] {
  const byPlatform = new Map<SnsPlatform, SnsCredentialResponse>();
  if (data) {
    for (const entry of data) {
      byPlatform.set(entry.platform, entry);
    }
  }
  return SNS_PLATFORMS.map((platform): SnsCredentialResponse => {
    const existing = byPlatform.get(platform);
    if (existing) return existing;
    return {
      platform,
      isConnected: false,
      isActive: false,
      handle: null,
      externalUserId: null,
      connectedAt: null,
      expiresAt: null,
    };
  });
}

export function SnsSettingsContent() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const isAuthenticated = !!user?.id && !isAuthLoading;
  const [pendingPlatform, setPendingPlatform] = useState<SnsPlatform | null>(
    null,
  );
  const [disconnectingPlatform, setDisconnectingPlatform] =
    useState<SnsPlatform | null>(null);

  const { data, isLoading, error } = useSnsCredentials({
    enabled: isAuthenticated,
  });

  const startOauth = useStartOauth({
    onError: () => setPendingPlatform(null),
  });
  const disconnect = useDisconnectSns({
    onSuccess: () => setDisconnectingPlatform(null),
    onError: () => setDisconnectingPlatform(null),
  });

  // 미로그인 상태 안내
  if (!isAuthLoading && !isAuthenticated) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="SNS 연동"
          description="X(트위터)와 네이버 카페 계정을 연결하면 시간표 이미지를 자동으로 게시할 수 있습니다."
          icon={Share2}
        />
        <Alert>
          <AlertCircle className="size-4" />
          <AlertTitle>로그인이 필요합니다</AlertTitle>
          <AlertDescription>
            SNS 연동을 관리하려면 먼저 로그인해 주세요.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="SNS 연동"
          description="X(트위터)와 네이버 카페 계정을 연결하면 시간표 이미지를 자동으로 게시할 수 있습니다."
          icon={Share2}
        />
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>연동 상태를 불러오지 못했어요</AlertTitle>
          <AlertDescription>
            잠시 후 다시 시도해 주세요. 문제가 계속되면 고객센터에 문의해
            주세요.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const credentials = ensureAllPlatforms(data);
  const showSkeleton = isLoading && !data;

  const handleConnect = (platform: SnsPlatform) => {
    setPendingPlatform(platform);
    startOauth.mutate(platform);
  };

  const handleDisconnect = (platform: SnsPlatform) => {
    setDisconnectingPlatform(platform);
    disconnect.mutate(platform);
  };

  return (
    <div className="p-6">
      <ManagementHeader
        title="SNS 연동"
        description="X(트위터)와 네이버 카페 계정을 연결하면 시간표 이미지를 자동으로 게시할 수 있습니다."
        icon={Share2}
      />

      <SnsCallbackToaster basePath={SNS_CALLBACK_BASE_PATH} />

      {showSkeleton ? (
        <div className="py-12 text-center text-muted-foreground">
          연동 상태를 불러오는 중…
        </div>
      ) : (
        <div className="space-y-3">
          {credentials.map((credential) => (
            <SnsPlatformCard
              key={credential.platform}
              credential={credential}
              isConnecting={
                startOauth.isPending && pendingPlatform === credential.platform
              }
              isDisconnecting={
                disconnect.isPending &&
                disconnectingPlatform === credential.platform
              }
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
