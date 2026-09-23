"use client";

import type { Channel } from "@/meloming/domains/channel/types/channel";
import { useContentWidth } from "@/meloming/domains/channel/hooks/use-content-width";

interface ChannelSideBannersProps {
  channel: Channel;
  children: React.ReactNode;
  /** 신규 레이아웃처럼 바깥 여백이 없는 셸에서는 콘텐츠 안쪽에 배너를 배치 */
  placement?: "outside" | "inside";
}

/**
 * 채널 좌우측 배너
 * ContentWidthContext의 isContentWide 상태에 따라 배치 방식 전환:
 * - default: container 기준 absolute로 컨테이너 옆에 밀착
 * - wide: flex 레이아웃으로 화면 양 끝에 밀착
 *
 * 노래책에서 localStorage 토글 시 isContentWide가 변경되어 동적 전환
 */
export function ChannelSideBanners({
  channel,
  children,
  placement = "outside",
}: ChannelSideBannersProps) {
  const { isContentWide } = useContentWidth();
  const hasLeftBanner = !!channel.leftBannerUrl;
  const hasRightBanner = !!channel.rightBannerUrl;
  const hasSideBanners = hasLeftBanner || hasRightBanner;

  if (!hasSideBanners) {
    return <>{children}</>;
  }

  // wide 모드 또는 신규 셸: flex 레이아웃으로 사용 가능한 영역 안쪽 양 끝에 배치
  if (isContentWide || placement === "inside") {
    return (
      <div className="channel-side-banners flex items-start">
        {hasLeftBanner && (
          <aside className="channel-left-banner hidden xl:block shrink-0 pt-8 px-2">
            <SideBannerImage
              src={channel.leftBannerUrl!}
              alt={`${channel.name} 좌측 배너`}
              link={channel.leftBannerLink}
            />
          </aside>
        )}

        <div className="flex-1 min-w-0">
          {children}
        </div>

        {hasRightBanner && (
          <aside className="channel-right-banner hidden xl:block shrink-0 pt-8 px-2">
            <SideBannerImage
              src={channel.rightBannerUrl!}
              alt={`${channel.name} 우측 배너`}
              link={channel.rightBannerLink}
            />
          </aside>
        )}
      </div>
    );
  }

  // default 모드: container 기준 absolute로 바로 옆에 밀착
  return (
    <div className="channel-side-banners container mx-auto relative xl:min-h-[482px]">
      {hasLeftBanner && (
        <aside className="channel-left-banner hidden xl:block absolute top-8 right-full mr-2 w-[150px]">
          <SideBannerImage
            src={channel.leftBannerUrl!}
            alt={`${channel.name} 좌측 배너`}
            link={channel.leftBannerLink}
          />
        </aside>
      )}

      {children}

      {hasRightBanner && (
        <aside className="channel-right-banner hidden xl:block absolute top-8 left-full ml-2 w-[150px]">
          <SideBannerImage
            src={channel.rightBannerUrl!}
            alt={`${channel.name} 우측 배너`}
            link={channel.rightBannerLink}
          />
        </aside>
      )}
    </div>
  );
}

function SideBannerImage({ src, alt, link }: { src: string; alt: string; link: string | null }) {
  const img = (
    <img
      src={src}
      alt={alt}
      className="w-[150px] h-[450px] object-cover rounded-lg"
    />
  );

  if (link) {
    return (
      <a href={link} target="_blank" rel="noopener noreferrer">
        {img}
      </a>
    );
  }

  return img;
}
