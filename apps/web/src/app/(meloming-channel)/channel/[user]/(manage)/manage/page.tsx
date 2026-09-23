import type { Metadata, ResolvingMetadata } from "next";
import { redirect } from "next/navigation";
import {
  PageErrorBoundary,
} from "@/meloming/shared/components/common/error-boundary";
import { ChannelManageContent } from "@/meloming/domains/channel/components/channel-manage-content";
import { getMenuViewer } from "@/meloming/features/home-new/auth/get-menu-viewer";
import { generateChannelManageMetadata } from "./_generate-metadata";

type Props = {
  params: Promise<{ user: string }>;
};

export async function generateMetadata(
  props: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return generateChannelManageMetadata(props, parent);
}

export default function ChannelManagePage({ params }: Props) {
  return (
    <PageErrorBoundary>
      <ChannelManagePageWrapper params={params} />
    </PageErrorBoundary>
  );
}

async function ChannelManagePageWrapper({ params }: Props) {
  const { user } = await params;

  // 비로그인 사용자는 server 측에서 즉시 로그인 페이지로 redirect.
  // 이 분기를 두지 않으면 anonymous 호출 시 SSR 도중 throw 가 발생해
  // status 500 으로 응답되고 (외부 정찰/검색엔진/모니터링 노이즈),
  // 본문이 noFound 분기로 채워져 사용자 UX 도 어색해진다.
  // Owner/Manager 권한 검증은 client component (ChannelManageContent) 가
  // useChannelPermission 으로 처리한다 — 서버는 인증 여부만 책임.
  const { viewer } = await getMenuViewer();
  if (viewer.kind === "anonymous") {
    redirect(`/auth/login?from=${encodeURIComponent(`/channel/${user}/manage`)}`);
  }

  return <ChannelManageContent user={user} />;
}
