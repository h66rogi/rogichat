/**
 * 채널 페이지의 탭 타입 정의
 */
export type ChannelTab =
  | "home"
  | "musicbook"
  | "setlist"
  | "schedule"
  | "wardrobe"
  | "guestbook"
  | "info"
  | "content";

/**
 * 각 탭의 설정 정보
 */
export interface TabConfig {
  title: string;
  path: string;
  tabName: ChannelTab;
  isNew?: boolean;
  /** 탭 설명 — 신규 레이아웃 SectionHeaderV3 타이틀 옆 i 버튼 팝오버로 노출 */
  description?: string;
}

export interface ChannelFeatureSetting {
  key: ChannelTab;
  label: string;
  defaultLabel: string;
  isEnabled: boolean;
  order: number;
}

export interface ChannelFeatureSettings {
  items: ChannelFeatureSetting[];
}

export interface ChannelMusicbookSettings {
  useProficiencyAsPrimary: boolean;
  hasExplicitUseProficiencyAsPrimary: boolean;
  canEnableProficiencyAsPrimary: boolean;
  totalSongs: number;
  songsMissingProficiency: number;
}

export type ChannelMusicbookSettingsUpdate = {
  useProficiencyAsPrimary: boolean;
};

export type CopyDifficultyToProficiencyResponse =
  ChannelMusicbookSettings & {
    updatedCount: number;
  };

export type ChannelFeatureSettingsUpdate = {
  items: Array<
    Pick<ChannelFeatureSetting, "key" | "label" | "isEnabled" | "order">
  >;
};

export type ConfiguredTabItem = TabConfig & {
  defaultTitle: string;
  isEnabled: boolean;
  order: number;
};

/**
 * 탭 설정 상수
 */
export const TAB_CONFIG: Record<ChannelTab, TabConfig> = {
  home: { title: "홈", path: "", tabName: "home", isNew: false },
  musicbook: {
    title: "노래책",
    path: "musicbook",
    tabName: "musicbook",
    isNew: false,
    description: "채널이 부를 수 있는 곡과 신청 가능한 곡을 모아 봅니다.",
  },
  setlist: {
    title: "셋리스트",
    path: "setlist",
    tabName: "setlist",
    isNew: false,
    description: "방송에서 재생됐던 곡을 세션별로 다시 볼 수 있습니다.",
  },
  schedule: {
    title: "캘린더",
    path: "schedule",
    tabName: "schedule",
    isNew: true,
    description: "방송 일정 · 방송 기록 · 노래 방송 · 기념일을 한눈에",
  },
  wardrobe: {
    title: "옷장",
    path: "wardrobe",
    tabName: "wardrobe",
    isNew: true,
    description: "버추얼 스트리머의 의상, 헤어 등 이미지를 모아 봅니다.",
  },
  guestbook: {
    title: "방명록",
    path: "guestbook",
    tabName: "guestbook",
    isNew: false,
    description: "채널에 짧은 메시지를 남기고 방문자 반응을 확인합니다.",
  },
  info: {
    title: "정보",
    path: "info",
    tabName: "info",
    isNew: false,
    description: "채널 소개, 링크, 활동 정보를 확인합니다.",
  },
  content: {
    title: "콘텐츠",
    path: "content",
    tabName: "content",
    isNew: true,
    description:
      "채널과 연결된 주최 콘텐츠와 참가 가능한 콘텐츠 모집을 확인합니다.",
  },
} as const;

/**
 * 탭 설정 배열
 */
export const TAB_ITEMS: ReadonlyArray<TabConfig> = [
  TAB_CONFIG.home,
  TAB_CONFIG.musicbook,
  TAB_CONFIG.schedule,
  TAB_CONFIG.content,
  TAB_CONFIG.setlist,
  TAB_CONFIG.guestbook,
  TAB_CONFIG.wardrobe,
  TAB_CONFIG.info,
] as const;

const DEFAULT_CHANNEL_TAB_ORDER: Record<ChannelTab, number> = {
  home: 0,
  musicbook: 1,
  schedule: 2,
  content: 3,
  setlist: 4,
  guestbook: 5,
  wardrobe: 6,
  info: 7,
};

/**
 * 백엔드가 별도 저장값이 없는 채널에 내려주는 기존 기본 순서.
 * 이 상대 순서를 그대로 쓰는 채널은 운영자가 배치를 바꾸지 않은 것으로 보고
 * 최신 프론트 기본 순서를 적용한다.
 */
const LEGACY_DEFAULT_CHANNEL_TAB_SEQUENCE: ReadonlyArray<ChannelTab> = [
  "home",
  "musicbook",
  "schedule",
  "content",
  "setlist",
  "guestbook",
  "info",
  "wardrobe",
];

const CURRENT_DEFAULT_CHANNEL_TAB_SEQUENCE: ReadonlyArray<ChannelTab> =
  TAB_ITEMS.map((item) => item.tabName);

function hasSameTabSequence(
  left: ReadonlyArray<ChannelTab>,
  right: ReadonlyArray<ChannelTab>
): boolean {
  return (
    left.length === right.length &&
    left.every((tab, index) => tab === right[index])
  );
}

/**
 * 저장된 8개 메뉴의 상대 순서가 기존/현재 기본 순서와 같으면 기본 배치로 본다.
 * 라벨이나 노출 여부만 수정한 채널도 새 기본 배치를 따르며,
 * 실제로 메뉴 순서를 바꾼 채널의 order는 그대로 보존한다.
 */
