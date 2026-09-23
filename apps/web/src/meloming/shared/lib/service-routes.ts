export type ServiceId =
  | "portal"
  | "id"
  | "notifications"
  | "rental"
  | "commission"
  | "store"
  | "musicbook"
  | "hotclip"
  | "sync"
  | "content"
  | "recruit"
  | "ranking"
  | "gift"
  | "haejuseyo"
  | "account"
  | "support"
  | "catalog"
  | "policy"
  | "partners";

export type ServiceLink = {
  id: ServiceId;
  label: string;
  href: string;
};

export const SUPPORT_CENTER_URL = "https://help.meloming.com";
export const CONTENT_TERMINATION_NOTICE_URL = `${SUPPORT_CENTER_URL}/notices/6`;

const isQaHost = (host: string) =>
  host.endsWith(".meloming.pri.sbalyd.com") ||
  host.endsWith(".pri.sbalyd.com") ||
  host.endsWith(".meloming.int.sbalyd.com") ||
  host.endsWith(".int.sbalyd.com");

const isQaIntHost = (host: string) =>
  host.endsWith(".meloming.int.sbalyd.com") || host.endsWith(".int.sbalyd.com");

function isQaAppEnv() {
  if (typeof process === "undefined") return false;
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  return appEnv === "qa" || appEnv === "stage" || appEnv === "staging";
}

export function getDefaultBase(service: ServiceId, envHost?: string) {
  const host =
    envHost ??
    (typeof window !== "undefined" ? window.location.hostname : "meloming.com");
  const qa = isQaHost(host) || (!envHost && isQaAppEnv());
  const root = qa ? "meloming.pri.sbalyd.com" : "meloming.com";

  switch (service) {
    case "portal":
      return `https://${root}`;
    case "id":
      return `https://id.${root}`;
    case "notifications":
      return `https://notify.${root}`;
    case "rental":
      if (qa && isQaIntHost(host)) return "https://rental.meloming.int.sbalyd.com";
      return `https://rental.${root}`;
    case "commission":
      return `https://commission.${root}`;
    case "store":
      return qa ? `https://${root}/store` : "https://meloming.com/store";
    case "musicbook":
      return qa ? `https://${root}/musicbook` : "https://meloming.com/musicbook";
    case "hotclip":
      return `https://${root}/hotclip`;
    case "sync":
      return `https://${root}/sync`;
    case "content":
      return `https://${root}/content`;
    case "recruit":
      return `https://${root}/recruit`;
    case "ranking":
      return `https://ranking.${root}`;
    case "gift":
      return `https://${root}/anongift`;
    case "haejuseyo":
      return `https://plz.${root}`;
    case "account":
      return `https://${root}/mypage`;
    case "support":
      return SUPPORT_CENTER_URL;
    case "catalog":
      return `https://catalog.${root}`;
    case "policy":
      return `https://policy.${root}`;
    case "partners":
      return `https://partners.${root}`;
  }
}

export function getProductionBase(service: ServiceId) {
  return getDefaultBase(service, "meloming.com");
}

/** Production destination used by the global service directory on every host. */
export function getGlobalServiceHref(service: ServiceId) {
  const portalBase = getProductionBase("portal");

  if (service === "musicbook") {
    return `${portalBase}/musicbook`;
  }
  if (service === "content") {
    return `${portalBase}/content`;
  }
  return getProductionBase(service);
}

const NO_QA_SPLIT_SUBDOMAINS = new Set(["cdn", "upload", "status", "openapi"]);

export function melomingUrl(subdomain: string, envHost?: string): string {
  const host =
    envHost ??
    (typeof window !== "undefined" ? window.location.hostname : "meloming.com");
  const qa = isQaHost(host) || (!envHost && isQaAppEnv());
  const root =
    qa && !NO_QA_SPLIT_SUBDOMAINS.has(subdomain)
      ? "meloming.pri.sbalyd.com"
      : "meloming.com";
  return `https://${subdomain}.${root}`;
}

