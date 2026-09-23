"use client";

import { useState } from "react";
import {
  BadgeCheck,
  ShieldCheck,
  ShieldX,
  Clock,
  RefreshCw,
  Info,
  AlertTriangle,
  Plus,
  Loader2,
  XCircle,
} from "lucide-react";
import { ManagementHeader } from "./management-header";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { useParams } from "next/navigation";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import {
  useChannelVerifications,
  useRevokeChannelVerification,
} from "@/meloming/domains/channel/hooks/use-channel-verification";
import { ChannelAuthDialog } from "./channel-auth-dialog";
import type { ChannelVerificationDto } from "@/meloming/domains/channel/types/channel-verification";
import type { StreamPlatform } from "@/meloming/domains/platform/types/platform";

const formatDate = (dateString: string | null) => {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const getPlatformLabel = (platform: string) => {
  switch (platform) {
    case "CHZZK":
      return "치지직";
    case "SOOP":
      return "숲";
    case "CIME":
      return "씨미";
    default:
      return "기타";
  }
};

const getPlatformBadgeVariant = (platform: string) => {
  switch (platform) {
    case "CHZZK":
      return "chzzk" as const;
    case "SOOP":
      return "soop" as const;
    case "CIME":
      return "cime" as const;
    default:
      return "secondary" as const;
  }
};

const resolveDisplayPlatform = (
  platform: string,
  platformUrl?: string | null
) => {
  if (
    platform === "OTHER" &&
    typeof platformUrl === "string" &&
    platformUrl.toLowerCase().includes("ci.me")
  ) {
    return "CIME";
  }
  return platform;
};

export function ChannelAuthManagement() {
  const params = useParams();
  const identifier = (params?.user as string) || "";
  const { data: channel, isLoading: isChannelLoading } = useChannel(identifier);
  const { data: verifications, isLoading: isVerificationLoading } =
    useChannelVerifications(identifier);
  const revokeVerification = useRevokeChannelVerification(identifier);
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(false);
  const [targetPlatform, setTargetPlatform] = useState<StreamPlatform | undefined>();
  const [revokingPlatform, setRevokingPlatform] = useState<StreamPlatform | null>(null);

  const isLoading = isChannelLoading || isVerificationLoading;

  // 활성 인증 목록 (백엔드에서 REVOKED 제외 처리됨)
  const activeVerifications = verifications ?? [];

  const handleOpenAuthDialog = (platform?: StreamPlatform) => {
    setTargetPlatform(platform);
    setIsAuthDialogOpen(true);
  };

  const handleCloseAuthDialog = (open: boolean) => {
    setIsAuthDialogOpen(open);
    if (!open) {
      setTargetPlatform(undefined);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="채널 인증"
          description="방송 플랫폼 계정과 채널을 연결하여 인증합니다."
          icon={BadgeCheck}
        />
        <div className="py-12 text-center text-muted-foreground">로딩 중...</div>
      </div>
    );
  }

  // 미인증 상태
  if (activeVerifications.length === 0) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="채널 인증"
          description="방송 플랫폼 계정과 채널을 연결하여 인증합니다."
          icon={BadgeCheck}
        />

        <Card>
          <CardContent className="py-6">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="size-14 rounded-full bg-muted flex items-center justify-center">
                <ShieldX className="size-7 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-2">
                  <h3 className="font-semibold">채널 인증 상태</h3>
                  <Badge variant="secondary">미인증</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  방송 플랫폼 계정과 연결하여 채널을 인증해주세요.
                </p>
              </div>
              <Button onClick={() => handleOpenAuthDialog()} size="lg">
                채널 인증하기
              </Button>
            </div>

            <div className="mt-6 pt-4 border-t flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" />
              <span>인증 완료 시 프로필에 인증 배지가 표시됩니다.</span>
            </div>
          </CardContent>
        </Card>

        <ChannelAuthDialog
          open={isAuthDialogOpen}
          onOpenChange={handleCloseAuthDialog}
          platformUrl={channel?.platformUrl || ""}
          existingVerifications={activeVerifications}
          targetPlatform={targetPlatform}
        />
      </div>
    );
  }

  // 인증이 하나 이상 존재하는 상태 - 카드 목록
  return (
    <div className="p-6">
      <ManagementHeader
        title="채널 인증"
        description="방송 플랫폼 계정과 채널을 연결하여 인증합니다."
        icon={BadgeCheck}
      />

      <div className="space-y-3">
        {activeVerifications.map((verification) => (
          <VerificationCard
            key={verification.id}
            verification={verification}
            displayPlatform={resolveDisplayPlatform(
              verification.platform,
              channel?.platformUrl
            )}
            onRevoke={() => {
              const platform = verification.platform as StreamPlatform;
              setRevokingPlatform(platform);
              revokeVerification.mutate(platform, {
                onSettled: () => setRevokingPlatform(null),
              });
            }}
            onChangeAuth={() =>
              handleOpenAuthDialog(verification.platform as StreamPlatform)
            }
            onRetryAuth={() => handleOpenAuthDialog()}
            isRevoking={revokeVerification.isPending && revokingPlatform === verification.platform}
          />
        ))}

        {/* 플랫폼 인증 추가 버튼 */}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => handleOpenAuthDialog()}
        >
          <Plus className="size-4 mr-1.5" />
          플랫폼 인증 추가
        </Button>
      </div>

      <ChannelAuthDialog
        open={isAuthDialogOpen}
        onOpenChange={handleCloseAuthDialog}
        platformUrl={channel?.platformUrl || ""}
        existingVerifications={activeVerifications}
        targetPlatform={targetPlatform}
      />
    </div>
  );
}

