// 채널 이전 관련 타입 정의

export interface TransferTargetInfo {
  userId: number;
  email: string;
  nickname: string | null;
  profileImageUrl: string | null;
}

export interface ChannelTransferRequest {
  requestId: number;
  noteFromRequester: string | null;
  requestedAt: Date;
  lastNotifiedAt: Date;
  channel: {
    id: number;
    name: string;
    profileImageUrl: string | null;
    webPath: string;
  };
  currentOwner: {
    id: number;
    nickname: string | null;
  };
}

export interface ChannelTransferIncomingListResponse {
  requests: ChannelTransferRequest[];
}

export interface ChannelTransferResponse {
  requestId: number;
  status: "PENDING" | "COMPLETED" | "REJECTED" | "CANCELED";
}

export interface MessageResponse {
  message: string;
}

// Request DTOs
export interface CheckTransferTargetDto {
  email: string;
}

export interface RequestTransferDto {
  targetUserId: number;
  noteFromRequester?: string;
}

export interface AcceptTransferDto {
  evidenceImages?: string[];
  consentAgreeTerms: boolean;
  consentAgreeTransfer: boolean;
  consentAgreePrivacy: boolean;
  noteFromTarget?: string;
}

// Outgoing transfer (채널 소유자가 보낸 이전 요청)
export interface ChannelTransferOutgoingTarget {
  id: number;
  email: string;
  nickname: string | null;
  profileImageUrl: string | null;
}

export interface ChannelTransferOutgoingResponse {
  requestId: number;
  target: ChannelTransferOutgoingTarget;
  noteFromRequester: string | null;
  requestedAt: Date;
  lastNotifiedAt: Date;
}
