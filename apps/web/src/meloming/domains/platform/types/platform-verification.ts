import type {
  Platform,
  StreamPlatform,
} from "@/meloming/domains/platform/types/platform";

export interface UserPlatformVerificationDto {
  id: number;
  platform: StreamPlatform;
  platformUserId: string;
  platformChannelId: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformOAuthTokenDto {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}

export interface VerifyPlatformRequestDto {
  accessToken: string;
  refreshToken?: string;
}

export interface VerifyPlatformResponseDto {
  id: number;
  platform: StreamPlatform;
  platformUserId: string;
  platformChannelId: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
}

export interface GetMyPlatformVerificationsResponse {
  verifications: UserPlatformVerificationDto[];
}
