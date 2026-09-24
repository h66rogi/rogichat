import { apiClient } from "@/meloming/shared/lib/api-client";

export async function getChannelConsoleToken(
  identifier: string
): Promise<{ consoleToken: string }> {
  const response = await apiClient.get<{ consoleToken: string }>(
    `/channel/${identifier}/console-token`,
    { withCredentials: true }
  );
  return response.data;
}

export async function regenerateChannelConsoleToken(
  identifier: string
): Promise<{ consoleToken: string }> {
  const response = await apiClient.patch<{ consoleToken: string }>(
    `/channel/${identifier}/console-token/regenerate`,
    {},
    { withCredentials: true }
  );
  return response.data;
}

export async function deleteChannelConsoleToken(
  identifier: string
): Promise<{ message: string }> {
  const response = await apiClient.delete<{ message: string }>(
    `/channel/${identifier}/console-token`,
    { withCredentials: true }
  );
  return response.data;
}
