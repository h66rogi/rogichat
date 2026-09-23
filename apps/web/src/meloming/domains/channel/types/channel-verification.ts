import type { StreamPlatform } from "@/meloming/domains/platform/types/platform";

export type ChannelVerificationStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED";
export type ChannelVerificationPendingReason =
  | "OTHER_PLATFORM"
  | "AUTO_VERIFY_FAILED";

export interface UserPlatformVerificationSummaryDto {
  id: number;
  platform: StreamPlatform;
  platformUserId: string;
  platformChannelId: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
}

export interface ChannelVerificationPreviewDto {
  channelId: number;
  detectedPlatform: StreamPlatform;
  detectedChannelId: string | null;
  canAutoVerify: boolean;
  autoVerifyFailReason: string | null;
  matchedVerification: UserPlatformVerificationSummaryDto | null;
  availableVerifications: UserPlatformVerificationSummaryDto[];
  existingVerifications: { platform: StreamPlatform; status: ChannelVerificationStatus }[];
}

export interface ChannelVerificationDto {
  id: number;
  channelId: number;
  platform: StreamPlatform;
  platformChannelId: string | null;
  status: ChannelVerificationStatus;
  pendingReason: ChannelVerificationPendingReason | null;
  evidenceImageUrl: string | null;
  evidenceDescription: string | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChannelVerificationDto {
  platform?: StreamPlatform;
  userPlatformVerificationId?: number;
  evidenceImageUrl?: string;
  evidenceDescription?: string;
}
