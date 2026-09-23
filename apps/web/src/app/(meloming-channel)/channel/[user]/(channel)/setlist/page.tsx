import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { PageErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import { ChannelSetlistContent } from "@/meloming/domains/channel/components/channel-setlist-content";
import { getChannelIdentifierServer } from "@/meloming/domains/channel/apis/channels-server";
import { getTabTitle } from "@/meloming/domains/channel/types/channel-tab";

type Props = {
  params: Promise<{ user: string }>;
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
  const title = `${channel.name} ${tabTitle}`;
  const description = `${channel.name}의 방송에서 재생됐던 곡을 세션별로 다시 볼 수 있는 셋리스트 페이지입니다.`;

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

export default function ChannelSetlistPage({ params }: Props) {
  return (
    <PageErrorBoundary>
      <ChannelSetlistPageWrapper params={params} />
    </PageErrorBoundary>
  );
}

async function ChannelSetlistPageWrapper({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  const channel = await getChannelIdentifierServer(user);

  if (!channel) {
    notFound();
  }

  return <ChannelSetlistContent user={user} />;
}
