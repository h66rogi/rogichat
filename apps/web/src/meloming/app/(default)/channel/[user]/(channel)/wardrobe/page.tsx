import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { PageErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import { ChannelWardrobeContent } from "@/meloming/domains/channel/components/channel-wardrobe-content";
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
  const tabTitle = getTabTitle("wardrobe");
  const title = `${channel.name} ${tabTitle}`;
  const description = `${channel.name}의 의상, 헤어 등 버추얼 이미지 컬렉션입니다.`;
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

export default function ChannelWardrobePage({ params }: Props) {
  return (
    <PageErrorBoundary>
      <ChannelWardrobePageWrapper params={params} />
    </PageErrorBoundary>
  );
}

async function ChannelWardrobePageWrapper({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  const channel = await getChannelIdentifierServer(user);

  if (!channel) {
    notFound();
  }

  return <ChannelWardrobeContent user={user} />;
}
