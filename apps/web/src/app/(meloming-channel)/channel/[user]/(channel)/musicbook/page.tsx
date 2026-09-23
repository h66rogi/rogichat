import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { PageErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import { ChannelMusicbookContent } from "@/meloming/domains/channel/components/channel-musicbook-content";
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

  const siteName = "멜로밍";
  const tabTitle = getTabTitle("musicbook");
  const title = `${channel.name} ${tabTitle}`;
  const description = `${channel.name}의 노래책 채널입니다. 방문해서 노래책뿐 아니라 일정, 클립, 정보 등 다양한 콘텐츠를 확인해보세요.`;

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

export default function ChannelMusicbookPage({ params }: Props) {
  return (
    <PageErrorBoundary>
      <ChannelMusicbookPageWrapper params={params} />
    </PageErrorBoundary>
  );
}

async function ChannelMusicbookPageWrapper({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  const channel = await getChannelIdentifierServer(user);

  if (!channel) {
    notFound();
  }

  return <ChannelMusicbookContent user={user} />;
}
