import type { Metadata, ResolvingMetadata } from "next";
import { PageErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import { ChannelManageContent } from "@/meloming/domains/channel/components/channel-manage-content";
import { generateChannelManageMetadata } from "../_generate-metadata";

type Props = {
  params: Promise<{ user: string }>;
};

export async function generateMetadata(
  props: Props,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  return generateChannelManageMetadata(props, parent, "오버레이 커스텀 CSS");
}

export default function ChannelManageOverlayCustomCssPage({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  return (
    <PageErrorBoundary>
      <PageWrapper params={params} />
    </PageErrorBoundary>
  );
}

async function PageWrapper({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  return <ChannelManageContent user={user} />;
}
