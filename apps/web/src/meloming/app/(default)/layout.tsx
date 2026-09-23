import { headers } from "next/headers";
import { GlobalShell } from "@/meloming/shared/components/layout/global-shell";
import {
  getChannelFeatureSettingsServer,
  getChannelIdentifierPermissionServer,
  getChannelIdentifierServer,
} from "@/meloming/domains/channel/apis/channels-server";
import { getChannelSetlistAvailabilityServer } from "@/meloming/domains/song-live/apis/setlist-server";
import { REQUEST_PATHNAME_HEADER } from "@/meloming/shared/lib/request-pathname";
import { resolvePublicChannelRoute } from "@/meloming/shared/lib/public-channel-route";
import type { ChannelShellInitialData } from "@/meloming/features/home-new/layout/channel-shell-initial-data";

// 레이아웃이 서버에서 쿠키 기반 viewer를 fetch하고, 여러 자식 페이지가
// useSearchParams / 쿠키 기반 데이터에 의존하므로 전체를 동적 렌더로 고정.
// (Next.js 16의 엄격해진 prerender 검사 때문에 자식 페이지마다 force-dynamic을
// 붙이는 대신 레이아웃에서 한 번에 처리.)
export const dynamic = "force-dynamic";

function resolveInitialPublicChannelUser(pathname: string | null): string | null {
  return resolvePublicChannelRoute(pathname)?.user ?? null;
}

async function getInitialChannelShellData(
  user: string | null
): Promise<ChannelShellInitialData | undefined> {
  if (!user) return undefined;

  const [channel, permission, featureSettings, setlistAvailability] =
    await Promise.all([
      getChannelIdentifierServer(user),
      getChannelIdentifierPermissionServer(user),
      getChannelFeatureSettingsServer(user),
      getChannelSetlistAvailabilityServer(user),
    ]);

  if (!channel) return undefined;

  return {
    user,
    channel,
    permission,
    featureSettings,
    setlistAvailability,
  };
}

export default async function DefaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get(REQUEST_PATHNAME_HEADER);
  const initialChannelUser = resolveInitialPublicChannelUser(pathname);
  const initialChannelShellData = await getInitialChannelShellData(initialChannelUser);

  return (
    <GlobalShell initialChannelShellData={initialChannelShellData}>
      {children}
    </GlobalShell>
  );
}
