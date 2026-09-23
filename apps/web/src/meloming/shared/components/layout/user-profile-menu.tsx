"use client";

import { apiFetch, type MelomingUser } from "@/meloming/shared/lib/auth-runtime";
import {
  Award,
  BadgeCheck,
  Check,
  ChevronRight,
  Coins,
  Crown,
  Globe,
  LogOut,
  Monitor,
  Moon,
  ShoppingBag,
  Sparkles,
  Sun,
  User,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { routes } from "@/meloming/shared/lib/service-routes";

type RewardBalanceState = {
  loaded: boolean;
  loading: boolean;
  balance: number | null;
  failed: boolean;
};

const initialRewardBalanceState: RewardBalanceState = {
  loaded: false,
  loading: false,
  balance: null,
  failed: false,
};

type TagChip = {
  key: string;
  label: string;
  icon: LucideIcon;
  tone: "pro" | "founder" | "ambassador" | "verified";
};

type ThemePreference = "system" | "light" | "dark";

const BALANCE_FETCH_TIMEOUT_MS = 7_000;

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "system", label: "시스템", icon: Monitor },
  { value: "light", label: "라이트", icon: Sun },
  { value: "dark", label: "다크", icon: Moon },
];

export function UserAvatar({ user }: { user: MelomingUser | null }) {
  const image = user?.profileImageUrl ?? user?.profileImage ?? null;
  const label = getUserDisplayName(user).slice(0, 1) || "M";
  if (image) {
    return <img className="user-avatar" src={image} alt="" />;
  }
  return <span className="user-avatar user-avatar-fallback">{label}</span>;
}

export function getUserDisplayName(user: MelomingUser | null) {
  return user?.nickname ?? user?.name ?? user?.email ?? "게스트";
}

export function ProBadge({ active }: { active?: boolean | null }) {
  if (!active) return null;
  return (
    <span className="user-badge user-badge--pro">
      <Crown aria-hidden size={12} />
      PRO
    </span>
  );
}

