"use client";

import { useOverlayToken } from "@/meloming/domains/channel/hooks/use-overlay-token";
import { OverlayCssManagement } from "@/meloming/domains/channel/components/management/overlay-css/overlay-css-management";

interface OverlayCustomCssSectionProps {
  user: string;
}

export function OverlayCustomCssSection({ user }: OverlayCustomCssSectionProps) {
  const { data: tokenData, isLoading: tokenLoading } = useOverlayToken(user);

  if (!user || tokenLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">불러오는 중...</div>
    );
  }

  const overlayToken = tokenData?.overlayToken ?? "";
  if (!overlayToken) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        오버레이 토큰을 불러올 수 없습니다.
      </div>
    );
  }

  // ChannelManageContent가 이미 container mx-auto로 감싸므로 여기서 재래핑 안 함
  return <OverlayCssManagement identifier={user} overlayToken={overlayToken} />;
}
