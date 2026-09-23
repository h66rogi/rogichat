import { apiClient } from "@/meloming/shared/lib/api-client";
import type { CreateSongRequestDto } from "./song-requests";

export interface OmakaseStatus {
  channelId: number;
  enabled: boolean;
  displayName: string;
  price: number;
  currencyPrices: Record<string, number | null> | null;
  count: number;
}

export interface OmakaseLedgerEntry {
  id: number;
  channelId: number;
  liveSessionId: number | null;
  songRequestId: number | null;
  type:
    | "CHAT_PAID"
    | "MANUAL_INCREMENT"
    | "MANUAL_DECREMENT"
    | "MANUAL_SET"
    | "CONSUME_QUEUE"
    | "CONSUME_PLAY_NOW";
  delta: number;
  balanceAfter: number;
  requesterPlatformId: string | null;
  requesterNickname: string | null;
  rawMessage: string | null;
  donationAmount: number | null;
  donationNativeAmount: number | null;
  donationCurrency: string | null;
  actorUserId: number | null;
  reason: string | null;
  createdAt: string;
}

export type UpdateOmakaseSettingsDto = Partial<{
  enabled: boolean;
  displayName: string | null;
  price: number;
  currencyPrices: Record<string, number | null> | null;
}>;

export async function getOmakaseSettings(channelId: number): Promise<OmakaseStatus> {
  const response = await apiClient.get<OmakaseStatus>(
    `/channel/${channelId}/omakase-settings`,
    { withCredentials: true },
  );
  return response.data;
}

export async function updateOmakaseSettings(
  channelId: number,
  dto: UpdateOmakaseSettingsDto,
): Promise<OmakaseStatus> {
  const response = await apiClient.patch<OmakaseStatus>(
    `/channel/${channelId}/omakase-settings`,
    dto,
    { withCredentials: true },
  );
  return response.data;
}

export async function getConsoleOmakaseStatus(): Promise<OmakaseStatus> {
  const response = await apiClient.get<OmakaseStatus>("/console-api/omakase/status");
  return response.data;
}

export async function getConsoleOmakaseHistory(
  limit = 50,
): Promise<OmakaseLedgerEntry[]> {
  const response = await apiClient.get<OmakaseLedgerEntry[]>(
    "/console-api/omakase/history",
    { params: { limit } },
  );
  return response.data;
}

export async function adjustConsoleOmakase(input: {
  liveSessionId: number;
  delta: number;
  reason?: string;
}): Promise<OmakaseStatus> {
  const response = await apiClient.post<OmakaseStatus>(
    "/console-api/omakase/adjust",
    input,
  );
  return response.data;
}

export async function setConsoleOmakaseCount(input: {
  liveSessionId: number;
  count: number;
  reason?: string;
}): Promise<OmakaseStatus> {
  const response = await apiClient.post<OmakaseStatus>(
    "/console-api/omakase/set-count",
    input,
  );
  return response.data;
}

export async function consumeConsoleOmakase(input: {
  request: CreateSongRequestDto;
  playNow?: boolean;
}): Promise<{ status: OmakaseStatus; request: unknown }> {
  const response = await apiClient.post<{ status: OmakaseStatus; request: unknown }>(
    "/console-api/omakase/consume",
    input,
  );
  return response.data;
}
