import { apiClient } from "@/meloming/shared/lib/api-client";
import type { MarketingPopup } from "../types/marketing-popup";

export async function getActiveMarketingPopups(
  path?: string,
  isAuthenticated?: boolean,
  hasChannel?: boolean,
  isIdentityVerified?: boolean
): Promise<MarketingPopup[]> {
  const params: Record<string, string> = {};
  if (path) params.path = path;
  if (isAuthenticated !== undefined)
    params.isAuthenticated = String(isAuthenticated);
  if (hasChannel !== undefined) params.hasChannel = String(hasChannel);
  if (isIdentityVerified !== undefined) {
    params.isIdentityVerified = String(isIdentityVerified);
  }

  const response = await apiClient.get<MarketingPopup[]>(
    "/marketing-popups",
    { params }
  );
  return response.data;
}

export async function recordPopupImpression(popupId: number): Promise<void> {
  await apiClient.post(`/marketing-popups/${popupId}/impression`);
}

export async function recordPopupClick(popupId: number): Promise<void> {
  await apiClient.post(`/marketing-popups/${popupId}/click`);
}

export async function recordPopupClose(popupId: number): Promise<void> {
  await apiClient.post(`/marketing-popups/${popupId}/close`);
}

export async function recordPopupDismiss(popupId: number): Promise<void> {
  await apiClient.post(`/marketing-popups/${popupId}/dismiss`);
}
