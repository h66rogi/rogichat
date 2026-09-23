import type { Metadata, ResolvingMetadata } from "next";
import { getChannelIdentifierServer } from "@/meloming/domains/channel/apis/channels-server";
import { cache } from "react";

type Props = {
  params: Promise<{ user: string }>;
};

// 데이터를 메모이제이션하여 generateMetadata와 페이지 컴포넌트에서 재사용
const getChannelCached = cache(async (user: string) => {
  return await getChannelIdentifierServer(user);
});

export async function generateChannelManageMetadata(
  { params }: Props,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _parent: ResolvingMetadata,
  sectionTitle?: string
): Promise<Metadata> {
  const { user } = await params;
  const channel = await getChannelCached(user);

  if (!channel) {
    return {
      title: sectionTitle ? `${sectionTitle} - 채널 관리` : "채널 관리",
    };
  }

  const title = sectionTitle
    ? `${sectionTitle} - ${channel.name} 관리`
    : `${channel.name} 관리`;

  return {
    title,
  };
}

