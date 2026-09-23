"use client";

import { Globe, ArrowUpRight } from "lucide-react";
import { useChannelGlobalProfile } from "@/meloming/domains/channel/hooks/use-channel";

interface Props {
  channelId: number | undefined;
  webPath: string | undefined;
}

/**
 * 한국어 노래책 페이지에서 글로벌(meloming.gg) 미러로 이동하는 작은 안내 링크.
 *
 * 노출 정책:
 * - globalProfile.globalEnabled === false 인 채널만 hide (opt-out)
 * - row 자체가 없거나 호출 실패 시에는 default true 로 취급해 노출
 *
 * meloming-global-front 의 라우팅:
 * - https://meloming.gg/{webPath} → /c/{webPath}/musicbook 로 자동 redirect
 */
export function GlobalLinkHint({ channelId, webPath }: Props) {
  const { data } = useChannelGlobalProfile(channelId, {
    enabled: !!channelId,
  });

  if (!webPath) return null;
  if (data?.globalEnabled === false) return null;

  return (
    <div className="mb-4 flex justify-end">
      <a
        href={`https://meloming.gg/${encodeURIComponent(webPath)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Globe className="size-3.5" />
        Not familiar with Korean? View on MELOMING Global
        <ArrowUpRight className="size-3" />
      </a>
    </div>
  );
}
