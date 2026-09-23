export type MarketingPopupType =
  | "CENTER_MODAL"
  | "BOTTOM_SHEET"
  | "FULLSCREEN"
  | "SLIDE_IN";

export type MarketingPopupContentType = "IMAGE" | "RICH_TEXT" | "MIXED";

export type MarketingPopupDismissType =
  | "CLOSE_ONLY"
  | "TODAY"
  | "FOREVER"
  | "PERIOD";

export type MarketingPopupTargetAudience =
  | "ALL"
  | "LOGGED_IN"
  | "LOGGED_OUT"
  | "CHANNEL_OWNER"
  | "NON_CHANNEL_OWNER"
  | "IDENTITY_VERIFIED"
  | "IDENTITY_UNVERIFIED";

export type MarketingPopupFrequency =
  | "EVERY_VISIT"
  | "ONCE_PER_SESSION"
  | "ONCE_PER_DAY"
  | "ONCE_EVER";

export type MarketingPopupAnimationType = "FADE" | "SLIDE" | "SCALE" | "NONE";

export interface MarketingPopup {
  id: number;
  title: string;
  contentType: MarketingPopupContentType;
  imageUrl: string | null;
  imageDarkUrl: string | null;
  imageAlt: string | null;
  richTextContent: string | null;
  linkUrl: string | null;
  linkOpenInNew: boolean;
  linkButtonText: string | null;
  popupType: MarketingPopupType;
  animationType: MarketingPopupAnimationType;
  overlayOpacity: number;
  targetPages: string[];
  targetAudience: MarketingPopupTargetAudience;
  frequency: MarketingPopupFrequency;
  dismissType: MarketingPopupDismissType;
  dismissPeriodDays: number | null;
  maxImpressions: number | null;
  delaySeconds: number;
  priority: number;
  groupKey: string | null;
}
