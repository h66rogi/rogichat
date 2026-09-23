import { type ReactNode } from "react";
import { SectionErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import {
  ChannelNewLayoutBanner,
  ChannelNewLayoutHeader,
} from "@/meloming/domains/channel/components/channel/channel-new-layout-header";
import ScrollToTopButton from "@/meloming/shared/components/common/scroll-to-top-button";
import { ChannelCustomCssPreview } from "@/meloming/domains/channel/components/channel-custom-css";
import { ChannelCssInspector } from "@/meloming/domains/channel/components/channel-css-inspector";
import { ChannelSideBanners } from "@/meloming/domains/channel/components/channel/channel-side-banners";
import { ContentWidthProvider } from "@/meloming/domains/channel/hooks/use-content-width";
import type { Channel, GetChannelIdentifierPermissionResponse } from "@/meloming/domains/channel/types/channel";
import type { ChannelFeatureSettings } from "@/meloming/domains/channel/types/channel-tab";

interface ChannelLayoutProps {
  user: string;
  channelData: Channel;
  permissionData: GetChannelIdentifierPermissionResponse | null;
  guestbookEnabled?: boolean;
  setlistEnabled?: boolean;
  featureSettings?: ChannelFeatureSettings;
  children: ReactNode;
}

/** Shared Meloming channel layout, limited to the mounted Rogichat channel routes. */
export function ChannelLayout({
  user,
  channelData,
  permissionData,
  featureSettings,
  children,
}: ChannelLayoutProps) {
  const hasCustomCss = channelData.layoutType !== "legacy" && !!channelData.customCss?.trim();
  const isWide = channelData.layoutWidth === "wide";

  return (
    <div id="channel-container" className={`channel-container ${hasCustomCss ? "channel-theme-active" : ""}`}>
      {hasCustomCss && <style id="channel-custom-css" dangerouslySetInnerHTML={{ __html: channelData.customCss! }} />}
      <ChannelCustomCssPreview forcedColorMode={channelData.forcedColorMode} />
      <ChannelCssInspector />
      <SectionErrorBoundary section="헤더">
        <ChannelNewLayoutHeader user={user} isWide={isWide} permissionData={permissionData} initialFeatureSettings={featureSettings} />
        <ChannelNewLayoutBanner user={user} channelData={channelData} permissionData={permissionData} />
      </SectionErrorBoundary>
      <ContentWidthProvider defaultWide={isWide}>
        <ChannelSideBanners channel={channelData} placement="inside">{children}</ChannelSideBanners>
      </ContentWidthProvider>
      <ScrollToTopButton />
    </div>
  );
}