export function usesDefaultChannelTabOrder(
  settings: ChannelFeatureSettings | null | undefined
): boolean {
  if (!settings?.items.length) return true;

  const storedByKey = new Map(
    settings.items.map((item) => [item.key, item])
  );
  const orderedTabs = [...CURRENT_DEFAULT_CHANNEL_TAB_SEQUENCE].sort(
    (left, right) => {
      const leftOrder = storedByKey.get(left)?.order;
      const rightOrder = storedByKey.get(right)?.order;
      const normalizedLeftOrder =
        typeof leftOrder === "number" &&
        Number.isInteger(leftOrder) &&
        leftOrder >= 0
          ? leftOrder
          : DEFAULT_CHANNEL_TAB_ORDER[left];
      const normalizedRightOrder =
        typeof rightOrder === "number" &&
        Number.isInteger(rightOrder) &&
        rightOrder >= 0
          ? rightOrder
          : DEFAULT_CHANNEL_TAB_ORDER[right];

      if (normalizedLeftOrder !== normalizedRightOrder) {
        return normalizedLeftOrder - normalizedRightOrder;
      }
      return (
        DEFAULT_CHANNEL_TAB_ORDER[left] - DEFAULT_CHANNEL_TAB_ORDER[right]
      );
    }
  );

  return (
    hasSameTabSequence(orderedTabs, LEGACY_DEFAULT_CHANNEL_TAB_SEQUENCE) ||
    hasSameTabSequence(orderedTabs, CURRENT_DEFAULT_CHANNEL_TAB_SEQUENCE)
  );
}

export const DEFAULT_CHANNEL_FEATURE_SETTINGS: ChannelFeatureSettings = {
  items: TAB_ITEMS.map((item) => ({
    key: item.tabName,
    label: item.title,
    defaultLabel: item.title,
    isEnabled: true,
    order: DEFAULT_CHANNEL_TAB_ORDER[item.tabName],
  })),
};

export function getChannelFeatureSetting(
  settings: ChannelFeatureSettings | null | undefined,
  tab: ChannelTab
): ChannelFeatureSetting {
  const fallback =
    DEFAULT_CHANNEL_FEATURE_SETTINGS.items.find((item) => item.key === tab) ??
    DEFAULT_CHANNEL_FEATURE_SETTINGS.items[0];
  const stored = settings?.items.find((item) => item.key === tab);

  return {
    ...fallback,
    ...stored,
    label: stored?.label?.trim() || fallback.defaultLabel,
    defaultLabel: fallback.defaultLabel,
    order: usesDefaultChannelTabOrder(settings)
      ? fallback.order
      : stored?.order ?? fallback.order,
  };
}

export function isChannelTabEnabled(
  settings: ChannelFeatureSettings | null | undefined,
  tab: ChannelTab
): boolean {
  return getChannelFeatureSetting(settings, tab).isEnabled;
}

export function getConfiguredTabItems(
  settings: ChannelFeatureSettings | null | undefined
): ConfiguredTabItem[] {
  const defaultOrder = new Map(
    DEFAULT_CHANNEL_FEATURE_SETTINGS.items.map((item, index) => [
      item.key,
      index,
    ])
  );

  return TAB_ITEMS.map((item) => {
    const feature = getChannelFeatureSetting(settings, item.tabName);
    return {
      ...item,
      title: feature.label,
      defaultTitle: feature.defaultLabel,
      isEnabled: feature.isEnabled,
      order: feature.order,
    };
  })
    .filter((item) => item.isEnabled)
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return (
        (defaultOrder.get(a.tabName) ?? 0) - (defaultOrder.get(b.tabName) ?? 0)
      );
    });
}

export function getAllConfiguredChannelMenuItems(
  settings: ChannelFeatureSettings | null | undefined
): ConfiguredTabItem[] {
  return getConfiguredTabItems(settings);
}

/**
 * 경로에서 탭 추출
 * @param pathname - 현재 경로 (예: /channel/username/musicbook)
 * @returns ChannelTab 또는 'home' (기본값)
 */
export function getTabFromPath(pathname: string): ChannelTab {
  // pathname 형식: /channel/{user}/{tab?}
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length < 2 || parts[0] !== "channel") {
    return "home";
  }

  // /channel/{user} 형태면 home
  if (parts.length === 2) {
    return "home";
  }

  // /channel/{user}/{tab} 형태
  const tabPath = parts[2];

  // tabPath가 허용된 채널 탭인지 확인
  const validTab = Object.values(TAB_CONFIG).find(
    (config) => config.path === tabPath
  );

  return validTab?.tabName ?? "home";
}

/**
 * 탭에서 경로 생성
 * @param webPath - 채널 webPath
 * @param tab - 탭 이름
 * @returns 전체 경로
 */
export function getPathFromTab(webPath: string, tab: ChannelTab): string {
  const config = TAB_CONFIG[tab];
  const basePath = `/channel/${webPath}`;

  if (!config.path) {
    return basePath;
  }

  return `${basePath}/${config.path}`;
}

/**
 * 탭의 타이틀 가져오기
 * @param tab - 탭 이름
 * @returns 탭 타이틀
 */
export function getTabTitle(tab: ChannelTab): string {
  return TAB_CONFIG[tab].title;
}

/**
 * 탭의 설명 가져오기 (없으면 undefined).
 * 신규 레이아웃 SectionHeaderV3 타이틀 옆 i 버튼 팝오버에 사용.
 */
export function getTabDescription(tab: ChannelTab): string | undefined {
  return TAB_CONFIG[tab].description;
}

/**
 * 쿼리 파라미터의 tab 값을 ChannelTab으로 변환
 * @param tabParam - ?tab= 쿼리 파라미터 값
 * @returns ChannelTab 또는 null
 */
export function parseTabParam(tabParam: string | null): ChannelTab | null {
  if (!tabParam) return null;

  const internalTabs = Object.keys(TAB_CONFIG) as ChannelTab[];

  if (internalTabs.includes(tabParam as ChannelTab)) {
    return tabParam as ChannelTab;
  }

  return null;
}
