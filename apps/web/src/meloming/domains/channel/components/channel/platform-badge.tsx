import { Badge } from "@/meloming/shared/components/ui/badge";
import { ExternalLink } from "lucide-react";
import type { StreamPlatform } from "@/meloming/domains/platform/types/platform";

interface PlatformBadgeProps {
  platformUrl: string;
  simplifyBadge?: boolean;
  hideWhenDefault?: boolean;
}

interface EachPlatformBadgeProps {
  simplifyBadge?: boolean;
}

const SoopBadge = ({ simplifyBadge }: EachPlatformBadgeProps) => {
  return (
    <Badge variant="soop" className="select-none">
      {!simplifyBadge && <ExternalLink size={14} />}
      SOOP{simplifyBadge ? "" : " 방송국"}
    </Badge>
  );
};

const ChzzkBadge = ({ simplifyBadge }: EachPlatformBadgeProps) => {
  return (
    <Badge variant="chzzk" className="select-none">
      {!simplifyBadge && <ExternalLink size={14} />}
      CHZZK{simplifyBadge ? "" : " 채널"}
    </Badge>
  );
};

const CimeBadge = ({ simplifyBadge }: EachPlatformBadgeProps) => {
  return (
    <Badge variant="cime" className="select-none">
      {!simplifyBadge && <ExternalLink size={14} />}
      CIME{simplifyBadge ? "" : " 채널"}
    </Badge>
  );
};

const DefaultBadge = ({ simplifyBadge }: EachPlatformBadgeProps) => {
  return (
    <Badge variant="soop" className="select-none">
      {!simplifyBadge && <ExternalLink size={14} />}
      {simplifyBadge ? "" : "방송 채널"}
    </Badge>
  );
};

export default function PlatformBadge({
  platformUrl,
  simplifyBadge = false,
  hideWhenDefault = false,
}: PlatformBadgeProps) {
  const normalizedPlatformUrl = platformUrl.toLowerCase();

  if (normalizedPlatformUrl.includes("sooplive.co.kr")) {
    return <SoopBadge simplifyBadge={simplifyBadge} />;
  } else if (normalizedPlatformUrl.includes("chzzk.naver.com")) {
    return <ChzzkBadge simplifyBadge={simplifyBadge} />;
  } else if (normalizedPlatformUrl.includes("ci.me")) {
    return <CimeBadge simplifyBadge={simplifyBadge} />;
  } else {
    if (hideWhenDefault) {
      return null;
    } else {
      return <DefaultBadge simplifyBadge={simplifyBadge} />;
    }
  }
}

function PlatformBadgeByType({
  platform,
  simplifyBadge = false,
}: {
  platform: StreamPlatform;
  simplifyBadge?: boolean;
}) {
  switch (platform) {
    case "CHZZK":
      return <ChzzkBadge simplifyBadge={simplifyBadge} />;
    case "SOOP":
      return <SoopBadge simplifyBadge={simplifyBadge} />;
    case "CIME":
      return <CimeBadge simplifyBadge={simplifyBadge} />;
    default:
      return <DefaultBadge simplifyBadge={simplifyBadge} />;
  }
}

interface PlatformBadgesProps {
  verifications?: {
    platform: StreamPlatform;
    platformChannelId?: string | null;
  }[];
  platformUrl?: string | null;
}

export function buildPlatformUrl(
  platform: StreamPlatform,
  platformChannelId?: string | null,
  fallbackPlatformUrl?: string | null,
): string | null {
  switch (platform) {
    case "SOOP":
      return platformChannelId
        ? `https://www.sooplive.co.kr/station/${platformChannelId}`
        : null;
    case "CHZZK":
      return platformChannelId
        ? `https://chzzk.naver.com/${platformChannelId}`
        : null;
    case "CIME":
      return platformChannelId
        ? `https://ci.me/@${platformChannelId}`
        : null;
    case "OTHER":
      return fallbackPlatformUrl ?? null;
    default:
      return null;
  }
}

export function PlatformBadges({
  verifications,
  platformUrl,
}: PlatformBadgesProps) {
  // If verifications exist, show badge per platform with individual links
  if (verifications && verifications.length > 0) {
    return (
      <div className="flex gap-2">
        {verifications.map((v) => {
          const url = buildPlatformUrl(
            v.platform,
            v.platformChannelId,
            platformUrl,
          );
          const badge = (
            <PlatformBadgeByType key={v.platform} platform={v.platform} />
          );
          return url ? (
            <a
              key={v.platform}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {badge}
            </a>
          ) : (
            badge
          );
        })}
      </div>
    );
  }

  // Otherwise fallback to existing PlatformBadge with platformUrl
  if (platformUrl) {
    return <PlatformBadge platformUrl={platformUrl} />;
  }

  return null;
}

/** StreamPlatform 별 정사각 로고 경로 (원형 링크 버튼용). OTHER/미지원은 null. */
export function platformIconSrc(platform: StreamPlatform): string | null {
  switch (platform) {
    case "SOOP":
      return "/static/soop-square.png";
    case "CHZZK":
      return "/static/chzzk-square.png";
    case "CIME":
      return "/static/cime_square.png";
    default:
      return null;
  }
}

/** platformUrl 문자열에서 플랫폼 정사각 로고 경로 추론 (verifications 없을 때). */
export function platformIconSrcByUrl(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("sooplive.co.kr") || u.includes("afreecatv.com"))
    return "/static/soop-square.png";
  if (u.includes("chzzk.naver.com")) return "/static/chzzk-square.png";
  if (u.includes("ci.me")) return "/static/cime_square.png";
  return null;
}
