"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type MelomingUser = {
  id: number;
  email?: string | null;
  nickname?: string | null;
  name?: string | null;
  profileImageUrl?: string | null;
  profileImage?: string | null;
  isProSubscriber?: boolean | null;
  proSubscriptionEndAt?: string | Date | null;
  isFounder?: boolean | null;
  isAmbassador?: boolean | null;
  isVerifiedArtist?: boolean | null;
  isAdmin?: boolean | null;
  isIdentityVerified?: boolean | null;
  isAdultVerified?: boolean | null;
  birthDate?: string | null;
  identityMethod?: "SMS" | "APP" | "DIDIT" | null;
  streamerHide?: boolean | null;
  streamerHidden?: boolean | null;
  isStreamerHidden?: boolean | null;
  hideStreamer?: boolean | null;
  isPrivateStreamer?: boolean | null;
  hidePrivateInfo?: boolean | null;
  privateInfoHidden?: boolean | null;
  isHidden?: boolean | null;
  privacyMode?: string | boolean | null;
};

type AuthState = {
  user: MelomingUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const AUTH_COOKIE_NAMES = ["accessToken", "refreshToken"];
const WRONG_DOMAINS = [
  "api.meloming.pri.sbalyd.com",
  ".api.meloming.pri.sbalyd.com",
  "api.meloming.com",
  ".api.meloming.com",
];

let refreshPromise: Promise<void> | null = null;

function shouldUseSameOriginApiProxy() {
  if (typeof window === "undefined") return false;

  const proxyFlag = process.env.NEXT_PUBLIC_USE_SAME_ORIGIN_API?.trim().toLowerCase();
  if (proxyFlag === "true" || proxyFlag === "1") return true;
  if (proxyFlag === "false" || proxyFlag === "0") return false;

  const host = window.location.hostname;
  const localHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return (
    localHost ||
    host === "rental.meloming.com" ||
    host.endsWith(".rental.meloming.com") ||
    host === "rental.meloming.pri.sbalyd.com" ||
    host.endsWith(".rental.meloming.pri.sbalyd.com") ||
    host === "rental.meloming.int.sbalyd.com" ||
    host.endsWith(".rental.meloming.int.sbalyd.com") ||
    host === "plz.meloming.com" ||
    host.endsWith(".plz.meloming.com") ||
    host === "plz.meloming.pri.sbalyd.com" ||
    host.endsWith(".plz.meloming.pri.sbalyd.com")
  );
}

function getApiBaseUrl(): string | null {
  if (shouldUseSameOriginApiProxy()) return "";

  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (base) return base.replace(/\/$/, "");

  const appEnv = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (
    appEnv === "qa" ||
    host.endsWith(".meloming.pri.sbalyd.com") ||
    host.endsWith(".pri.sbalyd.com") ||
    host.endsWith(".meloming.int.sbalyd.com") ||
    host.endsWith(".int.sbalyd.com") ||
    host.endsWith(".vercel.app")
  ) {
    return "https://api.meloming.pri.sbalyd.com";
  }
  if (
    appEnv === "production" ||
    appEnv === "prod" ||
    host === "plz.meloming.com" ||
    host.endsWith(".meloming.com")
  ) {
    return "https://api.meloming.com";
  }
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:8080";
  return null;
}

function deleteWrongDomainCookies() {
  if (typeof document === "undefined") return;
  for (const cookieName of AUTH_COOKIE_NAMES) {
    for (const wrongDomain of WRONG_DOMAINS) {
      document.cookie = `${cookieName}=; path=/; domain=${wrongDomain}; max-age=0`;
    }
  }
}

function deleteAuthCookies() {
  if (typeof document === "undefined") return;
  for (const cookieName of AUTH_COOKIE_NAMES) {
    document.cookie = `${cookieName}=; path=/; max-age=0`;
    document.cookie = `${cookieName}=; path=/; domain=${window.location.hostname}; max-age=0`;
    for (const wrongDomain of WRONG_DOMAINS) {
      document.cookie = `${cookieName}=; path=/; domain=${wrongDomain}; max-age=0`;
    }
  }
}

async function callRefresh() {
  const apiBaseUrl = getApiBaseUrl();
  if (apiBaseUrl === null) throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
  const response = await fetch(`${apiBaseUrl}/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Auth refresh failed.");
  deleteWrongDomainCookies();
}

function normalizeResponse<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    (payload as { data: unknown }).data !== undefined
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstErrorText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstErrorText(item);
      if (text) return text;
    }
    return null;
  }
  if (isRecord(value)) {
    return firstErrorText(value.message)
      ?? firstErrorText(value.error)
      ?? firstErrorText(value.detail);
  }
  return null;
}

function responseErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  return firstErrorText(payload.messages)
    ?? firstErrorText(payload.message)
    ?? firstErrorText(payload.error)
    ?? fallback;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { retryOnUnauthorized?: boolean } = {},
): Promise<T> {
  const apiBaseUrl = getApiBaseUrl();
  if (apiBaseUrl === null) throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
  const retryOnUnauthorized = init.retryOnUnauthorized !== false;
  const isFormDataBody = typeof FormData !== "undefined" && init.body instanceof FormData;
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
    headers: {
      ...(!isFormDataBody ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  };
  const response = await fetch(`${apiBaseUrl}${path}`, requestInit);

  if (response.status === 401 && retryOnUnauthorized && !path.includes("/auth/")) {
    try {
      if (!refreshPromise) {
        refreshPromise = callRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      await refreshPromise;
      return apiFetch<T>(path, { ...init, retryOnUnauthorized: false });
    } catch {
      deleteAuthCookies();
    }
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      message = responseErrorMessage(await response.json(), message);
    } catch {
      // Non-JSON error body.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as unknown;
  return normalizeResponse<T>(payload);
}

async function fetchCurrentUser() {
  return apiFetch<MelomingUser | null>("/v1/user/me", { retryOnUnauthorized: true });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MelomingUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextUser = await fetchCurrentUser();
      setUser(nextUser);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>("/v1/auth/logout", { method: "POST", retryOnUnauthorized: false });
    } catch {
      // Local cleanup still matters if the server request failed.
    }
    deleteAuthCookies();
    setUser(null);
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      refreshUser,
      logout,
    }),
    [isLoading, logout, refreshUser, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}
