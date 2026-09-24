import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getChannelIdentifierPermissionServer, getChannelIdentifierServer } from "@/meloming/domains/channel/apis/channels-server";
import { getMenuViewer } from "@/meloming/features/home-new/auth/get-menu-viewer";
import { REQUEST_PATHNAME_HEADER } from "@/meloming/shared/lib/request-pathname";

interface ManageLayoutProps {
  children: ReactNode;
  params: Promise<{ user: string }>;
}

/**
 * 채널 관리 페이지 레이아웃
 * UserHeader와 UserMenu가 없는 심플한 레이아웃
 */
export default async function ManageLayout({
  children,
  params,
}: ManageLayoutProps) {
  const { user } = await params;
  const requestHeaders = await headers();
  const requestedPath =
    requestHeaders.get(REQUEST_PATHNAME_HEADER) ?? `/channel/${user}/manage`;

  // 비로그인 사용자는 모든 manage sub-route 진입 시 server 단에서 로그인으로 redirect.
  // page.tsx 별 가드 두면 sub-route 추가 시 누락 → SSR throw → 500 (실제로 /manage/decoration
  // 등 sub-route 가 가드 누락으로 anonymous 요청에 500 응답하던 문제 일괄 해결).
  const { viewer } = await getMenuViewer();
  if (viewer.kind === "anonymous") {
    redirect(`/auth/login?from=${encodeURIComponent(requestedPath)}`);
  }

  const channel = await getChannelIdentifierServer(user);

  if (!channel) {
    notFound();
  }

  // The web/API shared session cookie lets the server establish management
  // admission before rendering any copied client management component.
  const permission = await getChannelIdentifierPermissionServer(user);
  if (!permission || !(permission.isOwner || permission.manageContent || permission.manageSettings ||
    permission.manageProfile || permission.manageGuestbook || permission.manageCustomization || permission.manageEmoticons)) {
    notFound();
  }

  return children;
}
