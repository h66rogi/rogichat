import { apiClient } from "@/meloming/shared/lib/api-client";
import type {
  TransferTargetInfo,
  ChannelTransferIncomingListResponse,
  ChannelTransferOutgoingResponse,
  ChannelTransferResponse,
  MessageResponse,
  CheckTransferTargetDto,
  RequestTransferDto,
  AcceptTransferDto,
} from "@/meloming/domains/channel/types/channel-transfer";

/**
 * GET /channel/transfer/check-target
 * 채널 이전 대상자 검증
 */
export async function checkTransferTarget(
  dto: CheckTransferTargetDto
): Promise<TransferTargetInfo> {
  const response = await apiClient.get<TransferTargetInfo>(
    "/channel/transfer/check-target",
    {
      params: dto,
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * POST /channel/:identifier/transfer
 * 채널 이전 신청 (소유주)
 */
export async function requestChannelTransfer(
  identifier: string,
  dto: RequestTransferDto
): Promise<ChannelTransferResponse> {
  const response = await apiClient.post<ChannelTransferResponse>(
    `/channel/${identifier}/transfer`,
    dto,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * POST /channel/transfer/:requestId/remind
 * 채널 이전 요청 재알림 (소유주)
 */
export async function remindChannelTransfer(
  requestId: number
): Promise<MessageResponse> {
  const response = await apiClient.post<MessageResponse>(
    `/channel/transfer/${requestId}/remind`,
    {},
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * DELETE /channel/transfer/:requestId
 * 채널 이전 신청 취소 (소유주)
 */
export async function cancelChannelTransfer(
  requestId: number
): Promise<MessageResponse> {
  const response = await apiClient.delete<MessageResponse>(
    `/channel/transfer/${requestId}`,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * GET /channel/transfer/:requestId/validate
 * 채널 이전 토큰 검증
 */
export async function validateTransferToken(
  requestId: number,
  token: string
): Promise<{ valid: boolean }> {
  const response = await apiClient.get<{ valid: boolean }>(
    `/channel/transfer/${requestId}/validate`,
    {
      params: { token },
    }
  );
  return response.data;
}

/**
 * GET /channel/transfer/incoming
 * 받은 채널 이전 요청 목록 조회 (수신자)
 */
export async function getChannelTransferIncoming(): Promise<ChannelTransferIncomingListResponse> {
  const response = await apiClient.get<ChannelTransferIncomingListResponse>(
    "/channel/transfer/incoming",
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * POST /channel/transfer/:requestId/accept
 * 채널 이전 수락 (수신자)
 */
export async function acceptChannelTransfer(
  requestId: number,
  dto: AcceptTransferDto
): Promise<ChannelTransferResponse> {
  const response = await apiClient.post<ChannelTransferResponse>(
    `/channel/transfer/${requestId}/accept`,
    dto,
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * POST /channel/transfer/:requestId/reject
 * 채널 이전 거절 (수신자)
 */
export async function rejectChannelTransfer(
  requestId: number
): Promise<MessageResponse> {
  const response = await apiClient.post<MessageResponse>(
    `/channel/transfer/${requestId}/reject`,
    {},
    {
      withCredentials: true,
    }
  );
  return response.data;
}

/**
 * GET /channel/:identifier/transfer/outgoing
 * 채널 진행 중 이전 요청 조회 (소유주)
 */
export async function getChannelTransferOutgoing(
  identifier: string
): Promise<ChannelTransferOutgoingResponse | null> {
  const response = await apiClient.get<ChannelTransferOutgoingResponse | null>(
    `/channel/${identifier}/transfer/outgoing`,
    {
      withCredentials: true,
    }
  );
  return response.data;
}
