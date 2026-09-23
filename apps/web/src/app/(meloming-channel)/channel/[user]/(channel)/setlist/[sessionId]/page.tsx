import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { PageErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import { ChannelSetlistDetailContent } from "@/meloming/domains/channel/components/channel-setlist-detail-content";
import { getChannelIdentifierServer } from "@/meloming/domains/channel/apis/channels-server";
import { getTabTitle } from "@/meloming/domains/channel/types/channel-tab";

type Props = {
  params: Promise<{ user: string; sessionId: string }>;
};

export async function generateMetadata(
  { params }: Props,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { user } = await params;
  const channel = await getChannelIdentifierServer(user);

  if (!channel) {
    notFound();
  }

  const siteName = "로기챗";
  const tabTitle = getTabTitle("setlist");
  const title = `${channel.name} ${tabTitle} 상세`;
  const description = `${channel.name}의 셋리스트 세션 상세 — 재생된 곡 목록을 확인할 수 있습니다.`;

  const ogTitle = `${title} - ${siteName}`;

  return {
    title,
    description,
    openGraph: {
      title: ogTitle,
      description,
      siteName,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
    },
  };
}

export default function ChannelSetlistDetailPage({ params }: Props) {
  return (
    <PageErrorBoundary>
      <ChannelSetlistDetailPageWrapper params={params} />
    </PageErrorBoundary>
  );
}

async function ChannelSetlistDetailPageWrapper({
  params,
}: {
  params: Promise<{ user: string; sessionId: string }>;
}) {
  const { user, sessionId } = await params;
  const channel = await getChannelIdentifierServer(user);

  if (!channel) {
    notFound();
  }

  const sessionIdNum = Number(sessionId);
  if (!Number.isFinite(sessionIdNum) || sessionIdNum <= 0) {
    notFound();
  }

  return <ChannelSetlistDetailContent user={user} sessionId={sessionIdNum} />;
}
