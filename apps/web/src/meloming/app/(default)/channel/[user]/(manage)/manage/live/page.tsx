import type { Metadata, ResolvingMetadata } from "next";
import { PageErrorBoundary } from "@/meloming/shared/components/common/error-boundary";
import { ChannelManageContent } from "@/meloming/domains/channel/components/channel-manage-content";
import { generateChannelManageMetadata } from "../_generate-metadata";

type Props = {
  params: Promise<{ user: string }>;
};

export async function generateMetadata(
  props: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return generateChannelManageMetadata(props, parent, "리모컨 (신청곡 콘솔)");
}

export default function ChannelManageLivePage({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  return (
    <PageErrorBoundary>
      <ChannelManageLivePageWrapper params={params} />
    </PageErrorBoundary>
  );
}

async function ChannelManageLivePageWrapper({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  return <ChannelManageContent user={user} />;
}
