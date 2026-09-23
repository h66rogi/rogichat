import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { PageErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import { getChannelIdentifierServer } from "@/meloming/domains/channel/apis/channels-server";
import { getChannelWardrobeServer } from "@/meloming/domains/channel/apis/wardrobe-server";
import { ChannelWardrobeDetailContent } from "@/meloming/domains/channel/components/channel-wardrobe-detail-content";
import { getWardrobeMetaDescription } from "@/meloming/domains/channel/utils/wardrobe-description";

type Props = {
  params: Promise<{ user: string; itemId: string }>;
};

function parseItemId(value: string): number | null {
  const itemId = Number.parseInt(value, 10);
  return Number.isFinite(itemId) && itemId > 0 ? itemId : null;
}

export async function generateMetadata(
  { params }: Props,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _parent: ResolvingMetadata,
): Promise<Metadata> {
  const { user, itemId: itemIdParam } = await params;
  const itemId = parseItemId(itemIdParam);

  if (!itemId) {
    notFound();
  }

  const [channel, wardrobe] = await Promise.all([
    getChannelIdentifierServer(user),
    getChannelWardrobeServer(user),
  ]);

  if (!channel || !wardrobe) {
    notFound();
  }

  const item = wardrobe.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    notFound();
  }

  const siteName = "로기챗";
  const title = `${channel.name} 옷장 - ${item.title}`;
  const description = getWardrobeMetaDescription(
    item.description,
    `${channel.name}의 옷장 이미지 컬렉션입니다.`,
  );
  const ogTitle = `${title} - ${siteName}`;

  return {
    title,
    description,
    openGraph: {
      title: ogTitle,
      description,
      images: [{ url: item.imageUrl }],
      siteName,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description,
      images: [item.imageUrl],
    },
  };
}

export default function ChannelWardrobeDetailPage({ params }: Props) {
  return (
    <PageErrorBoundary>
      <ChannelWardrobeDetailPageWrapper params={params} />
    </PageErrorBoundary>
  );
}

async function ChannelWardrobeDetailPageWrapper({
  params,
}: {
  params: Promise<{ user: string; itemId: string }>;
}) {
  const { user, itemId: itemIdParam } = await params;
  const itemId = parseItemId(itemIdParam);

  if (!itemId) {
    notFound();
  }

  const [channel, wardrobe] = await Promise.all([
    getChannelIdentifierServer(user),
    getChannelWardrobeServer(user),
  ]);

  if (
    !channel ||
    !wardrobe ||
    !wardrobe.items.some((item) => item.id === itemId)
  ) {
    notFound();
  }

  return <ChannelWardrobeDetailContent user={user} itemId={itemId} />;
}
