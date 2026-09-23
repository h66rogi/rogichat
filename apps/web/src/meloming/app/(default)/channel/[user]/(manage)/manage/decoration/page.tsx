import type { Metadata, ResolvingMetadata } from "next";
import {
  PageErrorBoundary,
} from "@/meloming/shared/components/common/error-boundary";
import { ChannelManageContent } from "@/meloming/domains/channel/components/channel-manage-content";
import { generateChannelManageMetadata } from "../_generate-metadata";

type Props = {
  params: Promise<{ user: string }>;
};

export async function generateMetadata(
  props: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return generateChannelManageMetadata(props, parent, "꾸미기");
}

export default function ChannelManageDecorationPage({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  return (
    <PageErrorBoundary>
      <ChannelManagePageWrapper params={params} />
    </PageErrorBoundary>
  );
}

async function ChannelManagePageWrapper({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  return <ChannelManageContent user={user} />;
}