export function UserProfileMenu({
  user,
  loading,
  loginHref,
  accountHref = routes.account.home(),
  accountLabel = "내 회원 정보관리",
  extraItems,
  onLogout,
  compact = false,
}: {
  user: MelomingUser | null;
  loading: boolean;
  loginHref: string;
  accountHref?: string;
  accountLabel?: string;
  extraItems?: Array<{
    href: string;
    label: string;
    icon?: "external" | "products";
  }>;
  onLogout: () => void;
  /** 트리거를 아바타만 있는 원형 버튼으로 렌더(이름 숨김). 메인 홈 상단바용. 팝오버 내용은 동일. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rewardBalance, setRewardBalance] = useState<RewardBalanceState>(
    initialRewardBalanceState,
  );
  const [themeOptionsOpen, setThemeOptionsOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const themePreference: ThemePreference =
    theme === "light" || theme === "dark" ? theme : "system";
  const balanceRequestId = useRef(0);
  const balanceFormatter = useMemo(() => new Intl.NumberFormat("ko-KR"), []);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) setThemeOptionsOpen(false);
  }, [open]);

  useEffect(() => {
    balanceRequestId.current += 1;
    setRewardBalance(initialRewardBalanceState);
  }, [userId]);

  useEffect(() => {
    if (!open || userId === null) return;

    const requestId = balanceRequestId.current + 1;
    balanceRequestId.current = requestId;
    const setCurrentBalance = (
      updater:
        | RewardBalanceState
        | ((state: RewardBalanceState) => RewardBalanceState),
    ) => {
      if (balanceRequestId.current !== requestId) return;
      setRewardBalance(updater);
    };

    setRewardBalance((state) => ({ ...state, loading: true }));

    fetchRewardBalance()
      .then((payload) => {
        setCurrentBalance({
          loaded: true,
          loading: false,
          balance: readBalance(payload),
          failed: false,
        });
      })
      .catch(() => {
        setCurrentBalance({
          loaded: true,
          loading: false,
          balance: null,
          failed: true,
        });
      });
  }, [open, userId]);

  if (loading) {
    return (
      <span
        className={`profile-skeleton${compact ? " profile-skeleton--compact" : ""}`}
        aria-label="계정 상태 확인 중"
      />
    );
  }
  if (!user) {
    // 비로그인: 프로필 아바타를 항상 노출하되 클릭 시 로그인으로 이동(게스트 플레이스홀더).
    return (
      <a
        className={`profile-trigger profile-trigger--guest${compact ? " profile-trigger--compact" : ""}`}
        href={loginHref}
        aria-label="로그인"
      >
        <span className="user-avatar user-avatar-fallback" aria-hidden>
          <User />
        </span>
        {compact ? null : <span className="profile-name">로그인</span>}
      </a>
    );
  }

  const displayName = getUserDisplayName(user);
  const isProActive = getIsProActive(user);
  const tagChips = getTagChips(user, isProActive);
  const selectedThemeLabel =
    THEME_OPTIONS.find((option) => option.value === themePreference)?.label ?? "시스템";

  return (
    <div className="profile-menu">
      <button
        className={`profile-trigger ${compact ? "profile-trigger--compact " : ""}${open ? "is-open" : ""}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`${displayName} 프로필 메뉴`}
        onClick={() => setOpen((value) => !value)}
      >
        <UserAvatar user={user} />
        {compact ? null : <span className="profile-name">{displayName}</span>}
      </button>
      {open ? (
        <>
          <button
            className="profile-scrim"
            type="button"
            aria-label="닫기"
            onClick={() => setOpen(false)}
          />
          <div className="profile-panel" role="menu">
            <div className="profile-panel__user">
              <UserAvatar user={user} />
              <span className="profile-panel__copy">
                <strong>{displayName}</strong>
                {user.email ? <span>{user.email}</span> : null}
              </span>
            </div>
            {tagChips.length > 0 ? (
              <div className="profile-panel__badges">
                {tagChips.map((chip) => (
                  <span
                    key={chip.key}
                    className={`user-badge user-badge--${chip.tone}`}
                  >
                    <chip.icon aria-hidden size={12} />
                    {chip.label}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="profile-balance-grid">
              <ProfileBalanceCard
                icon={<Coins aria-hidden size={14} />}
                label="커미션 적립금"
                value={formatBalanceValue({
                  amount: rewardBalance.balance,
                  failed: rewardBalance.failed,
                  loading: !rewardBalance.loaded,
                  formatter: balanceFormatter,
                })}
              />
            </div>
            <div className="profile-panel__separator" />
            <a className="profile-panel__item" href={accountHref} role="menuitem">
              <UserCog aria-hidden size={16} />
              {accountLabel}
            </a>
            {extraItems?.map((item) => (
              <a
                key={item.href}
                className="profile-panel__item"
                href={item.href}
                role="menuitem"
              >
                {item.icon === "products" ? (
                  <ShoppingBag aria-hidden size={16} />
                ) : item.icon === "external" ? (
                  <Globe aria-hidden size={16} />
                ) : (
                  <UserCog aria-hidden size={16} />
                )}
                {item.label}
              </a>
            ))}
            <div className="profile-panel__separator" />
            <button
              className="profile-panel__item"
              type="button"
              role="menuitem"
              aria-expanded={themeOptionsOpen}
              onClick={() => setThemeOptionsOpen((value) => !value)}
            >
              <Sun aria-hidden size={16} />
              테마
              <span className="profile-panel__item-meta">{selectedThemeLabel}</span>
              <ChevronRight
                className={`profile-panel__item-chevron ${
                  themeOptionsOpen ? "is-open" : ""
                }`}
                aria-hidden
                size={16}
              />
            </button>
            {themeOptionsOpen ? (
              <div
                className="profile-theme-options"
                role="group"
                aria-label="테마 선택"
              >
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const active = option.value === themePreference;
                  return (
                    <button
                      key={option.value}
                      className={`profile-theme-option ${active ? "is-active" : ""}`}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setTheme(option.value);
                        setThemeOptionsOpen(false);
                      }}
                    >
                      <Icon aria-hidden size={14} />
                      <span>{option.label}</span>
                      {active ? <Check aria-hidden size={14} /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <button
              className="profile-panel__item profile-panel__item--disabled"
              type="button"
              role="menuitem"
              aria-disabled="true"
              tabIndex={-1}
            >
              <Globe aria-hidden size={16} />
              언어
              <span className="profile-panel__item-meta">지원 예정</span>
            </button>
            <div className="profile-panel__separator" />
            <button
              className="profile-panel__item profile-panel__item--danger"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void onLogout();
              }}
            >
              <LogOut aria-hidden size={16} />
              로그아웃
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ProfileBalanceCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="profile-balance-card">
      <span className="profile-balance-card__label profile-balance-card__label--reward">
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function getTagChips(user: MelomingUser, isProActive: boolean): TagChip[] {
  return [
    isProActive
      ? { key: "pro", label: "PRO", icon: Crown, tone: "pro" as const }
      : null,
    user.isFounder
      ? { key: "founder", label: "설립자", icon: Award, tone: "founder" as const }
      : null,
    user.isAmbassador
      ? {
          key: "ambassador",
          label: "앰배서더",
          icon: Sparkles,
          tone: "ambassador" as const,
        }
      : null,
    user.isVerifiedArtist
      ? {
          key: "verified",
          label: "인증작가",
          icon: BadgeCheck,
          tone: "verified" as const,
        }
      : null,
  ].filter(Boolean) as TagChip[];
}

function getIsProActive(user: MelomingUser) {
  if (!user.isProSubscriber) return false;
  if (!user.proSubscriptionEndAt) return true;
  const endAt = new Date(user.proSubscriptionEndAt);
  if (Number.isNaN(endAt.getTime())) return true;
  return endAt.getTime() >= Date.now();
}

function fetchRewardBalance() {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
      reject(new Error("Reward balance request timed out."));
    }, BALANCE_FETCH_TIMEOUT_MS);

    apiFetch<Record<string, unknown>>("/v1/commission-rewards/balance", {
      signal: controller.signal,
    }).then(
      (payload) => {
        window.clearTimeout(timeoutId);
        resolve(payload);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(
          error instanceof Error
            ? error
            : new Error("Reward balance request failed."),
        );
      },
    );
  });
}

function readBalance(payload: Record<string, unknown>): number | null {
  const candidates = collectBalanceCandidates(payload);
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const normalized = candidate.replace(/[^\d.-]/g, "");
      const value = Number(normalized);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function collectBalanceCandidates(payload: Record<string, unknown>): unknown[] {
  const directKeys = [
    "balance",
    "amount",
    "availableBalance",
    "availableAmount",
    "currentBalance",
    "reward",
    "rewardBalance",
  ];
  const candidates = directKeys.map((key) => payload[key]);

  for (const key of ["data", "result", "payload"]) {
    const value = payload[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      candidates.push(
        ...collectBalanceCandidates(value as Record<string, unknown>),
      );
    }
  }

  return candidates;
}

function formatBalanceValue({
  amount,
  failed,
  loading,
  formatter,
}: {
  amount: number | null;
  failed: boolean;
  loading: boolean;
  formatter: Intl.NumberFormat;
}) {
  if (loading) return "...";
  if (failed) return "-";
  return `${formatter.format(amount ?? 0)}원`;
}
