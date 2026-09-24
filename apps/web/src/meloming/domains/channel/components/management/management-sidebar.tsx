import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/meloming/shared/components/ui/sidebar";
import type { ManagementSection } from "./types";
import { ManagementSidebarHeader } from "./management-sidebar-header";
import { ManagementSidebarContent } from "./management-sidebar-content";

interface ManagementSidebarProps {
  activeSection: ManagementSection;
  userData:
    | import("@/meloming/domains/channel/types/channel").Channel
    | null
    | undefined;
  // 그룹 타이틀 표시 여부 (기본값: true)
  showGroupTitles?: boolean;
}

export function ManagementSidebar({
  activeSection,
  userData,
  showGroupTitles = true,
}: ManagementSidebarProps) {
  return (
    // ManageShell 의 Inset Card 레이아웃 (Frame Overlay 패턴) 안에 정렬됨.
    // - left: ManageShell 카드의 좌측 간격
    // - top: thin header 아래 카드 시작점, bottom: card gap
    // - h: auto (top/bottom 으로 높이 결정, h-svh override)
    // - 좌측 모서리 둥글기: 카드 좌측 모서리 따라 rounded-l-xl
    // - 우측 border 는 그대로 — 카드 내부 사이드바/콘텐츠 divider 역할
    // - bg 는 ManageShell 의 `--sidebar: var(--background)` override 로 자동 일치
    // - z-30 → 카드 frame overlay (z-50) 보다 아래, 회색 band (z-40) 보다 아래
    //   따라서 사이드바도 페이지 스크롤 시 frame band 위에 보이지 않고 자연스럽게 카드 안에 정렬
    // - transition 으로 morph 펼침/접힘과 함께 부드럽게 이동
    <Sidebar
      variant="sidebar"
      collapsible="offcanvas"
      className="md:left-[var(--card-gap)]! md:top-[var(--site-sticky-top)]! md:bottom-[var(--card-gap)]! md:h-auto! md:rounded-l-xl! md:overflow-hidden! transition-[left] duration-300 ease-out"
    >
      <SidebarHeader className="p-3">
        <ManagementSidebarHeader
          userData={userData}
          activeSection={activeSection}
        />
      </SidebarHeader>
      <hr />

      <SidebarContent className="px-4 pt-6">
        <ManagementSidebarContent
          activeSection={activeSection}
          showGroupTitles={showGroupTitles}
        />
      </SidebarContent>
    </Sidebar>
  );
}