function VerificationCard({
  verification,
  displayPlatform,
  onRevoke,
  onChangeAuth,
  onRetryAuth,
  isRevoking,
}: {
  verification: ChannelVerificationDto;
  displayPlatform: string;
  onRevoke: () => void;
  onChangeAuth: () => void;
  onRetryAuth: () => void;
  isRevoking: boolean;
}) {
  const status = verification.status;

  if (status === "APPROVED") {
    return (
      <Card className="border-green-200 dark:border-green-800">
        <CardContent className="py-0">
          {/* 헤더 */}
          <div className="flex items-center justify-between py-4 border-b border-green-100 dark:border-green-900">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                <ShieldCheck className="size-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-semibold text-green-800 dark:text-green-200">
                  인증 완료
                </h3>
              </div>
            </div>
            <Badge
              variant={getPlatformBadgeVariant(displayPlatform)}
            >
              {getPlatformLabel(displayPlatform)} 인증됨
            </Badge>
          </div>

          {/* 상세 정보 */}
          <div className="py-4 space-y-3 text-sm">
            {verification.platformChannelId && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">채널 ID</span>
                <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                  {verification.platformChannelId}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">인증일</span>
              <span>{formatDate(verification.reviewedAt)}</span>
            </div>
          </div>

          {/* 푸터 */}
          <div className="py-3 border-t border-green-100 dark:border-green-900 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" />
              <span>프로필에 인증 배지 표시중</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onRevoke}
                disabled={isRevoking}
                className="text-muted-foreground hover:text-destructive"
              >
                {isRevoking ? (
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                ) : (
                  <XCircle className="size-4 mr-1.5" />
                )}
                해제
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onChangeAuth}
                className="text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="size-4 mr-1.5" />
                변경
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "PENDING") {
    return (
      <Card className="border-amber-200 dark:border-amber-800">
        <CardContent className="py-0">
          {/* 헤더 */}
          <div className="flex items-center justify-between py-4 border-b border-amber-100 dark:border-amber-900">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                <Clock className="size-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                  심사 진행중
                </h3>
              </div>
            </div>
            <Badge
              variant="outline"
              className="text-amber-600 border-amber-400"
            >
              심사중
            </Badge>
          </div>

          {/* 상세 정보 */}
          <div className="py-4 space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">인증 플랫폼</span>
              <Badge
                variant={getPlatformBadgeVariant(displayPlatform)}
              >
                {getPlatformLabel(displayPlatform)}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">신청일</span>
              <span>{formatDate(verification.createdAt)}</span>
            </div>
          </div>

          {/* 안내 */}
          <div className="py-3 border-t border-amber-100 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 -mx-6 px-6 rounded-b-lg">
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <Info className="size-3.5 shrink-0 mt-0.5" />
              <span>
                영업일 기준 1~3일 내에 결과를 안내드립니다. 추가 확인이 필요한
                경우 등록된 이메일로 연락드릴 수 있습니다.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "REJECTED") {
    return (
      <Card className="border-red-200 dark:border-red-800">
        <CardContent className="py-0">
          {/* 헤더 */}
          <div className="flex items-center justify-between py-4 border-b border-red-100 dark:border-red-900">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                <ShieldX className="size-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-red-800 dark:text-red-200">
                  인증 거절
                </h3>
              </div>
            </div>
            <Badge variant="destructive">거절됨</Badge>
          </div>

          {/* 상세 정보 */}
          <div className="py-4 space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">인증 플랫폼</span>
              <Badge
                variant={getPlatformBadgeVariant(displayPlatform)}
              >
                {getPlatformLabel(displayPlatform)}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">신청일</span>
              <span>{formatDate(verification.createdAt)}</span>
            </div>
          </div>

          {/* 거절 사유 */}
          {verification.rejectionReason && (
            <div className="py-3 border-t border-red-100 dark:border-red-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-red-800 dark:text-red-200">
                    거절 사유
                  </p>
                  <p className="text-red-700 dark:text-red-300 mt-1">
                    {verification.rejectionReason}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 푸터 */}
          <div className="py-3 border-t border-red-100 dark:border-red-900 flex justify-end">
            <Button onClick={onRetryAuth}>
              <RefreshCw className="size-4 mr-1.5" />
              다시 인증하기
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
