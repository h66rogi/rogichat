import {
  DEFAULT_CHANNEL_FEATURE_SETTINGS,
  getChannelFeatureSetting,
  type ChannelFeatureSetting,
  type ChannelFeatureSettings,
  type ChannelFeatureSettingsUpdate,
} from "@/meloming/domains/channel/types/channel-tab";

export const CHANNEL_FEATURE_LABEL_MAX_LENGTH = 24;

export function normalizeChannelFeatureItems(
  items: ChannelFeatureSetting[],
  options: { sortByOrder?: boolean; preserveOrder?: boolean } = {}
): ChannelFeatureSetting[] {
  const source = options.sortByOrder
    ? items.slice().sort((a, b) => a.order - b.order)
    : items.slice();

  return source.map((item, index) => ({
    ...item,
    label:
      item.label.trim().slice(0, CHANNEL_FEATURE_LABEL_MAX_LENGTH) ||
      item.defaultLabel,
    order:
      options.preserveOrder &&
      Number.isInteger(item.order) &&
      item.order >= 0
        ? item.order
        : index,
  }));
}

/**
 * 서버 응답에 과거 키가 남아 있어도 허용된 8개 기본 키만 병합한다.
 * 각 채널의 표시 이름, 노출 여부, 상대적 순서는 그대로 보존한다.
 */
export function getEditableChannelFeatureItems(
  settings: ChannelFeatureSettings | null | undefined,
  options: { preserveOrder?: boolean } = {}
): ChannelFeatureSetting[] {
  return normalizeChannelFeatureItems(
    DEFAULT_CHANNEL_FEATURE_SETTINGS.items.map((fallback) =>
      getChannelFeatureSetting(settings, fallback.key)
    ),
    { sortByOrder: true, preserveOrder: options.preserveOrder }
  );
}

export function serializeChannelFeatureItems(
  items: ChannelFeatureSetting[]
): string {
  return JSON.stringify(
    normalizeChannelFeatureItems(items).map(
      ({ key, label, isEnabled, order }) => ({
        key,
        label,
        isEnabled,
        order,
      })
    )
  );
}

export function toChannelFeatureSettingsUpdate(
  items: ChannelFeatureSetting[]
): ChannelFeatureSettingsUpdate {
  return {
    items: normalizeChannelFeatureItems(items).map(
      ({ key, label, isEnabled, order }) => ({
        key,
        label,
        isEnabled,
        order,
      })
    ),
  };
}
