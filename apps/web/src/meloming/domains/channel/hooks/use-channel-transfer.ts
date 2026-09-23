import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import {
  checkTransferTarget,
  requestChannelTransfer,
  remindChannelTransfer,
  cancelChannelTransfer,
  getChannelTransferIncoming,
  getChannelTransferOutgoing,
  acceptChannelTransfer,
  rejectChannelTransfer,
  validateTransferToken,
} from "@/meloming/domains/channel/apis/channel-transfer";
import type {
  TransferTargetInfo,
  ChannelTransferIncomingListResponse,
  ChannelTransferOutgoingResponse,
  ChannelTransferResponse,
  MessageResponse,
  RequestTransferDto,
  AcceptTransferDto,
} from "@/meloming/domains/channel/types/channel-transfer";

export const channelTransferKeys = {
  all: ["channelTransfer"] as const,
  incoming: () => [...channelTransferKeys.all, "incoming"] as const,
  outgoing: (identifier: string) =>
    [...channelTransferKeys.all, "outgoing", identifier] as const,
  checkTarget: (email: string) =>
    [...channelTransferKeys.all, "checkTarget", email] as const,
  validateToken: (requestId: number, token: string) =>
    [...channelTransferKeys.all, "validateToken", requestId, token] as const,
};

type UseChannelTransferOptions = {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
};

/**
 * 받은 채널 이전 요청 목록 조회 Hook
 */
export function useChannelTransferIncoming(
  options?: UseChannelTransferOptions
): UseQueryResult<ChannelTransferIncomingListResponse, Error> {
  return useQuery({
    queryKey: channelTransferKeys.incoming(),
    queryFn: getChannelTransferIncoming,
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 30 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

/**
 * 보낸 채널 이전 요청 조회 Hook (채널 소유자용)
 */
export function useChannelTransferOutgoing(
  identifier: string,
  options?: UseChannelTransferOptions
): UseQueryResult<ChannelTransferOutgoingResponse | null, Error> {
  return useQuery({
    queryKey: channelTransferKeys.outgoing(identifier),
    queryFn: () => getChannelTransferOutgoing(identifier),
    enabled: !!identifier && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 30 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
  });
}

/**
 * 채널 이전 대상자 검증 Hook
 */
export function useCheckTransferTarget(
  email: string,
  options?: UseChannelTransferOptions
): UseQueryResult<TransferTargetInfo, Error> {
  return useQuery({
    queryKey: channelTransferKeys.checkTarget(email),
    queryFn: () => checkTransferTarget({ email }),
    enabled: !!email?.trim() && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * 채널 이전 토큰 검증 Hook
 */
export function useValidateTransferToken(
  requestId: number,
  token: string | undefined,
  options?: UseChannelTransferOptions
): UseQueryResult<{ valid: boolean }, Error> {
  return useQuery({
    queryKey: channelTransferKeys.validateToken(requestId, token ?? ""),
    queryFn: () => validateTransferToken(requestId, token!),
    enabled: !!token && requestId > 0 && (options?.enabled ?? true),
    staleTime: options?.staleTime ?? 60 * 1000,
    gcTime: options?.cacheTime ?? 5 * 60 * 1000,
    retry: false,
  });
}

type RequestTransferVariables = {
  identifier: string;
  dto: RequestTransferDto;
};

type AcceptTransferVariables = {
  requestId: number;
  dto: AcceptTransferDto;
};

/**
 * 채널 이전 관련 Mutations Hook
 */
export function useChannelTransferMutations(): {
  requestTransfer: UseMutationResult<
    ChannelTransferResponse,
    Error,
    RequestTransferVariables,
    unknown
  >;
  remindTransfer: UseMutationResult<MessageResponse, Error, number, unknown>;
  cancelTransfer: UseMutationResult<MessageResponse, Error, number, unknown>;
  acceptTransfer: UseMutationResult<
    ChannelTransferResponse,
    Error,
    AcceptTransferVariables,
    unknown
  >;
  rejectTransfer: UseMutationResult<MessageResponse, Error, number, unknown>;
} {
  const queryClient = useQueryClient();

  const invalidateIncoming = () =>
    queryClient.invalidateQueries({
      queryKey: channelTransferKeys.incoming(),
    });

  const invalidateOutgoing = (identifier: string) =>
    queryClient.invalidateQueries({
      queryKey: channelTransferKeys.outgoing(identifier),
    });

  const requestTransfer = useMutation({
    mutationFn: ({ identifier, dto }: RequestTransferVariables) =>
      requestChannelTransfer(identifier, dto),
    onSuccess: (_, { identifier }) => invalidateOutgoing(identifier),
  });

  const remindTransfer = useMutation({
    mutationFn: (requestId: number) => remindChannelTransfer(requestId),
  });

  const cancelTransfer = useMutation({
    mutationFn: (requestId: number) => cancelChannelTransfer(requestId),
  });

  const acceptTransfer = useMutation({
    mutationFn: ({ requestId, dto }: AcceptTransferVariables) =>
      acceptChannelTransfer(requestId, dto),
    onSuccess: () => invalidateIncoming(),
  });

  const rejectTransfer = useMutation({
    mutationFn: (requestId: number) => rejectChannelTransfer(requestId),
    onSuccess: () => invalidateIncoming(),
  });

  return {
    requestTransfer,
    remindTransfer,
    cancelTransfer,
    acceptTransfer,
    rejectTransfer,
  };
}
