import type { ManagerPermissionKey } from "@/meloming/domains/channel/types/manager";

export type ManagerPermissionDefinition = {
  key: ManagerPermissionKey;
  label: string;
  description: string;
};

export type ManagerPermissionState = Record<ManagerPermissionKey, boolean>;

export const MANAGER_PERMISSION_DEFINITIONS: ManagerPermissionDefinition[] = [
  {
    key: "canManageContent",
    label: "콘텐츠 관리",
    description:
      "노래 추가/수정/삭제와 카테고리·아티스트 등 콘텐츠 영역을 관리할 수 있습니다.",
  },
  {
    key: "canManageSettings",
    label: "채널 설정 관리",
    description:
      "채널 이름, 공지, 공개 여부 등 핵심 설정을 직접 변경할 수 있습니다.",
  },
  {
    key: "canManageProfile",
    label: "채널 프로필 관리",
    description: "프로필 이미지/소개와 같은 대외 노출 정보를 손볼 수 있습니다.",
  },
  {
    key: "canManageGuestbook",
    label: "방명록 관리",
    description: "방명록 게시글을 검토·수정하거나 규칙을 설정할 수 있습니다.",
  },
  {
    key: "canManageCustomization",
    label: "커스텀 CSS 관리",
    description:
      "채널에 적용되는 커스텀 CSS를 직접 편집하고 미리보기할 수 있습니다.",
  },
  {
    key: "canManageEmoticons",
    label: "이모티콘 관리",
    description:
      "채널 전용 이모티콘을 업로드하고 삭제할 수 있습니다.",
  },
];
