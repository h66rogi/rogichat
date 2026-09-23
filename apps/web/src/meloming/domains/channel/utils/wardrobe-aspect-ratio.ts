import type { CSSProperties } from "react";
import {
  DEFAULT_WARDROBE_ASPECT_RATIO,
  WARDROBE_ASPECT_RATIOS,
  type WardrobeAspectRatio,
} from "@/meloming/domains/channel/types/wardrobe";

export const WARDROBE_ASPECT_RATIO_META: Record<
  WardrobeAspectRatio,
  { label: string; cssValue: string; width: number; height: number }
> = {
  "16:9": { label: "16:9", cssValue: "16 / 9", width: 16, height: 9 },
  "9:16": { label: "9:16", cssValue: "9 / 16", width: 9, height: 16 },
  "1:1": { label: "1:1", cssValue: "1 / 1", width: 1, height: 1 },
  "4:3": { label: "4:3", cssValue: "4 / 3", width: 4, height: 3 },
  "3:4": { label: "3:4", cssValue: "3 / 4", width: 3, height: 4 },
};

export function normalizeWardrobeAspectRatio(
  value?: string | null,
): WardrobeAspectRatio {
  if (
    value &&
    (WARDROBE_ASPECT_RATIOS as readonly string[]).includes(value)
  ) {
    return value as WardrobeAspectRatio;
  }
  return DEFAULT_WARDROBE_ASPECT_RATIO;
}

export function getWardrobeAspectRatioStyle(
  value?: string | null,
): CSSProperties {
  return {
    aspectRatio:
      WARDROBE_ASPECT_RATIO_META[normalizeWardrobeAspectRatio(value)].cssValue,
  };
}
