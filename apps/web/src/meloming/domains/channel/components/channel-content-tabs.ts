"use client";

export type ChannelContentRelationTab = "hosted" | "participating";

export const CHANNEL_CONTENT_TAB_PARAM = "contentTab";

export const CHANNEL_CONTENT_TABS: Array<{
  value: ChannelContentRelationTab;
  label: string;
  description: string;
  empty: string;
}> = [
  {
    value: "hosted",
    label: "주최",
    description: "이 채널이 주최자로 등록된 콘텐츠입니다.",
    empty: "아직 이 채널이 주최한 콘텐츠가 없어요.",
  },
  {
    value: "participating",
    label: "참가",
    description: "이 채널이 참가한 콘텐츠입니다.",
    empty: "아직 이 채널이 참가한 콘텐츠가 없어요.",
  },
];

export function parseChannelContentTab(
  value: string | null,
): ChannelContentRelationTab {
  return value === "participating" ? "participating" : "hosted";
}
