import { type ReactNode } from "react";
import { cn } from "@/meloming/shared/lib/utils";
import { SectionErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import UserHeader from "@/meloming/domains/channel/components/channel/user-header";
import UserMenu from "@/meloming/domains/channel/components/channel/user-menu";
import {
  ChannelNewLayoutBanner,
  ChannelNewLayoutHeader,
} from "@/meloming/domains/channel/components/channel/channel-new-layout-header";
import ScrollToTopButton from "@/meloming/shared/components/common/scroll-to-top-button";
import { ChannelCustomCssPreview } from "@/meloming/domains/channel/components/channel-custom-css";
import { ChannelCssInspector } from "@/meloming/domains/channel/components/channel-css-inspector";
import { ChannelTopBanner } from "@/meloming/domains/channel/components/channel/channel-top-banner";
import { ChannelBannerEditable } from "@/meloming/domains/channel/components/channel/channel-banner-editable";
import { ChannelSideBanners } from "@/meloming/domains/channel/components/channel/channel-side-banners";
import { ContentWidthProvider } from "@/meloming/domains/channel/hooks/use-content-width";
import { ChannelVerificationPromptModal } from "@/meloming/domains/channel/components/channel/channel-verification-prompt-modal";
import type {
  Channel,
  GetChannelIdentifierPermissionResponse,
} from "@/meloming/domains/channel/types/channel";
import type { ChannelFeatureSettings } from "@/meloming/domains/channel/types/channel-tab";

const CHANNEL_CSS_ID = "channel-custom-css";
const CHANNEL_THEME_CLASS = "channel-theme-active";

interface ChannelLayoutProps {
  user: string;
  channelData: Channel;
  permissionData: GetChannelIdentifierPermissionResponse | null;
  guestbookEnabled?: boolean;
  setlistEnabled?: boolean;
  featureSettings?: ChannelFeatureSettings;
  children: ReactNode;
  /**
   * 라이브 시청 페이지처럼 customCss / forcedColorMode / 인증 nudge 만 유지하고
   * UserHeader / UserMenu / SideBanners 는 외부(LiveViewer) 가 자체적으로 노출하는
   * minimal layout 모드.
   * 기본 false — 일반 채널 탭 페이지는 기존 (헤더 → 메뉴 → children) 순서.
   */
  stageMode?: boolean;
}

/**
 * 채널 레이아웃 서버 컴포넌트
 * UserHeader와 UserMenu를 포함하여 모든 탭에서 공통으로 사용
 * 서버에서 데이터를 받아 SSR로 렌더링
 *
 * 커스텀 CSS는 서버에서 직접 style 태그로 렌더링하여 FOUC 방지
 * (customCss는 백엔드 CssValidatorService에서 검증 완료된 안전한 CSS)
 *
 * stageMode 가 true 면 라이브 시청 전용 minimal layout — customCss / 미리보기 /
 * 인증 nudge / scroll-to-top 만 유지하고 헤더/메뉴/사이드배너는 미노출. 라이브
 * 페이지는 LiveViewer 가 자체 간소 헤더와 inline 탭을 가지기 때문이다.
 */
export function ChannelLayout({
  user,
  channelData,
  permissionData,
  guestbookEnabled = true,
  setlistEnabled = false,
  featureSettings,
  children,
  stageMode = false,
}: ChannelLayoutProps) {
  // 기존에는 응답의 customCss가 있으면 layoutType과 관계없이 적용했다.
  // legacy 응답의 CSS는 신규 레이아웃과 호환되지 않으므로 지원 중단과 함께 적용하지 않는다.
  const hasCustomCss =
    channelData.layoutType !== "legacy" && !!channelData.customCss?.trim();
  const isSeparated = channelData.headerStyle === "separated";
  const isWide = channelData.layoutWidth === "wide";
  // 기존 분기: !stageMode && (channelData.layoutType ?? "new") === "new".
  // 2026년 7월 업데이트부터 일반 채널 페이지는 신규 레이아웃으로 강제한다.
  const isNewLayout = !stageMode;
  const canEditBanner = permissionData?.isOwner || permissionData?.manageSettings || false;

  return (
    <div
      id="channel-container"
      className={`channel-container ${hasCustomCss ? CHANNEL_THEME_CLASS : ""}`}
    >
      {hasCustomCss && (
        <style
          id={CHANNEL_CSS_ID}
          dangerouslySetInnerHTML={{ __html: channelData.customCss! }}
        />
      )}

      <ChannelCustomCssPreview forcedColorMode={channelData.forcedColorMode} />
      <ChannelCssInspector />

      {stageMode ? (
        children
      ) : isNewLayout ? (
        <>
          {/* 신규 레이아웃: 비홈 탭은 SectionHeaderV3 상단 헤더, 홈은 배너 배경.
              프로필/링크/액션은 ChannelMenuSidebar 가 담당 */}
          <SectionErrorBoundary section="헤더">
            <ChannelNewLayoutHeader
              user={user}
              isWide={isWide}
              permissionData={permissionData}
              initialFeatureSettings={featureSettings}
            />
            <ChannelNewLayoutBanner
              user={user}
              channelData={channelData}
              permissionData={permissionData}
            />
          </SectionErrorBoundary>
          <ContentWidthProvider defaultWide={isWide}>
            <ChannelSideBanners channel={channelData} placement="inside">
              {children}
            </ChannelSideBanners>
          </ContentWidthProvider>
        </>
      ) : (
        <>
          {isSeparated ? (
            <div className={cn(!isWide && "container", "mx-auto mt-4 px-4 md:px-6")}>
              <ChannelBannerEditable
                identifier={user}
                channel={channelData}
                canEdit={canEditBanner}
              />
              <SectionErrorBoundary section="프로필">
                <UserHeader
                  userId={user}
                  userData={channelData}
                  userPermission={permissionData}
                />
              </SectionErrorBoundary>
            </div>
          ) : (
            <SectionErrorBoundary section="프로필">
              <UserHeader
                userId={user}
                userData={channelData}
                userPermission={permissionData}
              />
            </SectionErrorBoundary>
          )}

          <SectionErrorBoundary section="메뉴">
            <UserMenu
              userId={user}
              userData={channelData}
              guestbookEnabled={guestbookEnabled}
              setlistEnabled={setlistEnabled}
              featureSettings={featureSettings}
            />
          </SectionErrorBoundary>

          <ContentWidthProvider defaultWide={isWide}>
            <ChannelSideBanners channel={channelData}>
              {children}
            </ChannelSideBanners>
          </ContentWidthProvider>
        </>
      )}

      <ScrollToTopButton />

      <ChannelVerificationPromptModal
        channelId={channelData.id}
        platformUrl={channelData.platformUrl}
        isOwner={permissionData?.isOwner ?? false}
        isVerified={channelData.isVerified ?? false}
      />
    </div>
  );
}
