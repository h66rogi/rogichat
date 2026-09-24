"use client";

/**
 * 오버레이 설정 섹션 엔트리 포인트.
 * 실제 UI는 `OverlayUnifiedPage`가 담당한다. `TotalOverlayLayoutSettings`는
 * 별도 파일로 이전되었으나 기존 import 경로 유지를 위해 여기서 re-export한다.
 */
import { OverlayUnifiedPage } from "./overlay-unified-settings";

export { TotalOverlayLayoutSettings } from "./total-overlay-layout-settings";

interface OverlaySettingsContentProps {
  user: string;
}

export function OverlaySettingsContent({ user }: OverlaySettingsContentProps) {
  return <OverlayUnifiedPage user={user} />;
}
