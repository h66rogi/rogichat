import axios from "axios";
import type { AxiosError, AxiosInstance } from "axios";
import { normalizeAxiosErrorMessage } from "./api-error";
import { rogichatApiOrigin, rogichatCsrfToken } from "@/core/meloming-api-bridge";

// The copied Meloming console popup marks token-only requests with this flag.
export const CONSOLE_TOKEN_FLAG = "_consoleTokenRequest";

export const apiClient = axios.create({
  baseURL: "/v1",
  withCredentials: true,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

export const apiV2Client = axios.create({
  baseURL: "/v2",
  withCredentials: true,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Rogichat uses a session cookie and CSRF proof. Resolve the API target at
// request time so one immutable web build works in QA and production.
function attachRogichatRequestInterceptor(instance: AxiosInstance, version: "v1" | "v2") {
  instance.interceptors.request.use(async (config) => {
    config.baseURL = `${rogichatApiOrigin()}/${version}`;
    const method = config.method?.toUpperCase() ?? "GET";
    const anonymousRequest = version === "v1" && method === "POST" &&
      config.url === "/song-requests" && config.data !== null &&
      typeof config.data === "object" && typeof config.data.anonymousNickname === "string" &&
      config.data.anonymousNickname.trim().length > 0;
    if (!anonymousRequest && !((config as unknown as Record<string, unknown>)[CONSOLE_TOKEN_FLAG]) &&
      method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      config.headers.set("X-CSRF-Token", await rogichatCsrfToken());
    }
    return config;
  });
}

// Rogichat has no Meloming refresh endpoint. Surface the original response.
export function attachResponseInterceptor(instance: AxiosInstance): void {
  instance.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
      normalizeAxiosErrorMessage(error);
      return Promise.reject(error);
    }
  );
}

attachRogichatRequestInterceptor(apiClient, "v1");
attachRogichatRequestInterceptor(apiV2Client, "v2");
attachResponseInterceptor(apiClient);
attachResponseInterceptor(apiV2Client);