export const routes = {
  portal: {
    home: () => getDefaultBase("portal"),
  },
  id: {
    home: () => `${getDefaultBase("id")}/account/personal`,
    personal: () => `${getDefaultBase("id")}/account/personal`,
    security: () => `${getDefaultBase("id")}/account/security`,
    mfa: () => `${getDefaultBase("id")}/account/mfa`,
    password: () => `${getDefaultBase("id")}/account/password`,
    platforms: () => `${getDefaultBase("id")}/account/platforms`,
    connectedApps: () => `${getDefaultBase("id")}/account/connected-apps`,
    withdrawal: () => `${getDefaultBase("id")}/account/withdrawal`,
  },
  notifications: {
    home: () => getDefaultBase("notifications"),
  },
  rental: {
    home: () => getDefaultBase("rental"),
    orders: () => `${getDefaultBase("rental")}/orders`,
    mypage: () => `${getDefaultBase("rental")}/mypage`,
    mypageOrders: () => `${getDefaultBase("rental")}/mypage/orders`,
    mypageOrder: (orderId: string | number) =>
      `${getDefaultBase("rental")}/mypage/orders/${encodeURIComponent(String(orderId))}`,
    mypageBilling: () => `${getDefaultBase("rental")}/mypage/billing`,
    mypageReviews: () => `${getDefaultBase("rental")}/mypage/reviews`,
    checkout: () => `${getDefaultBase("rental")}/checkout`,
    policy: () => `${getDefaultBase("rental")}/policy`,
  },
  haejuseyo: {
    home: () => getDefaultBase("haejuseyo"),
    creators: () => `${getDefaultBase("haejuseyo")}/creators`,
    products: () => `${getDefaultBase("haejuseyo")}/products`,
    faq: () => `${getDefaultBase("haejuseyo")}/faq`,
    order: (productId: string) => `${getDefaultBase("haejuseyo")}/order/${encodeURIComponent(productId)}`,
  },
  account: {
    home: () => getDefaultBase("account"),
    addresses: (returnTo?: string) => {
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
      return `${getDefaultBase("account")}/addresses${query}`;
    },
    billingMethods: (returnTo?: string) => {
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
      return `${getDefaultBase("account")}/subscription-payment-methods${query}`;
    },
    identityVerification: (returnTo?: string) => {
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
      return `${getDefaultBase("account")}/platform-verification${query}`;
    },
    platformVerification: (returnTo?: string) => {
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
      return `${getDefaultBase("account")}/platform-verification${query}`;
    },
    channelVerification: (returnTo?: string) => {
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
      return `${getDefaultBase("account")}/platform-verification${query}`;
    },
    login: (returnTo?: string) => {
      const base = getDefaultBase("portal");
      const query = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
      return `${base}/auth/login${query}`;
    },
  },
  support: {
    contact: () => getDefaultBase("support"),
  },
  policy: {
    home: () => getDefaultBase("policy"),
    terms: () => `${getDefaultBase("policy")}/terms`,
    privacy: () => `${getDefaultBase("policy")}/privacy`,
    paidService: () => `${getDefaultBase("policy")}/paid-service`,
  },
};

export function getServiceLinks(): ServiceLink[] {
  return [
    { id: "commission", label: "커미션", href: getGlobalServiceHref("commission") },
    { id: "partners", label: "파트너센터 (정산)", href: getGlobalServiceHref("partners") },
    { id: "support", label: "고객센터", href: getGlobalServiceHref("support") },
    { id: "policy", label: "약관 및 정책", href: getGlobalServiceHref("policy") },
  ];
}

const SERVICE_LABELS: Record<ServiceId, string> = {
  portal: "홈",
  id: "통합 ID",
  notifications: "알림센터",
  rental: "렌탈",
  commission: "커미션",
  store: "스토어",
  musicbook: "노래책",
  hotclip: "핫클립",
  sync: "싱크",
  content: "콘텐츠 뻐꾸기",
  recruit: "구인구직",
  ranking: "랭킹",
  gift: "선물하기",
  haejuseyo: "해주세요",
  account: "마이페이지",
  support: "고객센터",
  catalog: "전체 서비스",
  policy: "약관 및 정책",
  partners: "파트너센터",
};

export function getServiceLabel(id: ServiceId): string {
  return SERVICE_LABELS[id];
}

export type ServiceCategory = {
  title: string;
  links: ServiceLink[];
};

/** Canonical logo asset for the global service launcher across every host app. */
export const GLOBAL_SERVICE_LOGO_SRC =
  "https://meloming.com/logo/meloming-logo-512.png";

/** The production service map shown in the global "전체 서비스" launcher. */
export function getServiceCategories(): ServiceCategory[] {
  return [
    {
      title: "커미션",
      links: [
        { id: "commission", label: "커미션", href: getGlobalServiceHref("commission") },
        { id: "partners", label: "파트너센터 (정산)", href: getGlobalServiceHref("partners") },
      ],
    },
    {
      title: "기타",
      links: [
        { id: "support", label: "고객센터", href: getGlobalServiceHref("support") },
        { id: "policy", label: "약관 및 정책", href: getGlobalServiceHref("policy") },
      ],
    },
  ];
}

export function getCommissionServiceUrl(): string {
  if (process.env.NEXT_PUBLIC_COMMISSION_SITE_URL) {
    return process.env.NEXT_PUBLIC_COMMISSION_SITE_URL.replace(/\/$/, "");
  }

  return getDefaultBase("commission");
}
