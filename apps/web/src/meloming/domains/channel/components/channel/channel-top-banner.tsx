import type { Channel } from "@/meloming/domains/channel/types/channel";

interface ChannelTopBannerProps {
  channel: Channel;
}

/**
 * 채널 상단 배너
 * 중앙에 배너 이미지, 양 옆에는 테마 색상 배경
 */
export function ChannelTopBanner({ channel }: ChannelTopBannerProps) {
  if (!channel.topBannerUrl) {
    return null;
  }

  return (
    <div
      className="channel-top-banner relative w-full"
      style={{ backgroundColor: channel.themeColor }}
    >
      <img
        src={channel.topBannerUrl}
        alt={`${channel.name} 상단 배너`}
        className="w-full h-48 object-cover"
      />
    </div>
  );
}
