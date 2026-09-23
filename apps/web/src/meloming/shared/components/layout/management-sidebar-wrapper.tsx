"use client";

import { ManagementSidebar } from "@/meloming/domains/channel/components/management/management-sidebar";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import type { ManagementSection } from "@/meloming/domains/channel/components/management/types";

interface ManagementSidebarWrapperProps {
  user: string;
  activeSection: ManagementSection;
}

/**
 * ManagementSidebar를 위한 클라이언트 컴포넌트 래퍼
 * useChannel 훅을 사용하기 위해 필요합니다.
 */
export function ManagementSidebarWrapper({
  user,
  activeSection,
}: ManagementSidebarWrapperProps) {
  const { data: userData } = useChannel(user);

  return (
    <ManagementSidebar
      activeSection={activeSection}
      userData={userData}
    />
  );
}

